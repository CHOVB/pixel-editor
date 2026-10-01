/**
 * 선택 영역(Selection) 도우미
 * ------------------------------------------------------------
 * 선택 영역은 캔버스 크기의 마스크(Uint8Array)로 표현합니다. 1 = 선택됨.
 * 사각형/올가미/마술봉 선택 모두 결국 이 마스크를 만듭니다.
 */
import type { Rect, Selection } from './types';

export type SelectMode = 'replace' | 'add' | 'subtract';

export function maskBounds(mask: Uint8Array, width: number, height: number): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 마스크로 Selection 객체를 만듭니다. 선택된 픽셀이 없으면 null */
export function selectionFromMask(mask: Uint8Array, width: number, height: number): Selection | null {
  const bounds = maskBounds(mask, width, height);
  if (!bounds) return null;
  return { mask, bounds };
}

export function rectMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(height - 1, Math.max(y0, y1));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) mask[y * width + x] = 1;
  }
  return mask;
}

/** 기존 선택과 새 마스크를 모드에 따라 합칩니다. */
export function combineMasks(base: Uint8Array | null, next: Uint8Array, mode: SelectMode): Uint8Array {
  if (mode === 'replace' || !base) {
    return mode === 'subtract' ? new Uint8Array(next.length) : next;
  }
  const out = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    out[i] = mode === 'add' ? (base[i] || next[i] ? 1 : 0) : base[i] && !next[i] ? 1 : 0;
  }
  return out;
}

export function invertMask(mask: Uint8Array | null, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = mask && mask[i] ? 0 : 1;
  return out;
}

export function fullMask(size: number): Uint8Array {
  return new Uint8Array(size).fill(1);
}

/** 마스크를 (dx, dy) 만큼 옮깁니다. 캔버스 밖으로 나간 부분은 사라집니다. */
export function translateMask(mask: Uint8Array, width: number, height: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      out[ny * width + nx] = 1;
    }
  }
  return out;
}

/** 선택 영역 테두리 선분들 (점선 "개미 행렬" 표시용). 좌표는 픽셀 격자 기준 */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function maskOutline(mask: Uint8Array, width: number, height: number): Segment[] {
  const segs: Segment[] = [];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // 가로 테두리: 각 줄 경계마다 연속된 구간을 하나의 선분으로 묶습니다.
  for (let y = 0; y <= height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const edge = x < width && at(x, y) !== at(x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segs.push({ x1: start, y1: y, x2: x, y2: y });
        start = -1;
      }
    }
  }
  // 세로 테두리
  for (let x = 0; x <= width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const edge = y < height && at(x, y) !== at(x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segs.push({ x1: x, y1: start, x2: x, y2: y });
        start = -1;
      }
    }
  }
  return segs;
}
