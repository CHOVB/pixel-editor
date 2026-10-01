/**
 * 픽셀 변형(이동/회전/크기) 계산
 * ------------------------------------------------------------
 *  - nearest: 가장 가까운 픽셀을 그대로 가져옵니다. 빠르지만 회전하면 계단이 지저분해질 수 있어요.
 *  - rotsprite: 픽셀아트 전용 회전 알고리즘(RotSprite).
 *      1) Scale2x 를 3번 적용해 8배로 "매끄럽게" 키움 (픽셀아트 모양을 살려서 확대)
 *      2) 키운 그림에서 회전된 위치의 픽셀을 골라 원래 크기로 되돌림
 *    → 회전해도 선이 뭉개지지 않고 깔끔하게 유지됩니다.
 *
 * 모든 결과는 "원래 캔버스 크기" 의 새 버퍼입니다. (캔버스 밖으로 나간 부분은 잘림)
 */
import { invert, isIdentity, isIntegerTranslation, type Mat } from './affine';
import { createBuffer, resizeBuffer } from './pixels';
import { bufferVersion } from './versions';

/** Scale2x(EPX) 확대: 픽셀아트의 대각선을 매끄럽게 하면서 2배 확대 */
export function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * 2 * h * 2);
  const ow = w * 2;
  for (let y = 0; y < h; y++) {
    const yUp = y > 0 ? y - 1 : y;
    const yDown = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xL = x > 0 ? x - 1 : x;
      const xR = x < w - 1 ? x + 1 : x;
      const P = src[y * w + x];
      const A = src[yUp * w + x];
      const B = src[y * w + xR];
      const C = src[y * w + xL];
      const D = src[yDown * w + x];
      let e0 = P;
      let e1 = P;
      let e2 = P;
      let e3 = P;
      if (A !== D && C !== B) {
        if (C === A) e0 = A;
        if (A === B) e1 = B;
        if (D === C) e2 = C;
        if (B === D) e3 = D;
      }
      const o = y * 2 * ow + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + ow] = e2;
      out[o + ow + 1] = e3;
    }
  }
  return out;
}

/** 8배 확대 결과 캐시 (같은 그림을 반복 회전할 때 재사용) */
const upscaleCache = new Map<string, Uint32Array>();

function upscale8(src: Uint8ClampedArray, w: number, h: number): Uint32Array {
  const key = `${bufferVersion(src)}:${w}x${h}`;
  const cached = upscaleCache.get(key);
  if (cached) return cached;
  let cur = new Uint32Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
  let cw = w;
  let ch = h;
  for (let i = 0; i < 3; i++) {
    cur = scale2x(cur, cw, ch);
    cw *= 2;
    ch *= 2;
  }
  upscaleCache.set(key, cur);
  if (upscaleCache.size > 24) {
    const first = upscaleCache.keys().next().value;
    if (first !== undefined) upscaleCache.delete(first);
  }
  return cur;
}

/**
 * src 를 행렬 m (원본 좌표 → 결과 좌표) 으로 변형한 새 버퍼를 만듭니다.
 */
export function transformBuffer(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  m: Mat,
  method: 'nearest' | 'rotsprite' = 'nearest',
): Uint8ClampedArray {
  if (isIdentity(m)) return src;
  // 정수 이동만 있으면 단순 복사로 빠르게 처리
  if (isIntegerTranslation(m)) {
    return resizeBuffer(src, w, h, w, h, Math.round(m[4]), Math.round(m[5]));
  }
  const inv = invert(m);
  const out = createBuffer(w, h);
  const out32 = new Uint32Array(out.buffer);
  if (method === 'rotsprite') {
    const big = upscale8(src, w, h);
    const bw = w * 8;
    const bh = h * 8;
    for (let y = 0; y < h; y++) {
      const cy = y + 0.5;
      for (let x = 0; x < w; x++) {
        const cx = x + 0.5;
        const sx = (inv[0] * cx + inv[2] * cy + inv[4]) * 8;
        const sy = (inv[1] * cx + inv[3] * cy + inv[5]) * 8;
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) continue;
        out32[y * w + x] = big[iy * bw + ix];
      }
    }
    return out;
  }
  const src32 =
    src.byteOffset % 4 === 0
      ? new Uint32Array(src.buffer, src.byteOffset, src.byteLength / 4)
      : new Uint32Array(src.slice().buffer);
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < w; x++) {
      const cx = x + 0.5;
      const sx = Math.floor(inv[0] * cx + inv[2] * cy + inv[4]);
      const sy = Math.floor(inv[1] * cx + inv[3] * cy + inv[5]);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      out32[y * w + x] = src32[sy * w + sx];
    }
  }
  return out;
}
