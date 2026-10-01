/**
 * 자동 애니메이션 도우미 (마법사 화면이 쓰는 계산들)
 * ------------------------------------------------------------
 *  - guessRigPoints : 그림 모양만 보고 점 7개를 자동으로 찍어 줌 (사용자는 살짝 고치기만)
 *  - guessView      : 좌우 대칭이면 앞모습, 아니면 옆모습으로 추측
 *  - previewMotion  : 실제 프로젝트를 건드리지 않고 "시험용 프로젝트"에서 동작을 만들어 미리보기
 *  - neededRoom     : 점프처럼 캔버스 밖으로 나가는 동작에 필요한 여백
 */
import { contentBounds, createBuffer, resizeBuffer } from './pixels';
import { createProject } from './project';
import { compositeFrame } from './render';
import { createRig, RIG_PARTS, type BuildOptions, type RigGroupId, type RigPartId, type RigPoints } from './autoRig';
import { applyMotion, type MotionId, type MotionOptions } from './motionTemplates';
import type { Point, Project, Rect } from './types';

export interface AutoAnimSetup {
  points: RigPoints;
  facing: 1 | -1;
  view: 'side' | 'front';
  build: BuildOptions;
  /** 사용자가 고친 부위 라벨 (없으면 자동) */
  labels?: Int8Array;
}

/** 그림 모양에서 점 7개 추측 */
export function guessRigPoints(buf: Uint8ClampedArray, w: number, h: number, facing: 1 | -1 = 1): RigPoints | null {
  const b = contentBounds(buf, w, h);
  if (!b || b.h < 6) return null;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3] > 0;
  const band = (t0: number, t1: number) => {
    const ya = Math.floor(b.y + b.h * t0);
    const yb = Math.max(ya, Math.floor(b.y + b.h * t1));
    let sx = 0;
    let sy = 0;
    let n = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minAt: Point = { x: 0, y: 0 };
    let maxAt: Point = { x: 0, y: 0 };
    for (let y = ya; y <= yb; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (!solid(x, y)) continue;
        sx += x + 0.5;
        sy += y + 0.5;
        n++;
        // 가장 바깥 열에서는 가장 아래 픽셀 (소매 끝이 아니라 손 쪽)
        if (x < minX || (x === minX && y + 0.5 > minAt.y)) [minX, minAt] = [x, { x: x + 0.5, y: y + 0.5 }];
        if (x > maxX || (x === maxX && y + 0.5 > maxAt.y)) [maxX, maxAt] = [x, { x: x + 0.5, y: y + 0.5 }];
      }
    }
    return { cx: n ? sx / n : b.x + b.w / 2, cy: n ? sy / n : (ya + yb) / 2, minAt, maxAt, n };
  };
  const head = band(0, 0.22);
  const neck = band(0.27, 0.32);
  const hips = band(0.58, 0.66);
  const hands = band(0.42, 0.68);
  // 발: 맨 아래 띠를 왼쪽/오른쪽 두 덩어리로
  const footY = Math.floor(b.y + b.h - Math.max(1, b.h * 0.06));
  const xs: number[] = [];
  for (let y = Math.floor(b.y + b.h * 0.9); y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (solid(x, y)) xs.push(x + 0.5);
  xs.sort((p, q) => p - q);
  let split = xs.length ? xs[xs.length >> 1] : b.x + b.w / 2;
  let gap = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap) {
      gap = xs[i] - xs[i - 1];
      split = (xs[i] + xs[i - 1]) / 2;
    }
  }
  const left = xs.filter((x) => x < split);
  const right = xs.filter((x) => x >= split);
  const avg = (a: number[], fallback: number) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : fallback);
  const footL: Point = { x: avg(left, b.x + b.w * 0.35), y: footY };
  const footR: Point = { x: avg(right, b.x + b.w * 0.65), y: footY };
  const handL: Point = { x: hands.minAt.x + 1, y: hands.minAt.y };
  const handR: Point = { x: hands.maxAt.x - 1, y: hands.maxAt.y };
  const front = facing === 1;
  return {
    head: { x: head.cx, y: head.cy },
    neck: { x: neck.cx, y: neck.cy },
    pelvis: { x: hips.cx, y: b.y + b.h * 0.62 },
    handF: front ? handR : handL,
    handB: front ? handL : handR,
    footF: front ? footR : footL,
    footB: front ? footL : footR,
  };
}

/**
 * 좌우로 뒤집어도 모양과 색이 거의 같으면 앞모습
 * (옆모습은 모양이 대칭이어도 한쪽은 머리카락, 한쪽은 얼굴처럼 색이 다름)
 */
export function symmetryScore(buf: Uint8ClampedArray, w: number, h: number): number {
  const b = contentBounds(buf, w, h);
  if (!b) return 0;
  let same = 0;
  let total = 0;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const mx = b.x + b.w - 1 - (x - b.x);
      const i = (y * w + x) * 4;
      const j = (y * w + mx) * 4;
      const a = buf[i + 3] > 0;
      const m = buf[j + 3] > 0;
      if (!a && !m) continue;
      total++;
      if (a && m && Math.abs(buf[i] - buf[j]) + Math.abs(buf[i + 1] - buf[j + 1]) + Math.abs(buf[i + 2] - buf[j + 2]) < 60) same++;
    }
  }
  return total > 0 ? same / total : 0;
}

export function guessView(buf: Uint8ClampedArray, w: number, h: number): 'side' | 'front' {
  return symmetryScore(buf, w, h) > 0.72 ? 'front' : 'side';
}

const SANDBOX_NAMES = Object.fromEntries([...RIG_PARTS, 'group', 'armF', 'armB', 'legF', 'legB'].map((k) => [k, k])) as Record<
  RigPartId | RigGroupId | 'group',
  string
>;

export interface MotionPreview {
  frames: Uint8ClampedArray[];
  durations: number[];
  /** 여백을 붙인 미리보기 크기 */
  width: number;
  height: number;
  /** 원래 캔버스가 미리보기 안에서 놓인 위치 */
  offsetX: number;
  offsetY: number;
  /** 모든 프레임의 그림이 차지하는 영역 (미리보기 좌표) */
  bounds: Rect | null;
}

/**
 * 시험용 프로젝트에서 동작을 만들어 그려 봅니다. (실제 작업에는 영향 없음)
 * pad: 캔버스 둘레에 붙일 여백 비율 (점프가 잘리지 않게 보려고)
 */
export function previewMotion(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  setup: AutoAnimSetup,
  motion: MotionId,
  opts: MotionOptions,
  pad = 0.5,
): MotionPreview | null {
  const px = Math.round(w * pad);
  const py = Math.round(h * pad);
  const W = w + px * 2;
  const H = h + py * 2;
  const p = createProject(W, H);
  p.cels[`${p.layers[0].id}|${p.frames[0].id}`] = resizeBuffer(buf, w, h, W, H, px, py);
  const shift = (q: Point): Point => ({ x: q.x + px, y: q.y + py });
  const pts = Object.fromEntries(Object.entries(setup.points).map(([k, v]) => [k, shift(v)])) as RigPoints;
  let labels: Int8Array | undefined;
  if (setup.labels) {
    labels = new Int8Array(W * H).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[(y + py) * W + x + px] = setup.labels[y * w + x];
  }
  const rig = createRig(p, p.layers[0].id, 0, pts, { ...setup.build, facing: setup.facing, view: setup.view, names: SANDBOX_NAMES }, labels);
  if (!rig) return null;
  const res = applyMotion(p, rig.rigId, motion, 0, opts);
  if (!res) return null;
  const frames = res.frames.map((i) => compositeFrame(p, i));
  return { frames, durations: res.frames.map((i) => p.frames[i].duration), width: W, height: H, offsetX: px, offsetY: py, bounds: unionBounds(frames, W, H) };
}

/** 여러 프레임의 그림을 모두 감싸는 영역 */
function unionBounds(frames: Uint8ClampedArray[], w: number, h: number): Rect | null {
  let bounds: Rect | null = null;
  for (const f of frames) {
    const fb = contentBounds(f, w, h);
    if (!fb) continue;
    if (!bounds) bounds = { ...fb };
    else {
      const x1 = Math.max(bounds.x + bounds.w, fb.x + fb.w);
      const y1 = Math.max(bounds.y + bounds.h, fb.y + fb.h);
      bounds.x = Math.min(bounds.x, fb.x);
      bounds.y = Math.min(bounds.y, fb.y);
      bounds.w = x1 - bounds.x;
      bounds.h = y1 - bounds.y;
    }
  }
  return bounds;
}

/** 이미 리그가 있는 프로젝트: 복사본 끝에 동작을 붙여 미리보기 (원본은 그대로) */
export function previewOnProject(project: Project, rigId: string, motion: MotionId, opts: MotionOptions): MotionPreview | null {
  const p = structuredClone(project) as Project;
  const res = applyMotion(p, rigId, motion, p.frames.length, opts);
  if (!res) return null;
  const frames = res.frames.map((i) => compositeFrame(p, i));
  return {
    frames,
    durations: res.frames.map((i) => p.frames[i].duration),
    width: p.width,
    height: p.height,
    offsetX: 0,
    offsetY: 0,
    bounds: unionBounds(frames, p.width, p.height),
  };
}

/** 동작이 원래 캔버스 밖으로 나가서 잘리는 만큼 (위/아래/왼쪽/오른쪽 픽셀) */
export function neededRoom(prev: MotionPreview, w: number, h: number): { top: number; bottom: number; left: number; right: number } {
  const b = prev.bounds;
  if (!b) return { top: 0, bottom: 0, left: 0, right: 0 };
  const x0 = b.x - prev.offsetX;
  const y0 = b.y - prev.offsetY;
  const x1 = x0 + b.w;
  const y1 = y0 + b.h;
  return {
    top: Math.max(0, -y0),
    left: Math.max(0, -x0),
    bottom: Math.max(0, y1 - h),
    right: Math.max(0, x1 - w),
  };
}

/** 부위 라벨 칠하기 (고치기 붓) */
export function paintLabels(labels: Int8Array, buf: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, radius: number, label: number): boolean {
  let changed = false;
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius * radius + 0.25) continue;
      const i = y * w + x;
      if (buf[i * 4 + 3] === 0 || labels[i] === label) continue;
      labels[i] = label;
      changed = true;
    }
  }
  return changed;
}

/** 빈 버퍼 (미리보기 자리 채우기용) */
export function emptyFrame(w: number, h: number): Uint8ClampedArray {
  return createBuffer(w, h);
}
