/**
 * 그리기 알고리즘 모음
 * ------------------------------------------------------------
 * 직선, 사각형, 타원, 채우기(Flood Fill), 픽셀 퍼펙트 처리 등
 * "어떤 픽셀을 칠해야 하는가?" 를 계산하는 순수 함수들입니다.
 * 실제로 색을 칠하는 일은 tools 폴더의 도구들이 담당합니다.
 */
import { colorDistance } from './color';
import { getPixel } from './pixels';
import type { Color, Point } from './types';

/** 브레젠험(Bresenham) 직선 알고리즘: 두 점 사이의 모든 픽셀 */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/**
 * Shift 키를 누른 채 직선을 그릴 때: 0°, 45°, 90° ... 방향으로 고정합니다.
 */
export function constrainLine(x0: number, y0: number, x1: number, y1: number): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return { x: x1, y: y0 }; // 수평
  if (ady > adx * 2) return { x: x0, y: y1 }; // 수직
  const d = Math.max(adx, ady); // 대각선
  return { x: x0 + Math.sign(dx) * d, y: y0 + Math.sign(dy) * d };
}

/** Shift 키로 정사각형/정원 그리기: 두 점이 이루는 박스를 정사각형으로 맞춥니다. */
export function constrainSquare(x0: number, y0: number, x1: number, y1: number): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: x0 + (dx < 0 ? -d : d), y: y0 + (dy < 0 ? -d : d) };
}

/** 두 꼭짓점으로 만든 사각형의 픽셀 (filled=true 면 안쪽까지) */
export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const points: Point[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (filled || y === top || y === bottom || x === left || x === right) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

/**
 * 사각형 박스 안에 꽉 차는 타원 (Alois Zingl 의 알고리즘)
 * 짝수/홀수 크기 모두 대칭이 깔끔하게 나옵니다.
 */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  let left = Math.min(x0, x1);
  let right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  let a = right - left;
  const b = bottom - top;
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let e2 = 0;

  let ya = top + Math.floor((b + 1) / 2);
  let yb = ya - b1;
  a *= 8 * a;
  b1 = 8 * b * b;

  const outline = new Map<number, { min: number; max: number }>();
  const seen = new Set<string>();
  const points: Point[] = [];
  const plot = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push({ x, y });
    }
    const row = outline.get(y);
    if (!row) outline.set(y, { min: x, max: x });
    else {
      if (x < row.min) row.min = x;
      if (x > row.max) row.max = x;
    }
  };

  do {
    plot(right, ya);
    plot(left, ya);
    plot(left, yb);
    plot(right, yb);
    e2 = 2 * err;
    if (e2 <= dy) {
      ya++;
      yb--;
      err += dy += a;
    }
    if (e2 >= dx || 2 * err > dy) {
      left++;
      right--;
      err += dx += b1;
    }
  } while (left <= right);

  // 아주 납작한 타원의 끝부분 마무리
  while (ya - yb < b) {
    plot(left - 1, ya);
    plot(right + 1, ya++);
    plot(left - 1, yb);
    plot(right + 1, yb--);
  }

  if (!filled) return points;
  const filledPoints: Point[] = [];
  outline.forEach((span, y) => {
    for (let x = span.min; x <= span.max; x++) filledPoints.push({ x, y });
  });
  return filledPoints;
}

export type BrushShape = 'square' | 'circle';

/**
 * 브러시 모양: 중심(0,0) 기준으로 칠해질 픽셀들의 상대 위치 목록
 * size=1 이면 [ (0,0) ] 하나입니다.
 */
export function brushOffsets(size: number, shape: BrushShape): Point[] {
  const s = Math.max(1, Math.round(size));
  if (s === 1) return [{ x: 0, y: 0 }];
  const offsets: Point[] = [];
  const start = -Math.floor((s - 1) / 2);
  const end = start + s - 1;
  const center = (start + end) / 2;
  const r = s / 2;
  for (let y = start; y <= end; y++) {
    for (let x = start; x <= end; x++) {
      if (shape === 'square') {
        offsets.push({ x, y });
      } else {
        const ddx = x - center;
        const ddy = y - center;
        if (ddx * ddx + ddy * ddy <= (r - 0.25) * (r - 0.25)) offsets.push({ x, y });
      }
    }
  }
  return offsets;
}

/**
 * 픽셀 퍼펙트(Pixel Perfect) 처리
 * 손으로 선을 그을 때 생기는 "ㄱ"자 모양의 군더더기 픽셀을 제거합니다.
 * 픽셀아트에서 깔끔한 1px 선을 그리는 핵심 기능입니다.
 */
export function pixelPerfect(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const result: Point[] = [points[0]];
  let i = 1;
  while (i < points.length) {
    const prev = result[result.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (next) {
      const prevToCur = Math.abs(prev.x - cur.x) + Math.abs(prev.y - cur.y) === 1;
      const curToNext = Math.abs(cur.x - next.x) + Math.abs(cur.y - next.y) === 1;
      const diagonal = Math.abs(prev.x - next.x) === 1 && Math.abs(prev.y - next.y) === 1;
      if (prevToCur && curToNext && diagonal) {
        // cur 은 ㄱ자 모서리 → 건너뜀
        i++;
        continue;
      }
    }
    result.push(cur);
    i++;
  }
  return result;
}

/** 연속으로 같은 점이 들어오지 않도록 정리 */
export function dedupeConsecutive(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/**
 * 채우기(Flood Fill) 영역 계산
 * - contiguous=true : 클릭한 곳과 "이어진" 같은 색 영역만
 * - contiguous=false: 캔버스 전체에서 같은 색 모두
 * - tolerance: 0~255, 색 차이를 얼마나 허용할지
 * - limitMask: 선택 영역이 있으면 그 안에서만 채웁니다.
 * 결과: 칠해야 할 픽셀이 1 인 마스크 (width*height)
 */
export function floodFillMask(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  contiguous: boolean,
  tolerance = 0,
  limitMask: Uint8Array | null = null,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return mask;
  const target: Color = getPixel(buf, width, startX, startY);
  const matches = (x: number, y: number): boolean => {
    const idx = y * width + x;
    if (limitMask && !limitMask[idx]) return false;
    const c = getPixel(buf, width, x, y);
    if (tolerance <= 0) {
      // 완전히 투명한 픽셀들은 RGB 값이 달라도 같은 색으로 봅니다.
      if ((c & 255) === 0 && (target & 255) === 0) return true;
      return c === target;
    }
    return colorDistance(c, target) <= tolerance;
  };

  if (!contiguous) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (matches(x, y)) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  if (!matches(startX, startY)) return mask;
  // 스캔라인 방식: 한 줄씩 좌우로 넓게 칠하면서 위/아래 줄을 스택에 넣습니다.
  const stack: number[] = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    let lx = x;
    while (lx >= 0 && !mask[y * width + lx] && matches(lx, y)) lx--;
    lx++;
    let rx = x;
    while (rx < width && !mask[y * width + rx] && matches(rx, y)) rx++;
    rx--;
    if (lx > rx) continue;
    for (let i = lx; i <= rx; i++) mask[y * width + i] = 1;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      let inSpan = false;
      for (let i = lx; i <= rx; i++) {
        const ok = !mask[ny * width + i] && matches(i, ny);
        if (ok && !inSpan) {
          stack.push(i, ny);
          inSpan = true;
        } else if (!ok) {
          inSpan = false;
        }
      }
    }
  }
  return mask;
}

/**
 * 다각형(올가미 선택) 내부 마스크. 픽셀 중심 (x+0.5, y+0.5) 기준 짝홀 규칙.
 * 테두리 경로 위의 픽셀도 포함합니다.
 */
export function polygonMask(points: Point[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (points.length === 0) return mask;
  const n = points.length;
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const ay = a.y + 0.5;
      const by = b.y + 0.5;
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        const t = (cy - ay) / (by - ay);
        xs.push(a.x + 0.5 + t * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * width + x] = 1;
    }
  }
  // 경로 자체도 포함
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (const p of linePoints(a.x, a.y, b.x, b.y)) {
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) mask[p.y * width + p.x] = 1;
    }
  }
  return mask;
}
