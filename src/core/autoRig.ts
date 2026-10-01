/**
 * 자동 리깅 (그림 한 장 → 뼈대 + 부위별 레이어)
 * ------------------------------------------------------------
 * 손재주가 없어도 애니메이션을 만들 수 있게, 캐릭터 그림 한 장에 점 7개만 찍으면
 * 나머지를 자동으로 준비합니다. (그다음 동작 템플릿이 뼈를 움직임 → core/motionTemplates.ts)
 *
 *  1) planJoints   : 찍은 점(머리·목·골반·손·발) → 어깨·팔꿈치·엉덩이·무릎 위치 계산
 *                    팔꿈치/무릎은 "그림 안쪽으로 이어진 최단 경로"의 가운데 → 굽은 팔도 정확
 *  2) segmentParts : 그림의 모든 픽셀을 10개 부위로 나눔
 *                    뼈 선에서 출발해 퍼져 나가되(지오데식), 외곽선·색 경계를 넘을 때 비용이 큼
 *                    → 몸통 위에 겹쳐 그린 팔도 외곽선을 따라 깔끔하게 분리
 *  3) buildParts   : 부위별 그림 만들기
 *                    - 관절 덮개: 팔꿈치/무릎을 굽혀도 틈이 안 보이게 윗부분 픽셀을 조금 겹쳐 둠
 *                    - 가려진 곳 채우기: 앞팔을 떼어낸 몸통의 빈 곳을 주변 색으로 메움
 *                    - 뒤쪽 팔다리 만들기: 몸통에 가려 거의 안 보이면 앞쪽 팔다리를 본떠 어둡게 그림
 *  4) createRig    : 그룹 레이어 + 부위 레이어(그리는 순서 정리) + 뼈 10개(+골반)를 프로젝트에 추가
 *                    부위 레이어는 RotSprite 로 돌아가서 회전해도 도트가 깔끔합니다.
 */
import { colorDistance, colorToHex, luminance, packColor, unpackColor } from './color';
import { mapToPalette, outlineBuffer } from './effects';
import { holeMask, inpaint } from './inpaint';
import { cloneBuffer, contentBounds, createBuffer, uniqueColors } from './pixels';
import { addLayer, findLayer, layerIndex, uid } from './project';
import { transformBuffer } from './resample';
import { createBone } from './skeleton';
import { compose, rotateDeg, translate } from './affine';
import type { Bone, Color, Effect, Layer, Point, Project } from './types';

/* ------------------------------------------------------------------ */
/* 이름표                                                                */
/* ------------------------------------------------------------------ */

/** 사용자가 찍는 점 (순서대로 안내) */
export type RigPointId = 'head' | 'neck' | 'pelvis' | 'handF' | 'handB' | 'footF' | 'footB';
export const RIG_POINT_IDS: RigPointId[] = ['head', 'neck', 'pelvis', 'handF', 'handB', 'footF', 'footB'];
export type RigPoints = Record<RigPointId, Point>;

export type RigPartId = 'torso' | 'head' | 'upperArmF' | 'foreArmF' | 'upperArmB' | 'foreArmB' | 'thighF' | 'shinF' | 'thighB' | 'shinB';
/** 라벨 번호 = 이 배열의 위치 */
export const RIG_PARTS: RigPartId[] = ['torso', 'head', 'upperArmF', 'foreArmF', 'upperArmB', 'foreArmB', 'thighF', 'shinF', 'thighB', 'shinB'];
/** 레이어 쌓는 순서 (아래 → 위): 뒤쪽 팔·다리 → 앞다리 → 몸통 → 머리 → 앞팔 */
export const PART_Z: RigPartId[] = ['upperArmB', 'foreArmB', 'thighB', 'shinB', 'thighF', 'shinF', 'torso', 'head', 'upperArmF', 'foreArmF'];

export type JointId =
  | 'head'
  | 'neck'
  | 'pelvis'
  | 'shoulderF'
  | 'shoulderB'
  | 'elbowF'
  | 'elbowB'
  | 'handF'
  | 'handB'
  | 'hipF'
  | 'hipB'
  | 'kneeF'
  | 'kneeB'
  | 'footF'
  | 'footB';
export type RigJoints = Record<JointId, Point>;

/** 부위 → 뼈(시작 관절, 끝 관절) */
export const PART_BONE: Record<RigPartId, [JointId, JointId]> = {
  torso: ['pelvis', 'neck'],
  head: ['neck', 'head'],
  upperArmF: ['shoulderF', 'elbowF'],
  foreArmF: ['elbowF', 'handF'],
  upperArmB: ['shoulderB', 'elbowB'],
  foreArmB: ['elbowB', 'handB'],
  thighF: ['hipF', 'kneeF'],
  shinF: ['kneeF', 'footF'],
  thighB: ['hipB', 'kneeB'],
  shinB: ['kneeB', 'footB'],
};

/** 부모 부위 ('root' = 골반 뼈) */
export const PART_PARENT: Record<RigPartId, RigPartId | 'root'> = {
  torso: 'root',
  head: 'torso',
  upperArmF: 'torso',
  foreArmF: 'upperArmF',
  upperArmB: 'torso',
  foreArmB: 'upperArmB',
  thighF: 'root',
  shinF: 'thighF',
  thighB: 'root',
  shinB: 'thighB',
};

const LIMBS: RigPartId[] = ['upperArmF', 'foreArmF', 'upperArmB', 'foreArmB', 'thighF', 'shinF', 'thighB', 'shinB'];

/* ------------------------------------------------------------------ */
/* 그림 분석                                                            */
/* ------------------------------------------------------------------ */

interface SpriteInfo {
  w: number;
  h: number;
  solid: Uint8Array;
  color: Uint32Array;
  /** 외곽선(또는 경계) 픽셀 */
  edge: Uint8Array;
}

/**
 * 외곽선 색 찾기: 그림 가장자리(투명과 맞닿은 픽셀)에서 가장 많이 쓰인 색이 어두우면 외곽선으로 봅니다.
 */
export function detectOutlineColor(buf: Uint8ClampedArray, w: number, h: number): Color | null {
  const counts = new Map<Color, number>();
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) continue;
      const i = (y * w + x) * 4;
      const c = packColor(buf[i], buf[i + 1], buf[i + 2], 255);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  let best: Color | null = null;
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best !== null && luminance(best) < 0.32 ? best : null;
}

function analyze(buf: Uint8ClampedArray, w: number, h: number): SpriteInfo {
  const solid = new Uint8Array(w * h);
  const color = new Uint32Array(w * h);
  const edge = new Uint8Array(w * h);
  const outline = detectOutlineColor(buf, w, h);
  for (let i = 0; i < w * h; i++) {
    const k = i * 4;
    if (buf[k + 3] === 0) continue;
    solid[i] = 1;
    color[i] = packColor(buf[k], buf[k + 1], buf[k + 2], 255);
    if (outline !== null && colorDistance(color[i], outline) <= 24) edge[i] = 1;
  }
  return { w, h, solid, color, edge };
}

/* ------------------------------------------------------------------ */
/* 기하 도우미                                                           */
/* ------------------------------------------------------------------ */

export function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** 작은 이진 힙 (다익스트라용) */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop() as number;
    const lv = v.pop() as number;
    if (k.length > 0) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

const N8: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** 점에서 가장 가까운 그림 픽셀 */
function snapToSolid(info: SpriteInfo, p: Point): number {
  const cx = Math.max(0, Math.min(info.w - 1, Math.floor(p.x)));
  const cy = Math.max(0, Math.min(info.h - 1, Math.floor(p.y)));
  if (info.solid[cy * info.w + cx]) return cy * info.w + cx;
  let best = -1;
  let bd = Infinity;
  for (let y = 0; y < info.h; y++) {
    for (let x = 0; x < info.w; x++) {
      if (!info.solid[y * info.w + x]) continue;
      const d = (x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2;
      if (d < bd) [bd, best] = [d, y * info.w + x];
    }
  }
  return best;
}

/** 그림 안쪽으로만 이어진 최단 경로 (픽셀 중심 좌표 목록). 길이 없으면 직선 */
export function geodesicPath(info: SpriteInfo, a: Point, b: Point): Point[] {
  const { w, h, solid } = info;
  const s = snapToSolid(info, a);
  const t = snapToSolid(info, b);
  if (s < 0 || t < 0) return [a, b];
  const dist = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const heap = new Heap();
  dist[s] = 0;
  heap.push(0, s);
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    if (i === t) break;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy, c] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!solid[j]) continue;
      const nd = d + c;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(nd, j);
      }
    }
  }
  if (!Number.isFinite(dist[t])) return [a, b];
  const path: Point[] = [];
  for (let i = t; i >= 0; i = prev[i]) path.push({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
  path.reverse();
  path[0] = a;
  path[path.length - 1] = b;
  return path;
}

/** 경로 길이의 ratio 위치 */
export function pointAlong(path: Point[], ratio: number): Point {
  if (path.length < 2) return path[0];
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    lens.push(l);
    total += l;
  }
  let want = total * ratio;
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i]) return lerp(path[i], path[i + 1], lens[i] > 0 ? want / lens[i] : 0);
    want -= lens[i];
  }
  return path[path.length - 1];
}

/* ------------------------------------------------------------------ */
/* 1) 관절 계산                                                          */
/* ------------------------------------------------------------------ */

export function planJoints(buf: Uint8ClampedArray, w: number, h: number, pts: RigPoints, view: 'side' | 'front' = 'side'): RigJoints {
  const info = analyze(buf, w, h);
  const spine = (t: number) => lerp(pts.neck, pts.pelvis, t);
  // 어깨: 목에서 몸통 길이의 18% 아래
  //  옆모습은 두 어깨가 거의 같은 곳, 앞모습은 손이 있는 쪽 몸 가장자리
  const sp = spine(0.18);
  const shoulderAt = (hand: Point): Point => (view === 'front' ? { x: sp.x + (hand.x - sp.x) * 0.8, y: sp.y } : { ...sp });
  const shoulderF = shoulderAt(pts.handF);
  const shoulderB = shoulderAt(pts.handB);
  // 엉덩이: 골반에서 발 쪽으로 (앞모습은 더 많이)
  const hip = (foot: Point): Point =>
    view === 'front'
      ? { x: pts.pelvis.x + (foot.x - pts.pelvis.x) * 0.85, y: pts.pelvis.y }
      : { x: pts.pelvis.x + Math.max(-2, Math.min(2, (foot.x - pts.pelvis.x) * 0.25)), y: pts.pelvis.y };
  const hipF = hip(pts.footF);
  const hipB = hip(pts.footB);
  // 팔꿈치·무릎: 그림 안쪽 경로의 가운데 (팔이 굽어 있어도 그 모양을 따라감)
  const mid = (a: Point, b: Point, ratio: number) => pointAlong(geodesicPath(info, a, b), ratio);
  return {
    head: pts.head,
    neck: pts.neck,
    pelvis: pts.pelvis,
    shoulderF,
    shoulderB,
    elbowF: mid(shoulderF, pts.handF, 0.5),
    elbowB: mid(shoulderB, pts.handB, 0.5),
    handF: pts.handF,
    handB: pts.handB,
    hipF,
    hipB,
    kneeF: mid(hipF, pts.footF, 0.5),
    kneeB: mid(hipB, pts.footB, 0.5),
    footF: pts.footF,
    footB: pts.footB,
  };
}

/* ------------------------------------------------------------------ */
/* 2) 부위 나누기                                                        */
/* ------------------------------------------------------------------ */

/** 부위의 두께(반지름) 어림: 뼈에 수직으로 재서 경계(외곽선/투명)까지의 거리 */
function estimateRadius(info: SpriteInfo, a: Point, b: Point, stopAtEdge: boolean, t0 = 0.3, t1 = 0.85): number {
  const { w, h, solid, edge } = info;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const widths: number[] = [];
  const blocked = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return true;
    const i = iy * w + ix;
    return !solid[i] || (stopAtEdge && edge[i] === 1);
  };
  for (let k = 0; k <= 6; k++) {
    const c = lerp(a, b, t0 + ((t1 - t0) * k) / 6);
    if (blocked(c.x, c.y)) continue;
    let width = 1;
    for (const sgn of [1, -1]) {
      for (let s = 0.5; s < 40; s += 0.5) {
        if (blocked(c.x + nx * s * sgn, c.y + ny * s * sgn)) break;
        width += 0.5;
      }
    }
    widths.push(width);
  }
  if (widths.length === 0) return 2;
  widths.sort((p, q) => p - q);
  return widths[widths.length >> 1] / 2 + (stopAtEdge ? 1 : 0.5);
}

/** 머리 반지름: 머리 중심에서 16방향으로 투명한 곳까지 */
function headRadius(info: SpriteInfo, c: Point): number {
  const ds: number[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    let d = 0;
    for (let s = 0.5; s < 64; s += 0.5) {
      const x = Math.floor(c.x + Math.cos(a) * s);
      const y = Math.floor(c.y + Math.sin(a) * s);
      if (x < 0 || y < 0 || x >= info.w || y >= info.h || !info.solid[y * info.w + x]) break;
      d = s;
    }
    ds.push(d);
  }
  ds.sort((p, q) => p - q);
  return ds[Math.floor(ds.length * 0.6)] + 0.5;
}

export interface PartGeometry {
  /** 부위 → [시작, 끝] (머리는 머리 위쪽까지 늘림) */
  segments: Record<RigPartId, [Point, Point]>;
  radius: Record<RigPartId, number>;
}

export function partGeometry(buf: Uint8ClampedArray, w: number, h: number, j: RigJoints): PartGeometry {
  const info = analyze(buf, w, h);
  const segments = {} as Record<RigPartId, [Point, Point]>;
  const radius = {} as Record<RigPartId, number>;
  for (const part of RIG_PARTS) {
    const [a, b] = PART_BONE[part];
    segments[part] = [j[a], j[b]];
  }
  const hr = headRadius(info, j.head);
  // 머리 선은 머리 중심을 지나 반대편 끝까지
  const hd = { x: j.head.x - j.neck.x, y: j.head.y - j.neck.y };
  const hl = Math.hypot(hd.x, hd.y) || 1;
  segments.head = [j.neck, { x: j.head.x + (hd.x / hl) * hr * 0.6, y: j.head.y + (hd.y / hl) * hr * 0.6 }];
  radius.head = hr;
  radius.torso = Math.max(2, estimateRadius(info, j.pelvis, j.neck, false, 0.2, 0.8));
  for (const part of LIMBS) {
    const [a, b] = segments[part];
    const r = estimateRadius(info, a, b, true, part.startsWith('fore') || part.startsWith('shin') ? 0.2 : 0.35, 0.8);
    radius[part] = Math.max(1.5, Math.min(r, radius.torso * 0.9));
  }
  return { segments, radius };
}

/** 앞/뒤 짝 (겹치는 곳은 자기 뼈에 더 가까운 쪽이 가짐) */
const PAIR: Partial<Record<RigPartId, RigPartId>> = {
  upperArmF: 'upperArmB',
  upperArmB: 'upperArmF',
  foreArmF: 'foreArmB',
  foreArmB: 'foreArmF',
  thighF: 'thighB',
  thighB: 'thighF',
  shinF: 'shinB',
  shinB: 'shinF',
};

/** 선분 위 투영 위치 (0 = 시작, 1 = 끝, 범위 밖도 그대로) */
function projT(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1);
}

/**
 * 점이 부위의 "영역" 안인지
 *  - 팔·다리: 굵기 안 + 관절에서 평평하게 잘림 (윗팔은 팔꿈치까지, 아래팔은 팔꿈치부터)
 *  - 몸통/머리: 골반 아래 · 목 아래로는 거의 늘어나지 않음
 *  - 앞/뒤 짝이 겹치면 자기 뼈에 더 가까운 쪽
 */
export function insidePart(geo: PartGeometry, part: RigPartId, px: number, py: number): boolean {
  const [a, b] = geo.segments[part];
  const t = projT(px, py, a, b);
  let d = distToSegment(px, py, a, b);
  const proximal = part.startsWith('upper') || part.startsWith('thigh');
  const distal = part.startsWith('fore') || part.startsWith('shin');
  if (proximal && t > 1.02) return false;
  if (distal && t < -0.02) return false;
  if ((part === 'torso' || part === 'head') && t < 0) d *= part === 'torso' ? 2.4 : 2;
  if (part === 'torso' && t > 1) d *= 3;
  if (d > corridor(part, geo.radius[part])) return false;
  const other = PAIR[part];
  if (other) {
    const [oa, ob] = geo.segments[other];
    if (distToSegment(px, py, oa, ob) + 0.25 < d) return false;
  }
  return true;
}

/** 앞에서 뒤 순서: 앞에 그려진 부위가 겹치는 픽셀을 먼저 차지합니다. (PART_Z 의 반대) */
const CLAIM_ORDER: RigPartId[] = ['upperArmF', 'foreArmF', 'head', 'torso', 'thighF', 'shinF', 'upperArmB', 'foreArmB', 'thighB', 'shinB'];

/** 부위가 차지할 수 있는 굵기 (조금 여유) */
function corridor(part: RigPartId, r: number): number {
  if (part === 'torso') return r * 1.2 + 0.5;
  if (part === 'head') return r * 1.15 + 0.5;
  return r + 0.5;
}

/**
 * 그림의 각 픽셀이 어느 부위인지 (라벨 = RIG_PARTS 위치, 투명 = -1)
 *
 * 화가가 그린 순서의 반대(앞 → 뒤)로 부위마다 영역을 채웁니다.
 *  - 뼈 선 위에서 시작해서 "부위 굵기 안쪽"으로만 퍼짐
 *  - 외곽선 픽셀까지는 포함하지만, 외곽선을 넘어 다른 쪽 안으로는 들어가지 않음
 *  → 몸통 위에 그린 앞팔은 앞팔로, 몸통 뒤에 숨은 뒤팔은 밖으로 나온 부분만 뒤팔로
 * 남은 픽셀은 닿아 있는 부위 중 색 경계를 덜 넘는 쪽으로 붙입니다.
 */
export function segmentParts(buf: Uint8ClampedArray, w: number, h: number, j: RigJoints, geo = partGeometry(buf, w, h, j)): Int8Array {
  const info = analyze(buf, w, h);
  const labels = new Int8Array(w * h).fill(-1);
  const { segments, radius } = geo;
  const inside = (part: RigPartId, x: number, y: number) => insidePart(geo, part, x + 0.5, y + 0.5);
  const seed = new Uint8Array(w * h);

  for (const part of CLAIM_ORDER) {
    const label = RIG_PARTS.indexOf(part);
    const [a, b] = segments[part];
    const queue: number[] = [];
    const steps = Math.ceil(Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) * 2);
    for (let s = 0; s <= steps; s++) {
      const q = lerp(a, b, s / steps);
      const x = Math.floor(q.x);
      const y = Math.floor(q.y);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (!info.solid[i] || labels[i] >= 0) continue;
      labels[i] = label;
      seed[i] = 1;
      queue.push(i);
    }
    // 씨앗이 모두 앞 부위에 가려졌으면: 굵기 안의 남은 픽셀 중 뼈 가운데에 가장 가까운 곳
    if (queue.length === 0) {
      const m = lerp(a, b, 0.5);
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < w * h; i++) {
        if (!info.solid[i] || labels[i] >= 0 || !inside(part, i % w, (i / w) | 0)) continue;
        const d = ((i % w) + 0.5 - m.x) ** 2 + (((i / w) | 0) + 0.5 - m.y) ** 2;
        if (d < bd) [bd, best] = [d, i];
      }
      if (best >= 0) {
        labels[best] = label;
        queue.push(best);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      // 외곽선 픽셀은 차지만 하고 더 퍼지지 않음 (외곽선을 넘거나 외곽선을 따라 새지 않기)
      // 단, 뼈 선 위의 외곽선(씨앗)은 외곽선끼리만 이어서 퍼질 수 있음 (아주 가는 팔다리용)
      if (info.edge[i] && !seed[i]) continue;
      const fromEdge = info.edge[i] === 1;
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (!info.solid[k] || labels[k] >= 0) continue;
        if (fromEdge && !info.edge[k]) continue;
        // 대각선으로 외곽선 사이를 빠져나가지 않게
        if (dx !== 0 && dy !== 0 && info.edge[y * w + nx] && info.edge[ny * w + x] && !info.edge[k]) continue;
        if (!inside(part, nx, ny)) continue;
        labels[k] = label;
        queue.push(k);
      }
    }
  }

  // 남은 픽셀: 이미 정해진 이웃에서 퍼져 나감 (색 경계를 넘을수록 비쌈)
  const dist = new Float64Array(w * h).fill(Infinity);
  const heap = new Heap();
  for (let i = 0; i < w * h; i++) {
    if (labels[i] >= 0) {
      dist[i] = 0;
      heap.push(0, i);
    }
  }
  const fixed = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) fixed[i] = labels[i] >= 0 ? 1 : 0;
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy, step] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (!info.solid[k] || fixed[k]) continue;
      let cost = step;
      if (info.color[k] !== info.color[i]) cost += info.edge[k] !== info.edge[i] ? 2.5 : (colorDistance(info.color[k], info.color[i]) / 255) * 1.2;
      const nd = d + cost;
      if (nd < dist[k]) {
        dist[k] = nd;
        labels[k] = labels[i];
        heap.push(nd, k);
      }
    }
  }

  // 어디와도 이어지지 않은 조각: 가장 가까운 뼈의 부위
  for (let i = 0; i < w * h; i++) {
    if (!info.solid[i] || labels[i] >= 0) continue;
    const px = (i % w) + 0.5;
    const py = ((i / w) | 0) + 0.5;
    let best = 0;
    let bd = Infinity;
    RIG_PARTS.forEach((part, li) => {
      const d = distToSegment(px, py, segments[part][0], segments[part][1]) - radius[part];
      if (d < bd) [bd, best] = [d, li];
    });
    labels[i] = best;
  }
  return cleanupLabels(labels, w, h);
}

/** 3픽셀 이하로 떨어진 작은 조각은 주변에서 가장 많은 부위로 */
function cleanupLabels(labels: Int8Array, w: number, h: number): Int8Array {
  const out = new Int8Array(labels);
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (out[s] < 0 || seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      comp.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (seen[k] || out[k] !== out[s]) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    if (comp.length > 3) continue;
    const votes = new Map<number, number>();
    for (const i of comp) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const l = out[ny * w + nx];
        if (l >= 0 && l !== out[s]) votes.set(l, (votes.get(l) ?? 0) + 1);
      }
    }
    let best = -1;
    let n = 0;
    for (const [l, k] of votes) if (k > n) [best, n] = [l, k];
    if (best >= 0) for (const i of comp) out[i] = best;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3) 부위별 그림                                                        */
/* ------------------------------------------------------------------ */

export interface BuildOptions {
  /** 몸통에 가려 거의 안 보이는 뒤쪽 팔다리를 앞쪽을 본떠 다시 그리기 (옆모습 추천) */
  rebuildBackLimbs: boolean;
  /** 앞팔·머리를 떼어낸 몸통의 빈 곳 메우기 */
  fillHoles: boolean;
  /**
   * 살아 있는 외곽선: 부위의 바깥 외곽선을 떼어 내고, 움직인 뒤에 외곽선 효과로 다시 그림.
   * 돌리거나 겹쳐도 외곽선이 끊기거나 두 겹이 되지 않고, 팔·다리는 하나로 이어진 외곽선을 가짐.
   */
  liveOutline: boolean;
  /** 옆모습/앞모습 (그리는 순서가 달라짐) */
  view?: 'side' | 'front';
}

export const DEFAULT_BUILD: BuildOptions = { rebuildBackLimbs: true, fillHoles: true, liveOutline: true, view: 'side' };

export interface OutlineStyle {
  color: Color;
  /** 대각선 모서리까지 칠하는 외곽선인지 */
  diagonal: boolean;
}

export interface BuiltParts {
  parts: Record<RigPartId, Uint8ClampedArray>;
  /** 살아 있는 외곽선을 쓰면 그 색/모양 (외곽선이 없는 그림이면 null) */
  outline: OutlineStyle | null;
}

const isOutline = (buf: Uint8ClampedArray, k: number, outline: Color) =>
  buf[k + 3] > 0 && colorDistance(packColor(buf[k], buf[k + 1], buf[k + 2], 255), outline) <= 24;

/** 바깥(투명)과 맞닿은 외곽선 색 픽셀만 지움 → 안쪽 색만 남음 (눈처럼 안쪽의 어두운 점은 그대로) */
export function stripOuterOutline(buf: Uint8ClampedArray, w: number, h: number, outline: Color): Uint8ClampedArray {
  const out = cloneBuffer(buf);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (!isOutline(buf, k, outline)) continue;
      const open = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= w || ny >= h || buf[(ny * w + nx) * 4 + 3] === 0;
      });
      if (open) out[k + 3] = out[k] = out[k + 1] = out[k + 2] = 0;
    }
  }
  return out;
}

/** 원래 그림의 외곽선이 대각선 모서리까지 칠한 방식인지 (두 방식으로 다시 그려 보고 더 닮은 쪽) */
export function detectOutlineStyle(buf: Uint8ClampedArray, w: number, h: number, outline: Color): OutlineStyle {
  const fill = stripOuterOutline(buf, w, h, outline);
  const score = (diagonal: boolean) => {
    const gen = outlineBuffer(fill, w, h, outline, 1, 'outside', diagonal);
    let s = 0;
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      const was = buf[k + 3] > 0 && fill[k + 3] === 0;
      const now = gen[k + 3] > 0 && fill[k + 3] === 0;
      if (was && now) s++;
      else if (now !== was) s--;
    }
    return s;
  };
  return { color: outline, diagonal: score(true) > score(false) };
}

function maskOf(labels: Int8Array, parts: RigPartId[]): Uint8Array {
  const ids = new Set(parts.map((p) => RIG_PARTS.indexOf(p)));
  const m = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) if (ids.has(labels[i])) m[i] = 1;
  return m;
}

function countSolid(buf: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++;
  return n;
}

/** 색을 한 단계 어둡게 (그림에 쓰인 색 중에서 고름 → 팔레트 유지) */
function darken(buf: Uint8ClampedArray, w: number, h: number, palette: Color[]): Uint8ClampedArray {
  const out = cloneBuffer(buf);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    out[i] *= 0.72;
    out[i + 1] *= 0.72;
    out[i + 2] *= 0.78;
  }
  return palette.length > 0 ? mapToPalette(out, w, h, palette, 'none', 0, 'perceptual') : out;
}

/** 선분 a0→a1 을 b0→b1 위치로 옮기는 행렬 (회전 + 이동, 크기는 그대로) */
function alignMatrix(a0: Point, a1: Point, b0: Point, b1: Point) {
  const angA = Math.atan2(a1.y - a0.y, a1.x - a0.x);
  const angB = Math.atan2(b1.y - b0.y, b1.x - b0.x);
  return compose(translate(b0.x, b0.y), rotateDeg(((angB - angA) * 180) / Math.PI), translate(-a0.x, -a0.y));
}

/**
 * 가려졌던 곳 채우기: 같은 줄(없으면 같은 열)에서 가장 가까운 "외곽선이 아닌" 색을 이어 붙임
 * → 팔 밑에 숨어 있던 몸통 세로줄이 옆의 옷 색·명암을 그대로 이어받음
 */
function fillFromRows(buf: Uint8ClampedArray, w: number, h: number, region: Uint8Array, outline: Color): Uint8ClampedArray {
  const out = cloneBuffer(buf);
  const usable = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const k = (y * w + x) * 4;
    if (buf[k + 3] === 0) return false;
    return colorDistance(packColor(buf[k], buf[k + 1], buf[k + 2], 255), outline) > 24;
  };
  const copy = (i: number, x: number, y: number) => {
    const k = (y * w + x) * 4;
    out[i * 4] = buf[k];
    out[i * 4 + 1] = buf[k + 1];
    out[i * 4 + 2] = buf[k + 2];
    out[i * 4 + 3] = buf[k + 3];
  };
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    let done = false;
    for (let d = 1; d < w && !done; d++) {
      if (usable(x - d, y)) {
        copy(i, x - d, y);
        done = true;
      } else if (usable(x + d, y)) {
        copy(i, x + d, y);
        done = true;
      }
    }
    for (let d = 1; d < h && !done; d++) {
      if (usable(x, y - d)) {
        copy(i, x, y - d);
        done = true;
      } else if (usable(x, y + d)) {
        copy(i, x, y + d);
        done = true;
      }
    }
  }
  return out;
}

/** 새로 채운 픽셀 중 바깥(투명)과 맞닿은 곳을 외곽선 색으로 → 원래 그림처럼 테두리가 생김 */
function ringOutline(buf: Uint8ClampedArray, w: number, h: number, region: Uint8Array, outline: Color): Uint8ClampedArray {
  const out = cloneBuffer(buf);
  const [r, g, b] = unpackColor(outline);
  for (let i = 0; i < w * h; i++) {
    if (!region[i] || buf[i * 4 + 3] === 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const open = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx < 0 || ny < 0 || nx >= w || ny >= h || buf[(ny * w + nx) * 4 + 3] === 0;
    });
    if (!open) continue;
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 부위 라벨 → 부위별 그림 */
export function buildParts(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  j: RigJoints,
  labels: Int8Array,
  opts: BuildOptions = DEFAULT_BUILD,
  geo = partGeometry(buf, w, h, j),
): BuiltParts {
  const parts = {} as Record<RigPartId, Uint8ClampedArray>;
  const outlineColor = detectOutlineColor(buf, w, h);
  const live = opts.liveOutline && outlineColor !== null ? detectOutlineStyle(buf, w, h, outlineColor) : null;
  RIG_PARTS.forEach((part, li) => {
    const out = createBuffer(w, h);
    for (let i = 0; i < w * h; i++) {
      if (labels[i] !== li) continue;
      const k = i * 4;
      out[k] = buf[k];
      out[k + 1] = buf[k + 1];
      out[k + 2] = buf[k + 2];
      out[k + 3] = buf[k + 3];
    }
    parts[part] = live ? stripOuterOutline(out, w, h, live.color) : out;
  });

  // 가려진 곳 채우기: 앞 부위에 덮여 있던 자리를 그 부위 모양대로 메우고 외곽선을 둘러 줌
  //  (팔을 앞으로 흔들면 몸통 앞쪽이 잘려 보이지 않게, 다리를 들면 허벅지 윗부분이 비지 않게)
  if (opts.fillHoles) {
    const outline = outlineColor;
    const complete = (part: RigPartId, front: RigPartId[]) => {
      const covered = maskOf(labels, front);
      const region = new Uint8Array(w * h);
      let any = false;
      for (let i = 0; i < w * h; i++) {
        if (!covered[i] || parts[part][i * 4 + 3] > 0) continue;
        if (!insidePart(geo, part, (i % w) + 0.5, ((i / w) | 0) + 0.5)) continue;
        region[i] = 1;
        any = true;
      }
      // 몸통처럼 양옆이 감싸인 구멍은 기존 방식으로도 찾기
      const holes = holeMask(parts[part], w, h, covered, Math.max(4, Math.round(geo.radius.torso * 2.5)));
      for (let i = 0; i < w * h; i++) {
        if (!holes[i]) continue;
        region[i] = 1;
        any = true;
      }
      if (!any) return;
      let filled = outline !== null ? fillFromRows(parts[part], w, h, region, outline) : inpaint(parts[part], w, h, region);
      // 살아 있는 외곽선이면 효과가 테두리를 그려 주므로 여기서는 안 그림
      if (outline !== null && !live) filled = ringOutline(filled, w, h, region, outline);
      parts[part] = filled;
    };
    complete('torso', inFrontOfTorso(opts.view ?? 'side'));
  }

  // 뒤쪽 팔다리: 가려져 안 보이던 부분을 앞쪽 팔다리 모양을 본떠 (어둡게) 채움. 보이던 픽셀은 그대로.
  if (opts.rebuildBackLimbs) {
    const palette = uniqueColors(buf, 256);
    const rebuild = (frontParts: [RigPartId, RigPartId], backParts: [RigPartId, RigPartId]) => {
      const frontArea = countSolid(parts[frontParts[0]]) + countSolid(parts[frontParts[1]]);
      if (frontArea === 0) return;
      backParts.forEach((bp, k) => {
        const fp = frontParts[k];
        const [fa, fb] = PART_BONE[fp];
        const [ba, bb] = PART_BONE[bp];
        const m = alignMatrix(j[fa], j[fb], j[ba], j[bb]);
        const moved = darken(transformBuffer(parts[fp], w, h, m, 'rotsprite'), w, h, palette);
        // 원래 보이던 픽셀은 그대로 두고, 빈 곳만 채움
        const own = parts[bp];
        for (let i = 0; i < own.length; i += 4) {
          if (own[i + 3] > 0 || moved[i + 3] === 0) continue;
          own[i] = moved[i];
          own[i + 1] = moved[i + 1];
          own[i + 2] = moved[i + 2];
          own[i + 3] = moved[i + 3];
        }
      });
    };
    rebuild(['upperArmF', 'foreArmF'], ['upperArmB', 'foreArmB']);
    rebuild(['thighF', 'shinF'], ['thighB', 'shinB']);
  }

  // 관절 덮개: 아래쪽 부위에 윗부분 픽셀을 관절 주변만큼 복사 → 굽혀도 틈이 안 생김
  const cap = (child: RigPartId, parent: RigPartId, joint: Point) => {
    const r = Math.max(1.5, geo.radius[parent] * 0.9);
    const src = parts[parent];
    const dst = parts[child];
    for (let y = Math.floor(joint.y - r - 1); y <= joint.y + r + 1; y++) {
      for (let x = Math.floor(joint.x - r - 1); x <= joint.x + r + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (Math.hypot(x + 0.5 - joint.x, y + 0.5 - joint.y) > r) continue;
        const k = (y * w + x) * 4;
        if (src[k + 3] === 0 || dst[k + 3] > 0) continue;
        dst[k] = src[k];
        dst[k + 1] = src[k + 1];
        dst[k + 2] = src[k + 2];
        dst[k + 3] = src[k + 3];
      }
    }
  };
  cap('foreArmF', 'upperArmF', j.elbowF);
  cap('foreArmB', 'upperArmB', j.elbowB);
  cap('shinF', 'thighF', j.kneeF);
  cap('shinB', 'thighB', j.kneeB);

  // 부위 안에 갇힌 작은 빈 곳은 메움 (외곽선 효과가 구멍 둘레에 테두리를 그리지 않게)
  if (outlineColor !== null) {
    for (const part of RIG_PARTS) parts[part] = fillEnclosedHoles(parts[part], w, h, outlineColor);
  }
  // 위에서 일부 그림을 그 자리에서 고쳤으므로(관절 덮개 등) 새 버퍼로 넘겨 줌
  // → 중간에 계산해 둔 회전 캐시(RotSprite 확대본)가 예전 그림을 쓰지 않게
  for (const part of RIG_PARTS) parts[part] = cloneBuffer(parts[part]);
  return { parts, outline: live };
}

/** 바깥과 이어지지 않은(갇힌) 투명 영역 중 작은 것을 주변 색으로 채움 */
export function fillEnclosedHoles(buf: Uint8ClampedArray, w: number, h: number, outline: Color, maxSize = 40): Uint8ClampedArray {
  const solidCount = countSolid(buf);
  if (solidCount === 0) return buf;
  const seen = new Uint8Array(w * h);
  const region = new Uint8Array(w * h);
  let any = false;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || buf[s * 4 + 3] > 0) continue;
    const comp: number[] = [];
    let touchesBorder = false;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      comp.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (seen[k] || buf[k * 4 + 3] > 0) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    if (touchesBorder || comp.length > Math.min(maxSize, solidCount * 0.15)) continue;
    for (const i of comp) region[i] = 1;
    any = true;
  }
  return any ? fillFromRows(buf, w, h, region, outline) : buf;
}

/* ------------------------------------------------------------------ */
/* 4) 프로젝트에 리그 만들기                                              */
/* ------------------------------------------------------------------ */

export interface RigResult {
  rigId: string;
  groupId: string;
  bones: Record<RigPartId | 'root', string>;
  layers: Record<RigPartId, string>;
}

export interface CreateRigOptions extends BuildOptions {
  facing: 1 | -1;
  view: 'side' | 'front';
  /** 레이어 이름 (번역된 부위 이름) */
  names: Record<RigPartId | RigGroupId | 'group', string>;
}

/** 팔·다리 묶음 (안의 두 부위를 하나의 외곽선으로) */
export type RigGroupId = 'armF' | 'armB' | 'legF' | 'legB';

type RigSlot = { group?: RigGroupId; parts: RigPartId[] };

/**
 * 그리는 순서 (아래 → 위) + 묶음
 *  옆모습: 뒤팔 → 뒷다리 → 앞다리 → 몸통 → 머리 → 앞팔
 *  앞모습: 두 다리 → 몸통 → 두 팔 → 머리 (팔은 둘 다 몸 앞/옆에 있음)
 */
export function rigStack(view: 'side' | 'front'): RigSlot[] {
  if (view === 'front') {
    return [
      { group: 'legB', parts: ['thighB', 'shinB'] },
      { group: 'legF', parts: ['thighF', 'shinF'] },
      { parts: ['torso'] },
      { group: 'armB', parts: ['upperArmB', 'foreArmB'] },
      { group: 'armF', parts: ['upperArmF', 'foreArmF'] },
      { parts: ['head'] },
    ];
  }
  return [
    { group: 'armB', parts: ['upperArmB', 'foreArmB'] },
    { group: 'legB', parts: ['thighB', 'shinB'] },
    { group: 'legF', parts: ['thighF', 'shinF'] },
    { parts: ['torso'] },
    { parts: ['head'] },
    { group: 'armF', parts: ['upperArmF', 'foreArmF'] },
  ];
}

/** 이 순서에서 몸통보다 위(앞)에 그려지는 부위들 */
function inFrontOfTorso(view: 'side' | 'front'): RigPartId[] {
  const flat = rigStack(view).flatMap((s) => s.parts);
  return flat.slice(flat.indexOf('torso') + 1);
}

function outlineEffect(style: OutlineStyle): Effect {
  return {
    id: uid('fx'),
    type: 'outline',
    enabled: true,
    params: { color: colorToHex(style.color, true), thickness: 1, position: 'outside', diagonal: style.diagonal, auto: false },
  };
}

/**
 * 원본 레이어의 frameIndex 그림으로 리그를 만들어 프로젝트에 넣습니다.
 * 원본 레이어는 숨겨 둡니다. (지우지 않음 → 언제든 되돌리기 가능)
 */
export function createRig(
  p: Project,
  sourceLayerId: string,
  frameIndex: number,
  points: RigPoints,
  opts: CreateRigOptions,
  labelsOverride?: Int8Array,
): RigResult | null {
  const src = findLayer(p, sourceLayerId);
  const frame = p.frames[frameIndex];
  if (!src || !frame) return null;
  const buf = p.cels[`${src.id}|${frame.id}`];
  if (!buf) return null;
  const { width: w, height: h } = p;
  const joints = planJoints(buf, w, h, points, opts.view);
  const geo = partGeometry(buf, w, h, joints);
  const labels = labelsOverride ?? segmentParts(buf, w, h, joints, geo);
  const { parts, outline } = buildParts(buf, w, h, joints, labels, { ...opts, view: opts.view }, geo);
  const bounds = contentBounds(buf, w, h);
  const rigId = uid('rig');

  // 뼈
  const bones = {} as Record<RigPartId | 'root', string>;
  const root = createBone(p, joints.pelvis.x, joints.pelvis.y, 0, 2, null, opts.names.torso);
  root.name = `${opts.names.group} · root`;
  root.rig = { rigId, part: 'root', height: bounds?.h ?? h, facing: opts.facing, view: opts.view };
  p.bones.push(root);
  bones.root = root.id;
  const order: RigPartId[] = ['torso', 'head', 'upperArmF', 'foreArmF', 'upperArmB', 'foreArmB', 'thighF', 'shinF', 'thighB', 'shinB'];
  for (const part of order) {
    const [a, b] = PART_BONE[part];
    const pa = joints[a];
    const pb = joints[b];
    const parent = PART_PARENT[part];
    const bone: Bone = createBone(
      p,
      pa.x,
      pa.y,
      (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI,
      Math.max(1, Math.hypot(pb.x - pa.x, pb.y - pa.y)),
      bones[parent],
      opts.names[part],
    );
    bone.rig = { rigId, part };
    p.bones.push(bone);
    bones[part] = bone.id;
  }

  // 그룹 + 부위 레이어 (원본 바로 위). 팔·다리는 묶음 안에 넣고, 외곽선 효과는 묶음/몸통/머리에
  let at = layerIndex(p, src.id) + 1;
  const group = addLayer(p, at++, opts.names.group, 'group', src.parentId);
  root.rig.groupId = group.id;
  const layers = {} as Record<RigPartId, string>;
  for (const slot of rigStack(opts.view)) {
    let parent = group.id;
    if (slot.group) {
      const sub = addLayer(p, at++, opts.names[slot.group], 'group', group.id);
      sub.expanded = false;
      if (outline) sub.effects = [outlineEffect(outline)];
      parent = sub.id;
    }
    for (const part of slot.parts) {
      const layer: Layer = addLayer(p, at++, opts.names[part], 'pixel', parent);
      layer.bind = { boneId: bones[part], mode: 'rigid', meshCols: 4, meshRows: 4, method: 'rotsprite' };
      if (outline && !slot.group) layer.effects = [outlineEffect(outline)];
      p.cels[`${layer.id}|${frame.id}`] = parts[part];
      layers[part] = layer.id;
    }
  }
  src.visible = false;
  return { rigId, groupId: group.id, bones, layers };
}

/** 프로젝트 안의 리그 찾기 (동작 템플릿을 다시 적용할 때) */
export function findRig(p: Project, rigId?: string): { rigId: string; root: Bone; bones: Partial<Record<RigPartId, Bone>> } | null {
  const root = p.bones.find((b) => b.rig?.part === 'root' && (!rigId || b.rig.rigId === rigId));
  if (!root?.rig) return null;
  const bones: Partial<Record<RigPartId, Bone>> = {};
  for (const b of p.bones) if (b.rig?.rigId === root.rig.rigId && b.rig.part !== 'root') bones[b.rig.part as RigPartId] = b;
  return { rigId: root.rig.rigId, root, bones };
}

/** 미리보기용: 부위마다 다른 색 */
export const PART_COLORS: Record<RigPartId, string> = {
  torso: '#4cc9f0',
  head: '#ffd166',
  upperArmF: '#ff6b6b',
  foreArmF: '#f78c6b',
  upperArmB: '#b388ff',
  foreArmB: '#c77dff',
  thighF: '#06d6a0',
  shinF: '#7bdff2',
  thighB: '#8d99ae',
  shinB: '#adb5bd',
};

/** 미리보기 색 칠하기 (원래 그림 위에 반투명 부위 색) */
export function labelOverlay(buf: Uint8ClampedArray, labels: Int8Array, colors: Record<RigPartId, Color>, amount = 0.55): Uint8ClampedArray {
  const out = cloneBuffer(buf);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    const [r, g, b] = unpackColor(colors[RIG_PARTS[labels[i]]]);
    const k = i * 4;
    out[k] = out[k] * (1 - amount) + r * amount;
    out[k + 1] = out[k + 1] * (1 - amount) + g * amount;
    out[k + 2] = out[k + 2] * (1 - amount) + b * amount;
  }
  return out;
}
