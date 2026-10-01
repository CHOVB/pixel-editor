/**
 * AI 도트 이미지 정리 (Pixel Art Fixer)
 * ------------------------------------------------------------
 * AI 가 만든 "도트 그림"은 보통 1024px 같은 큰 해상도라서,
 * 도트 1칸이 실제로는 8~16px 크기의 흐릿한 덩어리로 되어 있습니다. 색도 미세하게 수백 가지로 번져 있죠.
 * 이 파일은 그런 이미지를 "진짜 도트(1칸 = 1픽셀)"로 되돌립니다.
 *
 *  ① 영역 자르기: 원하는 스프라이트 부분만 선택
 *  ② 픽셀 격자 자동 감지: 도트 1칸이 몇 px 인지, 격자가 어디서 시작하는지 찾기
 *     (색이 바뀌는 경계선의 "반복 간격"을 주파수 분석으로 찾아냅니다)
 *  ③ 축소: 각 칸의 가운데 부분에서 가장 많이 나온 색을 대표 색으로 (경계 번짐 무시)
 *     또는 원하는 크기(64, 32 ...)로 바로 축소
 *  ④ 배경 제거: 테두리에서 이어진 배경색을 투명하게
 *  ⑤ 색 보정: N 색으로 줄이기 / 팔레트에 맞추기 (+ 디더링 선택)
 *  ⑥ 정리: 외톨이 픽셀 제거, 반투명 정리
 */
import { colorDistance } from './color';
import { removeOrphans } from './cleanup';
import { downscale, mapToPalette, quantizeColors, type DitherMode } from './effects';
import { createBuffer, getPixel, uniqueColors } from './pixels';
import type { Color, Rect } from './types';

export interface GridGuess {
  /** 도트 1칸의 가로/세로 크기 (px, 소수 가능) */
  cellW: number;
  cellH: number;
  /** 격자가 시작하는 위치 (px) */
  offsetX: number;
  offsetY: number;
  /** 0~1, 높을수록 확실 */
  confidence: number;
}

export function cropBuffer(src: Uint8ClampedArray, w: number, r: Rect): Uint8ClampedArray {
  const out = createBuffer(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const start = ((r.y + y) * w + r.x) * 4;
    out.set(src.subarray(start, start + r.w * 4), y * r.w * 4);
  }
  return out;
}

/** 경계선 세기 (가로 방향: x 마다, 세로 방향: y 마다) */
function edgeProfile(src: Uint8ClampedArray, w: number, h: number, axis: 'x' | 'y'): Float64Array {
  const len = axis === 'x' ? w : h;
  const prof = new Float64Array(len);
  const lum = (i: number) => (src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11) * (src[i + 3] / 255) + (255 - src[i + 3]) * 0.5;
  if (axis === 'x') {
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) prof[x] += Math.abs(lum((y * w + x) * 4) - lum((y * w + x - 1) * 4));
    }
  } else {
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) prof[y] += Math.abs(lum((y * w + x) * 4) - lum(((y - 1) * w + x) * 4));
    }
  }
  return prof;
}

/** 경계선이 반복되는 간격(주기)과 시작 위치 찾기 */
function detectPeriod(prof: Float64Array): { period: number; offset: number; confidence: number } {
  const n = prof.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += prof[i];
  if (total <= 0 || n < 8) return { period: 1, offset: 0, confidence: 0 };
  const results: { s: number; mag: number; phase: number }[] = [];
  const maxPeriod = Math.min(64, n / 3);
  for (let s = 2; s <= maxPeriod; s += 0.02) {
    let re = 0;
    let im = 0;
    const k = (2 * Math.PI) / s;
    for (let x = 0; x < n; x++) {
      if (prof[x] === 0) continue;
      re += prof[x] * Math.cos(k * x);
      im -= prof[x] * Math.sin(k * x);
    }
    results.push({ s, mag: Math.hypot(re, im) / total, phase: Math.atan2(im, re) });
  }
  let maxMag = 0;
  for (const r of results) if (r.mag > maxMag) maxMag = r.mag;
  if (maxMag <= 0) return { period: 1, offset: 0, confidence: 0 };
  // 주기 s 의 정수배 주파수(s/2, s/3 ...)도 강하게 나타나므로, 최댓값 근처 후보 중 "가장 큰 주기"를 고릅니다.
  const near = results.filter((r) => r.mag >= maxMag * 0.82);
  // 지역 최댓값만 남기기
  const peaks = near.filter((r) => {
    const i = results.indexOf(r);
    return (i === 0 || results[i - 1].mag <= r.mag) && (i === results.length - 1 || results[i + 1].mag <= r.mag);
  });
  const best = (peaks.length ? peaks : near).reduce((a, b) => (b.s > a.s ? b : a));
  let offset = (-best.phase / (2 * Math.PI)) * best.s;
  offset = ((offset % best.s) + best.s) % best.s;
  return { period: best.s, offset, confidence: Math.min(1, best.mag * 2) };
}

/** 도트 1칸 크기와 격자 위치를 추측합니다. */
export function detectGrid(src: Uint8ClampedArray, w: number, h: number): GridGuess {
  const gx = detectPeriod(edgeProfile(src, w, h, 'x'));
  const gy = detectPeriod(edgeProfile(src, w, h, 'y'));
  // 가로/세로가 비슷하면 정사각형 도트로 맞춰 줍니다.
  let cellW = gx.period;
  let cellH = gy.period;
  if (Math.abs(cellW - cellH) / Math.max(cellW, cellH) < 0.12) {
    const avg = gx.confidence >= gy.confidence ? cellW : cellH;
    cellW = avg;
    cellH = avg;
  }
  return { cellW, cellH, offsetX: gx.offset, offsetY: gy.offset, confidence: (gx.confidence + gy.confidence) / 2 };
}

/**
 * 격자에 맞춰 축소: 각 칸 "가운데 부분"에서 가장 많이 나온 색을 고릅니다.
 * (칸 경계의 흐린 번짐은 무시하므로 깔끔한 도트가 됩니다)
 */
export function sampleGrid(src: Uint8ClampedArray, w: number, h: number, grid: GridGuess, inner = 0.5): { buf: Uint8ClampedArray; width: number; height: number } {
  const startX = grid.offsetX - Math.floor(grid.offsetX / grid.cellW) * grid.cellW;
  const startY = grid.offsetY - Math.floor(grid.offsetY / grid.cellH) * grid.cellH;
  const x0 = startX > grid.cellW * 0.5 ? startX - grid.cellW : startX;
  const y0 = startY > grid.cellH * 0.5 ? startY - grid.cellH : startY;
  const cols = Math.max(1, Math.round((w - x0) / grid.cellW));
  const rows = Math.max(1, Math.round((h - y0) / grid.cellH));
  const out = createBuffer(cols, rows);
  const margin = (1 - inner) / 2;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const ax = Math.max(0, Math.floor(x0 + (cx + margin) * grid.cellW));
      const bx = Math.min(w, Math.max(ax + 1, Math.ceil(x0 + (cx + 1 - margin) * grid.cellW)));
      const ay = Math.max(0, Math.floor(y0 + (cy + margin) * grid.cellH));
      const by = Math.min(h, Math.max(ay + 1, Math.ceil(y0 + (cy + 1 - margin) * grid.cellH)));
      const counts = new Map<number, { n: number; r: number; g: number; b: number; a: number }>();
      let transparent = 0;
      let total = 0;
      for (let y = ay; y < by; y++) {
        for (let x = ax; x < bx; x++) {
          const i = (y * w + x) * 4;
          total++;
          if (src[i + 3] < 128) {
            transparent++;
            continue;
          }
          const key = ((src[i] >> 4) << 8) | ((src[i + 1] >> 4) << 4) | (src[i + 2] >> 4);
          const c = counts.get(key);
          if (c) {
            c.n++;
            c.r += src[i];
            c.g += src[i + 1];
            c.b += src[i + 2];
            c.a += src[i + 3];
          } else counts.set(key, { n: 1, r: src[i], g: src[i + 1], b: src[i + 2], a: src[i + 3] });
        }
      }
      if (total === 0 || transparent * 2 >= total || counts.size === 0) continue;
      let best = { n: 0, r: 0, g: 0, b: 0, a: 0 };
      counts.forEach((c) => {
        if (c.n > best.n) best = c;
      });
      const o = (cy * cols + cx) * 4;
      out[o] = best.r / best.n;
      out[o + 1] = best.g / best.n;
      out[o + 2] = best.b / best.n;
      out[o + 3] = 255;
    }
  }
  return { buf: out, width: cols, height: rows };
}

/** 테두리에 닿아 있는 배경색(가장 흔한 테두리 색)을 투명하게 만듭니다. */
export function removeBackground(src: Uint8ClampedArray, w: number, h: number, tolerance: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const counts = new Map<number, number>();
  const edge = (x: number, y: number) => {
    const c = getPixel(src, w, x, y);
    if ((c & 255) < 128) return;
    const key = (c >>> 8) & 0xf8f8f8;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < w; x++) {
    edge(x, 0);
    edge(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    edge(0, y);
    edge(w - 1, y);
  }
  if (counts.size === 0) return out;
  let bgKey = 0;
  let bestN = -1;
  counts.forEach((n, k) => {
    if (n > bestN) {
      bestN = n;
      bgKey = k;
    }
  });
  // 대표 배경색 = 그 키에 해당하는 실제 테두리 색 평균
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const visitEdge = (x: number, y: number) => {
    const c = getPixel(src, w, x, y);
    if ((c & 255) >= 128 && ((c >>> 8) & 0xf8f8f8) === bgKey) {
      r += (c >>> 24) & 255;
      g += (c >>> 16) & 255;
      b += (c >>> 8) & 255;
      n++;
    }
  };
  for (let x = 0; x < w; x++) {
    visitEdge(x, 0);
    visitEdge(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    visitEdge(0, y);
    visitEdge(w - 1, y);
  }
  const bg = (((Math.round(r / n) << 24) | (Math.round(g / n) << 16) | (Math.round(b / n) << 8) | 255) >>> 0) as Color;
  // 테두리에서 시작해 배경색과 비슷한 픽셀을 따라가며 투명하게 (이어진 부분만)
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (seen[i]) return;
    seen[i] = 1;
    const c = getPixel(src, w, x, y);
    if ((c & 255) < 128 || colorDistance(c | 255, bg) <= tolerance) stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    out[i * 4 + 3] = 0;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return out;
}

export interface FixOptions {
  /** 원본에서 사용할 영역 (없으면 전체) */
  region?: Rect;
  /** auto: 격자 감지 / size: 정해진 크기로 */
  mode: 'auto' | 'size';
  /** auto 모드에서 사람이 고친 도트 크기 (없으면 감지값) */
  cellOverride?: number;
  targetW?: number;
  targetH?: number;
  sample: 'mode' | 'average' | 'nearest';
  removeBg: boolean;
  bgTolerance: number;
  /** 0 = 색 줄이기 안 함 */
  colors: number;
  /** 지정하면 이 팔레트에 맞춤 (colors 보다 우선) */
  palette?: Color[];
  dither: DitherMode;
  ditherStrength: number;
  cleanup: boolean;
  /** 이 거리보다 가까운 색은 하나로 합칩니다 (AI 이미지의 미세한 얼룩 제거, 0 = 끔) */
  mergeTolerance: number;
}

export const DEFAULT_FIX: FixOptions = {
  mode: 'auto',
  sample: 'mode',
  removeBg: true,
  bgTolerance: 40,
  colors: 16,
  dither: 'none',
  ditherStrength: 40,
  cleanup: true,
  mergeTolerance: 24,
};

export interface FixResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  grid: GridGuess | null;
  colorCount: number;
}

export function fixPixelArt(src: Uint8ClampedArray, w: number, h: number, options: Partial<FixOptions> = {}): FixResult {
  const opts = { ...DEFAULT_FIX, ...options };
  const region = opts.region ?? { x: 0, y: 0, w, h };
  const r = {
    x: Math.max(0, Math.min(w - 1, Math.round(region.x))),
    y: Math.max(0, Math.min(h - 1, Math.round(region.y))),
    w: 0,
    h: 0,
  };
  r.w = Math.max(1, Math.min(w - r.x, Math.round(region.w)));
  r.h = Math.max(1, Math.min(h - r.y, Math.round(region.h)));
  let crop = cropBuffer(src, w, r);
  let cw = r.w;
  let ch = r.h;
  if (opts.removeBg) crop = removeBackground(crop, cw, ch, opts.bgTolerance);

  let grid: GridGuess | null = null;
  let small: Uint8ClampedArray;
  let sw: number;
  let sh: number;
  if (opts.mode === 'auto') {
    grid = detectGrid(crop, cw, ch);
    if (opts.cellOverride && opts.cellOverride > 1) {
      grid = { ...grid, cellW: opts.cellOverride, cellH: opts.cellOverride };
    }
    if (grid.cellW < 1.5) grid = { ...grid, cellW: 1, cellH: 1 };
    const s = sampleGrid(crop, cw, ch, grid);
    small = s.buf;
    sw = s.width;
    sh = s.height;
  } else {
    sw = Math.max(1, Math.round(opts.targetW ?? 64));
    sh = Math.max(1, Math.round(opts.targetH ?? Math.round((sw * ch) / cw)));
    small = downscale(crop, cw, ch, sw, sh, opts.sample);
  }
  // 반투명 정리
  for (let i = 3; i < small.length; i += 4) small[i] = small[i] >= 128 ? 255 : 0;
  // 거의 같은 색(AI 이미지의 얼룩/노이즈) 합치기
  if (opts.mergeTolerance > 0 && !(opts.palette && opts.palette.length > 0)) small = mergeSimilarColors(small, opts.mergeTolerance);
  // 색 보정
  if (opts.palette && opts.palette.length > 0) small = mapToPalette(small, sw, sh, opts.palette, opts.dither, opts.ditherStrength);
  else if (opts.colors > 0) small = mapToPalette(small, sw, sh, quantizeColors(small, opts.colors), opts.dither, opts.ditherStrength);
  if (opts.cleanup) small = removeOrphans(small, sw, sh).buf;
  return { pixels: small, width: sw, height: sh, grid, colorCount: uniqueColors(small, 1024).length };
}

/**
 * 거리가 tolerance 보다 가까운 색들을 하나로 합칩니다.
 * 많이 쓰인 색부터 "대표 색"이 되고, 비슷한 색은 그 대표 색으로 바뀝니다.
 */
export function mergeSimilarColors(src: Uint8ClampedArray, tolerance: number): Uint8ClampedArray {
  const counts = new Map<number, number>();
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    const c = ((src[i] << 24) | (src[i + 1] << 16) | (src[i + 2] << 8) | src[i + 3]) >>> 0;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const byFrequency = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const reps: number[] = [];
  const mapTo = new Map<number, number>();
  const t2 = tolerance * tolerance;
  for (const [c] of byFrequency) {
    let target = c;
    for (const r of reps) {
      const dr = ((c >>> 24) & 255) - ((r >>> 24) & 255);
      const dg = ((c >>> 16) & 255) - ((r >>> 16) & 255);
      const db = ((c >>> 8) & 255) - ((r >>> 8) & 255);
      if (dr * dr + dg * dg + db * db <= t2) {
        target = r;
        break;
      }
    }
    if (target === c) reps.push(c);
    mapTo.set(c, target);
  }
  const out = new Uint8ClampedArray(src);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const c = ((out[i] << 24) | (out[i + 1] << 16) | (out[i + 2] << 8) | out[i + 3]) >>> 0;
    const m = mapTo.get(c) ?? c;
    if (m === c) continue;
    out[i] = (m >>> 24) & 255;
    out[i + 1] = (m >>> 16) & 255;
    out[i + 2] = (m >>> 8) & 255;
    out[i + 3] = m & 255;
  }
  return out;
}

/** 결과를 여러 프레임으로 나누기 (가로 cols × 세로 rows 칸의 스프라이트시트) */
export function sliceFrames(src: Uint8ClampedArray, w: number, h: number, cols: number, rows: number): { frames: Uint8ClampedArray[]; frameW: number; frameH: number } {
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  const fw = Math.max(1, Math.floor(w / c));
  const fh = Math.max(1, Math.floor(h / r));
  const frames: Uint8ClampedArray[] = [];
  for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) frames.push(cropBuffer(src, w, { x: x * fw, y: y * fh, w: fw, h: fh }));
  return { frames, frameW: fw, frameH: fh };
}
