/**
 * 픽셀 버퍼(Uint8ClampedArray, RGBA) 조작 함수 모음
 * ------------------------------------------------------------
 * 픽셀 (x, y) 의 위치는 배열에서 (y * width + x) * 4 번째부터 4칸(r,g,b,a)입니다.
 */
import type { Color, Rect } from './types';

export function createBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

export function cloneBuffer(buf: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(buf);
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function getPixel(buf: Uint8ClampedArray, width: number, x: number, y: number): Color {
  const i = (y * width + x) * 4;
  return ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
}

/** 픽셀을 "덮어쓰기" 합니다. (픽셀아트는 섞지 않고 그대로 교체하는 것이 기본) */
export function setPixel(buf: Uint8ClampedArray, width: number, x: number, y: number, c: Color): void {
  const i = (y * width + x) * 4;
  buf[i] = (c >>> 24) & 255;
  buf[i + 1] = (c >>> 16) & 255;
  buf[i + 2] = (c >>> 8) & 255;
  buf[i + 3] = c & 255;
}

/** 버퍼 전체를 한 색으로 채웁니다. */
export function fillBuffer(buf: Uint8ClampedArray, c: Color): void {
  const r = (c >>> 24) & 255;
  const g = (c >>> 16) & 255;
  const b = (c >>> 8) & 255;
  const a = c & 255;
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  }
}

/** 모든 픽셀이 투명한지 검사 */
export function isBufferEmpty(buf: Uint8ClampedArray): boolean {
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

/** 투명하지 않은 픽셀들을 감싸는 사각형. 전부 투명하면 null */
export function contentBounds(buf: Uint8ClampedArray, width: number, height: number): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (buf[(y * width + x) * 4 + 3] !== 0) {
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

/** 좌우 뒤집기 (새 버퍼 반환) */
export function flipHorizontal(buf: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = createBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = (y * width + (width - 1 - x)) * 4;
      out[d] = buf[s];
      out[d + 1] = buf[s + 1];
      out[d + 2] = buf[s + 2];
      out[d + 3] = buf[s + 3];
    }
  }
  return out;
}

/** 상하 뒤집기 (새 버퍼 반환) */
export function flipVertical(buf: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = createBuffer(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(buf.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  }
  return out;
}

/**
 * 90도 회전 (새 버퍼 반환). 회전하면 가로/세로 크기가 서로 바뀝니다.
 * clockwise=true 이면 시계 방향.
 */
export function rotate90(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  clockwise: boolean,
): { buf: Uint8ClampedArray; width: number; height: number } {
  const nw = height;
  const nh = width;
  const out = createBuffer(nw, nh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = clockwise ? height - 1 - y : y;
      const ny = clockwise ? x : width - 1 - x;
      const s = (y * width + x) * 4;
      const d = (ny * nw + nx) * 4;
      out[d] = buf[s];
      out[d + 1] = buf[s + 1];
      out[d + 2] = buf[s + 2];
      out[d + 3] = buf[s + 3];
    }
  }
  return { buf: out, width: nw, height: nh };
}

/**
 * 캔버스 크기 변경: 기존 그림을 (offsetX, offsetY) 위치에 놓은 새 버퍼를 만듭니다.
 * 새 크기를 벗어나는 부분은 잘려 나갑니다.
 */
export function resizeBuffer(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  newWidth: number,
  newHeight: number,
  offsetX: number,
  offsetY: number,
): Uint8ClampedArray {
  const out = createBuffer(newWidth, newHeight);
  for (let y = 0; y < height; y++) {
    const ny = y + offsetY;
    if (ny < 0 || ny >= newHeight) continue;
    for (let x = 0; x < width; x++) {
      const nx = x + offsetX;
      if (nx < 0 || nx >= newWidth) continue;
      const s = (y * width + x) * 4;
      const d = (ny * newWidth + nx) * 4;
      out[d] = buf[s];
      out[d + 1] = buf[s + 1];
      out[d + 2] = buf[s + 2];
      out[d + 3] = buf[s + 3];
    }
  }
  return out;
}

/** 최근접 이웃(Nearest Neighbor) 방식 크기 조절 - 픽셀아트가 흐려지지 않습니다. */
export function scaleNearest(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  newWidth: number,
  newHeight: number,
): Uint8ClampedArray {
  const out = createBuffer(newWidth, newHeight);
  for (let y = 0; y < newHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / newHeight));
    for (let x = 0; x < newWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / newWidth));
      const s = (sy * width + sx) * 4;
      const d = (y * newWidth + x) * 4;
      out[d] = buf[s];
      out[d + 1] = buf[s + 1];
      out[d + 2] = buf[s + 2];
      out[d + 3] = buf[s + 3];
    }
  }
  return out;
}

/** 정수 배율 확대 (내보내기용). scale=1 이면 복사본을 돌려줍니다. */
export function upscaleInteger(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): Uint8ClampedArray {
  if (scale <= 1) return cloneBuffer(buf);
  return scaleNearest(buf, width, height, width * scale, height * scale);
}

/**
 * src 버퍼를 dst 버퍼의 (dx, dy) 위치에 "알파 합성 없이" 복사합니다.
 * 내보내기(스프라이트시트)처럼 빈 곳에 그대로 옮길 때 사용합니다.
 */
export function blitBuffer(
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dst: Uint8ClampedArray,
  dstWidth: number,
  dstHeight: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < srcHeight; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dstHeight) continue;
    for (let x = 0; x < srcWidth; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dstWidth) continue;
      const s = (y * srcWidth + x) * 4;
      const d = (ty * dstWidth + tx) * 4;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
      dst[d + 3] = src[s + 3];
    }
  }
}

/**
 * 두 버퍼를 "src-over" 방식으로 합성합니다. (dst 위에 src 를 올림)
 * opacity 는 src 전체에 곱해지는 불투명도(0~1)입니다.
 */
export function blendOver(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity = 1): void {
  for (let i = 0; i < dst.length; i += 4) {
    const srcA = src[i + 3];
    if (srcA === 0) continue;
    const sa = (srcA / 255) * opacity;
    if (sa >= 1) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = 255;
      continue;
    }
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) continue;
    const k = da * (1 - sa);
    dst[i] = (src[i] * sa + dst[i] * k) / oa;
    dst[i + 1] = (src[i + 1] * sa + dst[i + 1] * k) / oa;
    dst[i + 2] = (src[i + 2] * sa + dst[i + 2] * k) / oa;
    dst[i + 3] = oa * 255;
  }
}

/** 버퍼 안에 쓰인 서로 다른 색 목록 (투명 제외). limit 개를 넘으면 중단합니다. */
export function uniqueColors(buf: Uint8ClampedArray, limit = 256): Color[] {
  const set = new Set<number>();
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue;
    const c = ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
    set.add(c);
    if (set.size >= limit) break;
  }
  return Array.from(set);
}
