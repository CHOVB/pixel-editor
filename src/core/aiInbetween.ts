/**
 * AI 중간 프레임 – Codex 결과 정리 (계산 부분)
 * ------------------------------------------------------------
 * Codex 의 이미지 도구는 받은 그림보다 캐릭터를 크게(또는 작게) 다시 그리는 일이 많습니다.
 * 결과 띠를 그대로 줄이면 중간 프레임만 캐릭터가 커져서, 재생하면 커졌다 작아지는 것처럼 튀어 보입니다.
 * 그래서 칸마다
 *  1) 그림이 있는 곳을 찾고
 *  2) 크기가 시작/끝 프레임으로 예상한 크기와 많이 다르면 예상 크기로 줄이고
 *  3) 발(바닥)과 가로 가운데를 시작 → 끝 사이의 위치에 맞춥니다.
 * 크기가 맞게 온 결과는 그대로 둡니다. (AI 가 그린 모양·위치를 최대한 살림)
 */
import { downscale, mapToPalette } from './effects';
import { contentBounds, createBuffer } from './pixels';
import { cropBuffer } from './pixelfix';
import type { Color, Rect } from './types';

/** 그림 크기가 예상과 이 비율보다 더 다르면 크기를 맞춥니다. */
export const INBETWEEN_SIZE_TOLERANCE = 0.15;

/** 고해상도 그림에서 x0~x1 열 안의 확실히 불투명한(반투명 가장자리·잡티 제외) 영역 */
function solidBounds(img: Uint8ClampedArray, imgW: number, imgH: number, x0: number, x1: number): Rect | null {
  let minX = x1;
  let minY = imgH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < imgH; y++) {
    for (let x = x0; x < x1; x++) {
      if (img[(y * imgW + x) * 4 + 3] >= 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 줄인 그림 정리: 반투명 없애기 + 주어진 색으로만 */
function cleanSmall(small: Uint8ClampedArray, w: number, h: number, palette: Color[]): Uint8ClampedArray {
  for (let i = 3; i < small.length; i += 4) small[i] = small[i] >= 128 ? 255 : 0;
  return palette.length > 0 ? mapToPalette(small, w, h, palette, 'none', 0, 'perceptual') : small;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Codex 결과 띠(아무 크기, count 칸 가로로) → 캔버스 크기(w×h)의 중간 프레임들
 * a, b: 시작/끝 프레임 (크기·위치의 기준), palette: 쓸 수 있는 색
 */
export function fitInbetweens(
  img: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  w: number,
  h: number,
  count: number,
  palette: Color[],
): Uint8ClampedArray[] {
  // 기본: 띠 전체를 캔버스 크기 × count 로 줄여서 칸별로 자름
  const strip = cleanSmall(downscale(img, imgW, imgH, w * count, h, 'mode'), w * count, h, palette);
  const naive = Array.from({ length: count }, (_, i) => cropBuffer(strip, w * count, { x: i * w, y: 0, w, h }));
  const ba = contentBounds(a, w, h);
  const bb = contentBounds(b, w, h);
  if (!ba || !bb) return naive;

  const perPixel = imgH / h; // 기본 방식에서 스프라이트 1픽셀 = 고해상도 몇 픽셀
  return naive.map((frame, i) => {
    const t = (i + 1) / (count + 1);
    const wantH = lerp(ba.h, bb.h, t);
    const wantBottom = lerp(ba.y + ba.h, bb.y + bb.h, t);
    const wantCenter = lerp(ba.x + ba.w / 2, bb.x + bb.w / 2, t);
    const hb = solidBounds(img, imgW, imgH, Math.round((i * imgW) / count), Math.round(((i + 1) * imgW) / count));
    if (!hb) return frame;
    if (Math.abs(hb.h / perPixel - wantH) <= wantH * INBETWEEN_SIZE_TOLERANCE) return frame;

    // 크기가 많이 다름 → 예상 키에 맞춰 줄이고, 발과 가운데를 맞춰 놓기
    const k = hb.h / wantH;
    const outH = Math.max(1, Math.round(wantH));
    const outW = Math.max(1, Math.round(hb.w / k));
    const small = cleanSmall(downscale(cropBuffer(img, imgW, hb), hb.w, hb.h, outW, outH, 'mode'), outW, outH, palette);
    const out = createBuffer(w, h);
    const top = Math.round(wantBottom) - outH;
    const left = Math.round(wantCenter - outW / 2);
    for (let y = 0; y < outH; y++) {
      const ty = top + y;
      if (ty < 0 || ty >= h) continue;
      for (let x = 0; x < outW; x++) {
        const tx = left + x;
        if (tx < 0 || tx >= w) continue;
        const s = (y * outW + x) * 4;
        if (small[s + 3] === 0) continue;
        out.set(small.subarray(s, s + 4), (ty * w + tx) * 4);
      }
    }
    return out;
  });
}
