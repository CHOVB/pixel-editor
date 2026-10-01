/**
 * 뼈대(본) 애니메이션
 * ------------------------------------------------------------
 * 캐릭터를 파츠(머리, 몸, 팔, 다리...)로 나누고 뼈를 연결하면,
 * 뼈만 움직여도 그림이 따라 움직입니다. (PixelOver 의 핵심 기능)
 *
 *  - 정방향 운동학(FK): 부모 뼈가 돌면 자식 뼈가 따라 돎
 *  - 역운동학(IK): 손끝을 끌면 팔 전체가 알맞게 굽혀짐 (CCD 알고리즘)
 *  - 연결 방식
 *     rigid(통째로): 레이어가 뼈 하나를 그대로 따라감 (머리, 무기 등)
 *     mesh(휘어짐): 레이어를 격자로 나누고 여러 뼈의 영향을 섞어 휘게 함 (팔꿈치, 꼬리 등)
 *  - 결과는 픽셀 단위로 정확히 계산(최근접 샘플링)해서 도트가 흐려지지 않습니다.
 */
import { apply, compose, invert, matKey, rotateDeg, scale, translate, type Mat, multiply } from './affine';
import { ease, LINEAR } from './easing';
import { contentBounds, createBuffer } from './pixels';
import { transformBuffer } from './resample';
import type { Bone, BoneKey, Layer, Point, Project } from './types';
import { uid } from './project';

export const BONE_COLORS = ['#ffd166', '#4cc9f0', '#ff6b6b', '#06d6a0', '#b388ff', '#f78c6b'];

export interface BonePose {
  rotation: number;
  x: number;
  y: number;
  scale: number;
}

export const REST_POSE: BonePose = { rotation: 0, x: 0, y: 0, scale: 1 };

export function createBone(p: Project, x: number, y: number, rotation: number, length: number, parentId: string | null, name?: string): Bone {
  return {
    id: uid('bone'),
    name: name ?? `Bone ${p.bones.length + 1}`,
    parentId,
    x,
    y,
    rotation,
    length,
    color: BONE_COLORS[p.bones.length % BONE_COLORS.length],
    keys: [],
  };
}

export function findBone(p: Project, id: string | null | undefined): Bone | undefined {
  if (!id) return undefined;
  return p.bones.find((b) => b.id === id);
}

export function boneChildren(p: Project, id: string | null): Bone[] {
  return p.bones.filter((b) => b.parentId === id);
}

/** 뼈와 그 아래 모든 자식 뼈의 id */
export function boneDescendants(p: Project, id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const b of p.bones) {
      if (b.parentId === pid) {
        out.push(b.id);
        walk(b.id);
      }
    }
  };
  walk(id);
  return out;
}

/* ------------------------------------------------------------------ */
/* 기본 자세(rest) 와 키프레임                                           */
/* ------------------------------------------------------------------ */

/** 기본 자세에서 뼈의 월드 행렬 (시작점으로 이동 + 방향 회전) */
export function restWorld(b: Bone): Mat {
  return multiply(translate(b.x, b.y), rotateDeg(b.rotation));
}

function restLocal(p: Project, b: Bone): Mat {
  const parent = findBone(p, b.parentId);
  if (!parent) return restWorld(b);
  return multiply(invert(restWorld(parent)), restWorld(b));
}

function orderedBoneKeys(p: Project, b: Bone): { index: number; key: BoneKey }[] {
  const indexOf = new Map(p.frames.map((f, i) => [f.id, i]));
  return b.keys
    .map((key) => ({ index: indexOf.get(key.frameId) ?? -1, key }))
    .filter((k) => k.index >= 0)
    .sort((a, c) => a.index - c.index);
}

/** frameIndex 에서 이 뼈의 자세 (키프레임 사이는 이징으로 보간) */
export function evaluateBone(p: Project, b: Bone, frameIndex: number): BonePose {
  const keys = orderedBoneKeys(p, b);
  if (keys.length === 0) return { ...REST_POSE };
  const pick = (k: BoneKey): BonePose => ({ rotation: k.rotation, x: k.x, y: k.y, scale: k.scale });
  if (frameIndex <= keys[0].index) return pick(keys[0].key);
  if (frameIndex >= keys[keys.length - 1].index) return pick(keys[keys.length - 1].key);
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].index <= frameIndex) i++;
  const a = keys[i];
  const c = keys[i + 1];
  const t = ease(a.key.ease, (frameIndex - a.index) / (c.index - a.index));
  return {
    rotation: a.key.rotation + (c.key.rotation - a.key.rotation) * t,
    x: a.key.x + (c.key.x - a.key.x) * t,
    y: a.key.y + (c.key.y - a.key.y) * t,
    scale: a.key.scale + (c.key.scale - a.key.scale) * t,
  };
}

export function boneKeyAt(b: Bone, frameId: string): BoneKey | undefined {
  return b.keys.find((k) => k.frameId === frameId);
}

export function setBoneKey(b: Bone, frameId: string, pose: BonePose): BoneKey {
  const existing = boneKeyAt(b, frameId);
  if (existing) {
    existing.rotation = pose.rotation;
    existing.x = pose.x;
    existing.y = pose.y;
    existing.scale = pose.scale;
    return existing;
  }
  const key: BoneKey = { frameId, ...pose, ease: { ...LINEAR } };
  b.keys.push(key);
  return key;
}

export function removeBoneKey(b: Bone, frameId: string): boolean {
  const before = b.keys.length;
  b.keys = b.keys.filter((k) => k.frameId !== frameId);
  return b.keys.length !== before;
}

/* ------------------------------------------------------------------ */
/* 정방향 운동학 (FK)                                                    */
/* ------------------------------------------------------------------ */

export type PoseOverrides = Map<string, BonePose>;

/**
 * 모든 뼈의 "현재 자세" 월드 행렬.
 * overrides 를 주면 키프레임 대신 그 자세를 사용합니다. (IK 계산, 드래그 미리보기용)
 */
export function poseWorld(p: Project, frameIndex: number, overrides?: PoseOverrides): Map<string, Mat> {
  const out = new Map<string, Mat>();
  const visit = (b: Bone, parentMat: Mat | null, depth: number) => {
    if (depth > 64) return;
    const pose = overrides?.get(b.id) ?? evaluateBone(p, b, frameIndex);
    const local = compose(restLocal(p, b), translate(pose.x, pose.y), rotateDeg(pose.rotation), scale(pose.scale, 1));
    const world = parentMat ? multiply(parentMat, local) : local;
    out.set(b.id, world);
    for (const c of boneChildren(p, b.id)) visit(c, world, depth + 1);
  };
  for (const root of p.bones.filter((b) => !b.parentId || !findBone(p, b.parentId))) visit(root, null, 0);
  return out;
}

/** 스키닝 행렬: 기본 자세의 점 → 현재 자세의 점 */
export function skinMatrices(p: Project, frameIndex: number, overrides?: PoseOverrides): Map<string, Mat> {
  const world = poseWorld(p, frameIndex, overrides);
  const out = new Map<string, Mat>();
  for (const b of p.bones) {
    const w = world.get(b.id);
    if (w) out.set(b.id, multiply(w, invert(restWorld(b))));
  }
  return out;
}

/** 현재 자세에서 뼈의 시작점과 끝점 */
export function boneEndpoints(world: Mat, b: Bone): { head: Point; tail: Point } {
  return { head: apply(world, 0, 0), tail: apply(world, b.length, 0) };
}

/* ------------------------------------------------------------------ */
/* 역운동학 (IK, CCD 방식)                                                */
/* ------------------------------------------------------------------ */

/**
 * endBone 의 끝점이 target 에 닿도록 chainLength 개의 뼈(자기 + 부모들)를 회전시킵니다.
 * 결과: 뼈 id → 새 자세
 */
export function solveIK(p: Project, frameIndex: number, endBoneId: string, target: Point, chainLength = 2, iterations = 16): PoseOverrides {
  const overrides: PoseOverrides = new Map();
  for (const b of p.bones) overrides.set(b.id, evaluateBone(p, b, frameIndex));
  const chain: Bone[] = [];
  let cur = findBone(p, endBoneId);
  while (cur && chain.length < chainLength) {
    chain.push(cur);
    cur = findBone(p, cur.parentId);
  }
  const end = chain[0];
  if (!end) return overrides;
  for (let it = 0; it < iterations; it++) {
    for (const bone of chain) {
      const world = poseWorld(p, frameIndex, overrides);
      const endTip = boneEndpoints(world.get(end.id) as Mat, end).tail;
      const origin = apply(world.get(bone.id) as Mat, 0, 0);
      const a1 = Math.atan2(endTip.y - origin.y, endTip.x - origin.x);
      const a2 = Math.atan2(target.y - origin.y, target.x - origin.x);
      let delta = ((a2 - a1) * 180) / Math.PI;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      const pose = overrides.get(bone.id) as BonePose;
      overrides.set(bone.id, { ...pose, rotation: pose.rotation + delta });
    }
    const world = poseWorld(p, frameIndex, overrides);
    const tip = boneEndpoints(world.get(end.id) as Mat, end).tail;
    if (Math.hypot(tip.x - target.x, tip.y - target.y) < 0.5) break;
  }
  return overrides;
}

/* ------------------------------------------------------------------ */
/* 레이어 변형 (rigid / mesh)                                             */
/* ------------------------------------------------------------------ */

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** mesh 모드에서 영향을 줄 뼈들: 연결된 뼈 + 부모 + 자식 */
function influenceBones(p: Project, boneId: string): Bone[] {
  const b = findBone(p, boneId);
  if (!b) return [];
  const set = new Map<string, Bone>([[b.id, b]]);
  const parent = findBone(p, b.parentId);
  if (parent) set.set(parent.id, parent);
  for (const c of boneChildren(p, b.id)) set.set(c.id, c);
  return Array.from(set.values());
}

/** 이 레이어가 이 프레임에서 변형되어야 하면 캐시 키를, 아니면 null 을 돌려줍니다. */
export function bindingKey(p: Project, layer: Layer, frameIndex: number): string | null {
  const bind = layer.bind;
  if (!bind || !bind.boneId || !findBone(p, bind.boneId)) return null;
  const skins = skinMatrices(p, frameIndex);
  const bones = bind.mode === 'mesh' ? influenceBones(p, bind.boneId) : [findBone(p, bind.boneId) as Bone];
  let key = `${bind.mode}:${bind.meshCols}x${bind.meshRows}`;
  let allIdentity = true;
  for (const b of bones) {
    const m = skins.get(b.id);
    if (!m) continue;
    const k = matKey(m);
    if (k !== '1,0,0,1,0,0') allIdentity = false;
    key += `|${b.id}:${k}:${b.x},${b.y},${b.rotation},${b.length}`;
  }
  return allIdentity ? null : key;
}

/** 삼각형 하나를 최근접 샘플링으로 그립니다. (dst 삼각형 d0~d2 ← src 삼각형 s0~s2) */
function rasterTriangle(
  src32: Uint32Array,
  out32: Uint32Array,
  w: number,
  h: number,
  d0: Point,
  d1: Point,
  d2: Point,
  s0: Point,
  s1: Point,
  s2: Point,
): void {
  const minX = Math.max(0, Math.floor(Math.min(d0.x, d1.x, d2.x)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(d0.x, d1.x, d2.x)));
  const minY = Math.max(0, Math.floor(Math.min(d0.y, d1.y, d2.y)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(d0.y, d1.y, d2.y)));
  const den = (d1.y - d2.y) * (d0.x - d2.x) + (d2.x - d1.x) * (d0.y - d2.y);
  if (Math.abs(den) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5;
      const a = ((d1.y - d2.y) * (cx - d2.x) + (d2.x - d1.x) * (cy - d2.y)) / den;
      const b = ((d2.y - d0.y) * (cx - d2.x) + (d0.x - d2.x) * (cy - d2.y)) / den;
      const c = 1 - a - b;
      if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
      const sx = Math.floor(a * s0.x + b * s1.x + c * s2.x);
      const sy = Math.floor(a * s0.y + b * s1.y + c * s2.y);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const v = src32[sy * w + sx];
      if (v >>> 24 === 0) continue; // 투명 픽셀은 건너뜀 (Uint32 의 최상위 바이트가 알파)
      out32[y * w + x] = v;
    }
  }
}

export interface MeshGrid {
  cols: number;
  rows: number;
  /** 기본 자세 꼭짓점 */
  points: Point[];
}

export function buildMesh(src: Uint8ClampedArray, w: number, h: number, cols: number, rows: number): MeshGrid | null {
  const bounds = contentBounds(src, w, h);
  if (!bounds) return null;
  const x0 = bounds.x - 1;
  const y0 = bounds.y - 1;
  const bw = bounds.w + 2;
  const bh = bounds.h + 2;
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  const points: Point[] = [];
  for (let j = 0; j <= r; j++) {
    for (let i = 0; i <= c; i++) points.push({ x: x0 + (bw * i) / c, y: y0 + (bh * j) / r });
  }
  return { cols: c, rows: r, points };
}

/** 꼭짓점별 뼈 가중치 (가까운 뼈일수록 크게, 최대 2개) */
export function meshWeights(mesh: MeshGrid, bones: Bone[]): { boneId: string; w: number }[][] {
  return mesh.points.map((pt) => {
    const ds = bones.map((b) => {
      const tail = apply(restWorld(b), b.length, 0);
      return { boneId: b.id, d: distToSegment(pt.x, pt.y, b.x, b.y, tail.x, tail.y) };
    });
    ds.sort((a, c) => a.d - c.d);
    const top = ds.slice(0, 2);
    const raw = top.map((t) => ({ boneId: t.boneId, w: 1 / (t.d * t.d + 4) }));
    const sum = raw.reduce((s, t) => s + t.w, 0) || 1;
    return raw.map((t) => ({ boneId: t.boneId, w: t.w / sum }));
  });
}

/** 레이어 픽셀에 뼈대 변형을 적용합니다. */
export function applyBinding(p: Project, layer: Layer, frameIndex: number, src: Uint8ClampedArray): Uint8ClampedArray {
  const bind = layer.bind;
  if (!bind || !bind.boneId) return src;
  const w = p.width;
  const h = p.height;
  const skins = skinMatrices(p, frameIndex);
  if (bind.mode === 'rigid') {
    const m = skins.get(bind.boneId);
    return m ? transformBuffer(src, w, h, m, 'nearest') : src;
  }
  const bones = influenceBones(p, bind.boneId);
  const mesh = buildMesh(src, w, h, bind.meshCols, bind.meshRows);
  if (!mesh || bones.length === 0) return src;
  const weights = meshWeights(mesh, bones);
  const moved = mesh.points.map((pt, i) => {
    let x = 0;
    let y = 0;
    for (const { boneId, w: wt } of weights[i]) {
      const m = skins.get(boneId);
      const q = m ? apply(m, pt.x, pt.y) : pt;
      x += q.x * wt;
      y += q.y * wt;
    }
    return { x, y };
  });
  const out = createBuffer(w, h);
  const out32 = new Uint32Array(out.buffer);
  const src32 = src.byteOffset % 4 === 0 ? new Uint32Array(src.buffer, src.byteOffset, src.byteLength / 4) : new Uint32Array(src.slice().buffer);
  const stride = mesh.cols + 1;
  for (let j = 0; j < mesh.rows; j++) {
    for (let i = 0; i < mesh.cols; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      rasterTriangle(src32, out32, w, h, moved[a], moved[b], moved[c], mesh.points[a], mesh.points[b], mesh.points[c]);
      rasterTriangle(src32, out32, w, h, moved[b], moved[d], moved[c], mesh.points[b], mesh.points[d], mesh.points[c]);
    }
  }
  return out;
}
