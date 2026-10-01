/**
 * 외곽선 보정 / 그림 정리 도구
 * ------------------------------------------------------------
 *  - removeOrphans: 주변에 아무것도 없는 "외톨이 픽셀" 제거 (AI 이미지의 점 노이즈 정리)
 *  - fillPinholes: 그림 속 1픽셀짜리 구멍 메우기
 *  - smoothJaggies: 외곽선의 "ㄱ"자 계단을 정리해 깔끔한 1px 선으로 (픽셀 퍼펙트 정리)
 *  - removeHalo: 그림 가장자리의 흰색(또는 지정 색) 테두리 번짐 제거 (AI 이미지에 자주 생김)
 *  - addOutline: 외곽선을 실제 픽셀로 그리기 (효과 대신 바로 적용하고 싶을 때)
 */
import { colorDistance } from './color';
import { outlineBuffer } from './effects';
import { fillSmallHoles } from './inbetween';
import { cloneBuffer, getPixel } from './pixels';
import type { Color } from './types';

const N4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function solidAt(buf: Uint8ClampedArray, w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3] > 0;
}

function clearPixel(buf: Uint8ClampedArray, w: number, x: number, y: number): void {
  const i = (y * w + x) * 4;
  buf[i] = 0;
  buf[i + 1] = 0;
  buf[i + 2] = 0;
  buf[i + 3] = 0;
}

export function removeOrphans(src: Uint8ClampedArray, w: number, h: number): { buf: Uint8ClampedArray; count: number } {
  const out = cloneBuffer(src);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solidAt(src, w, h, x, y)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solidAt(src, w, h, x + dx, y + dy)) n++;
      if (n === 0) {
        clearPixel(out, w, x, y);
        count++;
      }
    }
  }
  return { buf: out, count };
}

export function fillPinholes(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = cloneBuffer(src);
  fillSmallHoles(out, w, h, 1);
  return out;
}

/**
 * 계단 정리: 그림 바깥쪽 모서리에서 두 방향으로 이어진 "ㄱ"자 픽셀을 지웁니다.
 * (P 의 위·오른쪽은 칠해져 있고, 아래·왼쪽·오른쪽위 대각선은 비어 있으면 P 는 군더더기)
 */
export function smoothJaggies(src: Uint8ClampedArray, w: number, h: number): { buf: Uint8ClampedArray; count: number } {
  const out = cloneBuffer(src);
  let count = 0;
  const pairs: [[number, number], [number, number]][] = [
    [
      [0, -1],
      [1, 0],
    ],
    [
      [1, 0],
      [0, 1],
    ],
    [
      [0, 1],
      [-1, 0],
    ],
    [
      [-1, 0],
      [0, -1],
    ],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solidAt(src, w, h, x, y)) continue;
      for (const [[ax, ay], [bx, by]] of pairs) {
        const a = solidAt(src, w, h, x + ax, y + ay);
        const b = solidAt(src, w, h, x + bx, y + by);
        const na = solidAt(src, w, h, x - ax, y - ay);
        const nb = solidAt(src, w, h, x - bx, y - by);
        const diag = solidAt(src, w, h, x + ax + bx, y + ay + by);
        if (a && b && !na && !nb && !diag) {
          clearPixel(out, w, x, y);
          count++;
          break;
        }
      }
    }
  }
  return { buf: out, count };
}

/**
 * 가장자리 번짐 제거: 투명한 곳과 맞닿은 픽셀 중 target 색과 비슷한 것을 지웁니다. (passes 번 반복)
 */
export function removeHalo(src: Uint8ClampedArray, w: number, h: number, target: Color, tolerance: number, passes = 1): { buf: Uint8ClampedArray; count: number } {
  let cur = cloneBuffer(src);
  let count = 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = cloneBuffer(cur);
    let changed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solidAt(cur, w, h, x, y)) continue;
        const edge = N4.some(([dx, dy]) => !solidAt(cur, w, h, x + dx, y + dy));
        if (!edge) continue;
        if (colorDistance(getPixel(cur, w, x, y) | 255, target | 255) <= tolerance) {
          clearPixel(next, w, x, y);
          changed++;
        }
      }
    }
    cur = next;
    count += changed;
    if (changed === 0) break;
  }
  return { buf: cur, count };
}

export function addOutline(src: Uint8ClampedArray, w: number, h: number, color: Color, thickness: number, position: 'outside' | 'inside', diagonal: boolean, auto: boolean): Uint8ClampedArray {
  return outlineBuffer(src, w, h, color, thickness, position, diagonal, auto);
}
