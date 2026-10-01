/**
 * 블렌드 모드 (레이어 섞는 방식)
 * ------------------------------------------------------------
 *  - normal(보통): 위 레이어가 그대로 덮음
 *  - multiply(곱하기): 어둡게 – 그림자 표현
 *  - screen(스크린): 밝게 – 빛 표현
 *  - overlay(오버레이): 대비 강하게
 *  - darken/lighten: 더 어두운/밝은 색만
 *  - add(더하기): 빛나는 효과
 *  - subtract(빼기), difference(차이), hardLight(하드 라이트)
 *
 * 계산식은 W3C Compositing 표준을 따릅니다.
 */
import type { BlendMode } from './types';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'add',
  'subtract',
  'difference',
  'hardLight',
];

function multiply(b: number, s: number): number {
  return b * s;
}
function screen(b: number, s: number): number {
  return b + s - b * s;
}
function hardLight(b: number, s: number): number {
  return s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1);
}

function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return multiply(b, s);
    case 'screen':
      return screen(b, s);
    case 'overlay':
      return hardLight(s, b);
    case 'darken':
      return Math.min(b, s);
    case 'lighten':
      return Math.max(b, s);
    case 'add':
      return Math.min(1, b + s);
    case 'subtract':
      return Math.max(0, b - s);
    case 'difference':
      return Math.abs(b - s);
    case 'hardLight':
      return hardLight(b, s);
    default:
      return s;
  }
}

/**
 * dst 위에 src 를 섞어 올립니다.
 * opacity: src 전체에 곱해지는 불투명도(0~1)
 */
export function blendInto(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity: number, mode: BlendMode): void {
  if (opacity <= 0) return;
  for (let i = 0; i < dst.length; i += 4) {
    const srcA = src[i + 3];
    if (srcA === 0) continue;
    const as = (srcA / 255) * opacity;
    const ab = dst[i + 3] / 255;
    if (mode === 'normal' || ab === 0) {
      if (as >= 1) {
        dst[i] = src[i];
        dst[i + 1] = src[i + 1];
        dst[i + 2] = src[i + 2];
        dst[i + 3] = 255;
        continue;
      }
      const ao = as + ab * (1 - as);
      const k = ab * (1 - as);
      dst[i] = (src[i] * as + dst[i] * k) / ao;
      dst[i + 1] = (src[i + 1] * as + dst[i + 1] * k) / ao;
      dst[i + 2] = (src[i + 2] * as + dst[i + 2] * k) / ao;
      dst[i + 3] = ao * 255;
      continue;
    }
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++) {
      const cs = src[i + c] / 255;
      const cb = dst[i + c] / 255;
      const co = as * (1 - ab) * cs + as * ab * blendChannel(mode, cb, cs) + (1 - as) * ab * cb;
      dst[i + c] = (co / ao) * 255;
    }
    dst[i + 3] = ao * 255;
  }
}
