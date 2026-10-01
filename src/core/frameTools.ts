/**
 * 프레임 여러 장에 한꺼번에 하는 작업 + 어니언 스킨 대상 고르기
 * ------------------------------------------------------------
 *  - transformCelBuffer: 그림 하나를 이동/뒤집기/회전 (새 버퍼 반환)
 *  - isChangeFrame:      그림이나 움직임이 "바뀌는" 프레임인지 (키프레임, 새 그림)
 *  - onionTargets:       어니언 스킨으로 비춰 볼 앞/뒤 프레임 번호들
 */
import { celKey } from './celKey';
import { createBuffer } from './pixels';
import type { Project } from './types';

export interface CelTransform {
  /** 오른쪽(+) / 아래(+) 로 옮길 픽셀 수 */
  dx: number;
  dy: number;
  /** true 면 밀려난 부분이 반대편에서 다시 나옴 (반복 타일/배경용) */
  wrap: boolean;
  flipH: boolean;
  flipV: boolean;
  /** 시계 방향 회전 각도. 90/270 은 정사각형 캔버스에서만 그대로 맞습니다. */
  rotate: 0 | 90 | 180 | 270;
}

export const NO_TRANSFORM: CelTransform = { dx: 0, dy: 0, wrap: false, flipH: false, flipV: false, rotate: 0 };

export function isIdentityTransform(t: CelTransform): boolean {
  return t.dx === 0 && t.dy === 0 && !t.flipH && !t.flipV && t.rotate === 0;
}

/**
 * 결과의 (x, y) 픽셀이 원본의 어느 픽셀에서 왔는지 거꾸로 계산해서 복사합니다.
 * 순서: 뒤집기 → 회전(가운데 기준) → 이동
 */
export function transformCelBuffer(src: Uint8ClampedArray, w: number, h: number, t: CelTransform): Uint8ClampedArray {
  const out = createBuffer(w, h);
  const mod = (v: number, n: number) => ((v % n) + n) % n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // ③ 이동 되돌리기
      let px = x - t.dx;
      let py = y - t.dy;
      if (t.wrap) {
        px = mod(px, w);
        py = mod(py, h);
      } else if (px < 0 || py < 0 || px >= w || py >= h) continue;
      // ② 회전 되돌리기 (시계 방향 회전의 역 = 반시계)
      let rx = px;
      let ry = py;
      if (t.rotate === 180) {
        rx = w - 1 - px;
        ry = h - 1 - py;
      } else if (t.rotate === 90) {
        // 시계 90°: 원본 (sx, sy) → (h-1-sy, sx).  역: sx = py, sy = h-1-px
        rx = py;
        ry = h - 1 - px;
      } else if (t.rotate === 270) {
        rx = w - 1 - py;
        ry = px;
      }
      if (rx < 0 || ry < 0 || rx >= w || ry >= h) continue;
      // ① 뒤집기 되돌리기
      const sx = t.flipH ? w - 1 - rx : rx;
      const sy = t.flipV ? h - 1 - ry : ry;
      const s = (sy * w + sx) * 4;
      if (src[s + 3] === 0) continue;
      const d = (y * w + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

/**
 * 프레임마다 그림이나 움직임이 "바뀌는지" 한 번에 계산합니다. (프레임 수 × 레이어 수)
 *  - 어떤 레이어든 키프레임(◆)이 있거나
 *  - 뼈 자세 키가 있거나
 *  - 어떤 그림 레이어든 앞 프레임과 다른 그림이 시작되는 프레임
 * 첫 프레임은 항상 true 입니다.
 */
export function changeFrames(p: Project): boolean[] {
  const n = p.frames.length;
  const out = new Array<boolean>(n).fill(false);
  if (n > 0) out[0] = true;
  const index = new Map(p.frames.map((f, i) => [f.id, i]));
  const mark = (frameId: string) => {
    const i = index.get(frameId);
    if (i !== undefined) out[i] = true;
  };
  for (const layer of p.layers) for (const k of layer.anim?.keys ?? []) mark(k.frameId);
  for (const b of p.bones) for (const k of b.keys) mark(k.frameId);
  for (const layer of p.layers) {
    if (layer.kind !== 'pixel') continue;
    const holds = !!(layer.anim && layer.anim.keys.length > 0) || !!layer.bind;
    let shown: Uint8ClampedArray | undefined;
    for (let i = 0; i < n; i++) {
      const own = p.cels[celKey(layer.id, p.frames[i].id)];
      const now = own ?? (holds ? shown : undefined);
      if (i > 0 && now !== shown) out[i] = true;
      shown = now;
    }
  }
  return out;
}

export function isChangeFrame(p: Project, frameIndex: number): boolean {
  return !!changeFrames(p)[frameIndex];
}

export interface OnionTargets {
  /** 가까운 순서 */
  prev: number[];
  next: number[];
}

/**
 * 어니언 스킨으로 보여줄 앞/뒤 프레임.
 * keysOnly=true 면 "바뀌는 프레임"만 골라서 before/after 장 수만큼.
 */
export function onionTargets(p: Project, current: number, before: number, after: number, keysOnly: boolean, wrap: boolean): OnionTargets {
  const n = p.frames.length;
  const changes = keysOnly ? changeFrames(p) : null;
  const pick = (dir: -1 | 1, want: number): number[] => {
    const out: number[] = [];
    if (want <= 0 || n < 2) return out;
    for (let step = 1; step < n && out.length < want; step++) {
      let fi = current + dir * step;
      if (wrap) fi = ((fi % n) + n) % n;
      else if (fi < 0 || fi >= n) break;
      if (fi === current) break;
      if (!changes || changes[fi]) out.push(fi);
    }
    return out;
  };
  return { prev: pick(-1, before), next: pick(1, after) };
}
