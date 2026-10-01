/**
 * 비파괴 효과(Effect) 엔진
 * ------------------------------------------------------------
 * "비파괴" = 원본 픽셀은 그대로 두고, 화면에 보여줄 때/내보낼 때만 효과를 적용합니다.
 * 효과를 끄거나 값을 바꾸면 언제든 원래대로 돌아갈 수 있어요. (PixelOver 의 핵심 개념)
 *
 * 새 효과를 추가하려면 EFFECTS 목록에 항목 하나만 추가하면 됩니다.
 * 화면의 설정 UI 는 params 설명을 보고 자동으로 만들어집니다.
 *
 * 이 파일의 함수들(팔레트 맞추기, 디더링, 색 줄이기, 픽셀화)은
 * "이미지 → 픽셀아트 변환" 기능에서도 그대로 재사용합니다.
 */
import { colorToHex, hexToColor, hsvToRgb, rgbToHsv, unpackColor } from './color';
import { effectParamsAt, isEffectAnimated } from './effectKeys';
import { getPreset, presetToColors } from './palettes';
import { cloneBuffer, contentBounds, createBuffer, resizeBuffer } from './pixels';
import type { Color, EaseKind, Effect, EffectParamValue, Project } from './types';

/* ------------------------------------------------------------------ */
/* 효과 정의 형식                                                        */
/* ------------------------------------------------------------------ */

export interface EffectParamDesc {
  key: string;
  kind: 'number' | 'color' | 'boolean' | 'select';
  default: EffectParamValue;
  min?: number;
  max?: number;
  step?: number;
  /** select 의 선택지 (화면에는 번역된 이름으로 표시) */
  options?: string[];
}

export interface EffectContext {
  project: Project;
  frameIndex: number;
}

export interface EffectDef {
  type: string;
  params: EffectParamDesc[];
  /** 프레임마다 결과가 달라지는 효과인지 (컬러 사이클 등) */
  frameDependent?: boolean;
  /** 프로젝트 팔레트를 사용하는 효과인지 */
  usesPalette?: boolean;
  apply: (src: Uint8ClampedArray, w: number, h: number, params: Record<string, EffectParamValue>, ctx: EffectContext) => Uint8ClampedArray;
}

export type DitherMode = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'floyd' | 'atkinson';
export const DITHER_MODES: DitherMode[] = ['none', 'bayer2', 'bayer4', 'bayer8', 'floyd', 'atkinson'];

/* ------------------------------------------------------------------ */
/* 도우미                                                               */
/* ------------------------------------------------------------------ */

function num(v: EffectParamValue | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: EffectParamValue | undefined, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function colorParam(v: EffectParamValue | undefined, fallback: Color): Color {
  if (typeof v === 'string') return hexToColor(v) ?? fallback;
  return fallback;
}

function neighbors(diagonal: boolean): [number, number][] {
  const n: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  if (diagonal) n.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  return n;
}

/* ------------------------------------------------------------------ */
/* 외곽선 / 그림자 / 색 덮기                                              */
/* ------------------------------------------------------------------ */

/**
 * 외곽선 그리기
 *  - outside: 그림 바깥에 테두리 (스티커 같은 흰 테두리, 검정 외곽선)
 *  - inside: 그림 안쪽 가장자리를 테두리 색으로
 *  - auto=true: "셀아웃(sel-out)" – 테두리 색을 옆 픽셀 색보다 어둡게 자동 결정 (픽셀아트 고급 기법)
 */
export function outlineBuffer(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  color: Color,
  thickness: number,
  position: 'outside' | 'inside',
  diagonal: boolean,
  auto = false,
): Uint8ClampedArray {
  const out = cloneBuffer(src);
  const [r, g, b, a] = unpackColor(color);
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = src[i * 4 + 3] > 0 ? 1 : 0;
  const dirs = neighbors(diagonal);
  const paint = (i: number) => {
    if (auto) {
      // 주변(또는 자기 자신)의 그림 색을 45% 어둡게
      const x = i % w;
      const y = Math.floor(i / w);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (const [dx, dy] of [[0, 0], ...neighbors(true)]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (src[j + 3] === 0) continue;
        sr += src[j];
        sg += src[j + 1];
        sb += src[j + 2];
        n++;
      }
      if (n > 0) {
        out[i * 4] = (sr / n) * 0.55;
        out[i * 4 + 1] = (sg / n) * 0.55;
        out[i * 4 + 2] = (sb / n) * 0.6;
        out[i * 4 + 3] = 255;
        return;
      }
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  };
  for (let pass = 0; pass < Math.max(1, Math.round(thickness)); pass++) {
    const next = solid.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (position === 'outside') {
          if (solid[i]) continue;
          for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && solid[ny * w + nx]) {
              paint(i);
              next[i] = 1;
              break;
            }
          }
        } else {
          if (!solid[i]) continue;
          for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !solid[ny * w + nx]) {
              paint(i);
              next[i] = 0;
              break;
            }
          }
        }
      }
    }
    solid.set(next);
  }
  return out;
}

export function shadowBuffer(src: Uint8ClampedArray, w: number, h: number, dx: number, dy: number, color: Color): Uint8ClampedArray {
  const out = createBuffer(w, h);
  const [r, g, b, a] = unpackColor(color);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (src[(sy * w + sx) * 4 + 3] === 0) continue;
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  // 원본을 그림자 위에 덮기
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    out[i] = src[i];
    out[i + 1] = src[i + 1];
    out[i + 2] = src[i + 2];
    out[i + 3] = src[i + 3];
  }
  return out;
}

function colorOverlay(src: Uint8ClampedArray, color: Color, amount: number): Uint8ClampedArray {
  const out = cloneBuffer(src);
  const [r, g, b] = unpackColor(color);
  const t = Math.max(0, Math.min(1, amount));
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    out[i] = out[i] + (r - out[i]) * t;
    out[i + 1] = out[i + 1] + (g - out[i + 1]) * t;
    out[i + 2] = out[i + 2] + (b - out[i + 2]) * t;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 색 조정                                                              */
/* ------------------------------------------------------------------ */

export function adjustColors(src: Uint8ClampedArray, hue: number, saturation: number, brightness: number, contrast: number): Uint8ClampedArray {
  const out = cloneBuffer(src);
  const c = (contrast / 100 + 1) ** 2;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    let r = out[i];
    let g = out[i + 1];
    let b = out[i + 2];
    if (hue !== 0 || saturation !== 0) {
      const hsv = rgbToHsv(r, g, b);
      hsv.h = (hsv.h + hue + 360) % 360;
      hsv.s = Math.max(0, Math.min(1, hsv.s * (1 + saturation / 100)));
      [r, g, b] = hsvToRgb(hsv.h, hsv.s, hsv.v);
    }
    const bri = (brightness / 100) * 255;
    r = (r - 128) * c + 128 + bri;
    g = (g - 128) * c + 128 + bri;
    b = (b - 128) * c + 128 + bri;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 팔레트 맞추기 + 디더링                                                */
/* ------------------------------------------------------------------ */

const BAYER2 = [0, 2, 3, 1];
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function bayerMatrix(n: 2 | 4 | 8): number[] {
  if (n === 2) return BAYER2;
  if (n === 4) return BAYER4;
  // 8x8 은 4x4 를 확장해서 만듭니다.
  const m: number[] = new Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const q = (y >> 2) * 2 + (x >> 2);
      const base = BAYER4[(y & 3) * 4 + (x & 3)];
      m[y * 8 + x] = base * 4 + [0, 2, 3, 1][q];
    }
  }
  return m;
}

export type ColorMetric = 'rgb' | 'perceptual';

class PaletteMatcher {
  private readonly rgb: [number, number, number][];
  private readonly memo = new Map<number, number>();
  constructor(readonly palette: Color[], private readonly metric: ColorMetric) {
    this.rgb = palette.map((c) => {
      const [r, g, b] = unpackColor(c);
      return [r, g, b];
    });
  }

  nearest(r: number, g: number, b: number): number {
    const rr = Math.max(0, Math.min(255, Math.round(r)));
    const gg = Math.max(0, Math.min(255, Math.round(g)));
    const bb = Math.max(0, Math.min(255, Math.round(b)));
    const key = (rr << 16) | (gg << 8) | bb;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.rgb.length; i++) {
      const [pr, pg, pb] = this.rgb[i];
      const dr = rr - pr;
      const dg = gg - pg;
      const db = bb - pb;
      let d: number;
      if (this.metric === 'perceptual') {
        const rmean = (rr + pr) / 2;
        d = (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
      } else d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (this.memo.size < 200000) this.memo.set(key, best);
    return best;
  }

  rgbAt(i: number): [number, number, number] {
    return this.rgb[i];
  }
}

/**
 * 모든 픽셀을 팔레트의 가장 가까운 색으로 바꿉니다. (투명도는 유지)
 * dither 로 색 경계를 점무늬로 부드럽게 만들 수 있습니다.
 */
export function mapToPalette(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  palette: Color[],
  dither: DitherMode = 'none',
  strength = 100,
  metric: ColorMetric = 'perceptual',
): Uint8ClampedArray {
  const out = cloneBuffer(src);
  if (palette.length === 0) return out;
  const m = new PaletteMatcher(palette, metric);
  const k = Math.max(0, Math.min(2, strength / 100));
  const write = (i: number, idx: number) => {
    const [r, g, b] = m.rgbAt(idx);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  };
  if (dither === 'floyd' || dither === 'atkinson') {
    const err = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        if (src[i + 3] === 0) continue;
        const r = src[i] + err[p * 3];
        const g = src[i + 1] + err[p * 3 + 1];
        const b = src[i + 2] + err[p * 3 + 2];
        const idx = m.nearest(r, g, b);
        write(i, idx);
        const [pr, pg, pb] = m.rgbAt(idx);
        const er = (r - pr) * k;
        const eg = (g - pg) * k;
        const eb = (b - pb) * k;
        const spread =
          dither === 'floyd'
            ? ([
                [1, 0, 7 / 16],
                [-1, 1, 3 / 16],
                [0, 1, 5 / 16],
                [1, 1, 1 / 16],
              ] as const)
            : ([
                [1, 0, 1 / 8],
                [2, 0, 1 / 8],
                [-1, 1, 1 / 8],
                [0, 1, 1 / 8],
                [1, 1, 1 / 8],
                [0, 2, 1 / 8],
              ] as const);
        for (const [dx, dy, wt] of spread) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = (ny * w + nx) * 3;
          err[q] += er * wt;
          err[q + 1] += eg * wt;
          err[q + 2] += eb * wt;
        }
      }
    }
    return out;
  }
  const n = dither === 'bayer2' ? 2 : dither === 'bayer4' ? 4 : dither === 'bayer8' ? 8 : 0;
  const matrix = n ? bayerMatrix(n as 2 | 4 | 8) : null;
  const amp = 64 * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] === 0) continue;
      let off = 0;
      if (matrix) off = ((matrix[(y % n) * n + (x % n)] + 0.5) / (n * n) - 0.5) * amp;
      write(i, m.nearest(src[i] + off, src[i + 1] + off, src[i + 2] + off));
    }
  }
  return out;
}

/** 미디언 컷(Median Cut): 그림에서 가장 대표적인 색 n 개를 뽑습니다. */
export function quantizeColors(src: Uint8ClampedArray, n: number): Color[] {
  const pixels: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(src.length / 4 / 60000));
  for (let i = 0; i < src.length; i += 4 * step) {
    if (src[i + 3] < 128) continue;
    pixels.push([src[i], src[i + 1], src[i + 2]]);
  }
  if (pixels.length === 0) return [];
  let boxes: [number, number, number][][] = [pixels];
  while (boxes.length < n) {
    // 범위가 가장 넓은 상자를 반으로 나눕니다.
    let bestIdx = -1;
    let bestRange = -1;
    let bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let min = 255;
        let max = 0;
        for (const p of box) {
          if (p[ch] < min) min = p[ch];
          if (p[ch] > max) max = p[ch];
        }
        if (max - min > bestRange) {
          bestRange = max - min;
          bestIdx = i;
          bestCh = ch;
        }
      }
    });
    if (bestIdx < 0 || bestRange <= 0) break;
    const box = boxes[bestIdx].slice().sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = Math.floor(box.length / 2);
    boxes = [...boxes.slice(0, bestIdx), box.slice(0, mid), box.slice(mid), ...boxes.slice(bestIdx + 1)];
  }
  const colors = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const p of box) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    const len = box.length;
    return (((Math.round(r / len) << 24) | (Math.round(g / len) << 16) | (Math.round(b / len) << 8) | 255) >>> 0) as Color;
  });
  return Array.from(new Set(colors));
}

/* ------------------------------------------------------------------ */
/* 픽셀화 / 축소                                                         */
/* ------------------------------------------------------------------ */

export type ResampleMode = 'nearest' | 'average' | 'mode';

/**
 * 고해상도 그림을 작은 크기로 줄입니다. (픽셀아트 변환의 첫 단계)
 *  - nearest: 각 칸의 가운데 픽셀
 *  - average: 각 칸의 평균 색 (부드러움)
 *  - mode: 각 칸에서 가장 많이 나온 색 (선명함, 픽셀아트에 추천)
 */
export function downscale(src: Uint8ClampedArray, w: number, h: number, nw: number, nh: number, mode: ResampleMode): Uint8ClampedArray {
  const out = createBuffer(nw, nh);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      const o = (y * nw + x) * 4;
      if (mode === 'nearest') {
        const sx = Math.min(w - 1, Math.floor((x0 + x1) / 2));
        const sy = Math.min(h - 1, Math.floor((y0 + y1) / 2));
        const s = (sy * w + sx) * 4;
        out[o] = src[s];
        out[o + 1] = src[s + 1];
        out[o + 2] = src[s + 2];
        out[o + 3] = src[s + 3];
        continue;
      }
      if (mode === 'average') {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const s = (yy * w + xx) * 4;
            const al = src[s + 3];
            r += src[s] * al;
            g += src[s + 1] * al;
            b += src[s + 2] * al;
            a += al;
            count++;
          }
        }
        if (a > 0) {
          out[o] = r / a;
          out[o + 1] = g / a;
          out[o + 2] = b / a;
        }
        out[o + 3] = a / count;
        continue;
      }
      // mode: 가장 많이 나온 색 (비슷한 색은 묶어서 셉니다)
      const counts = new Map<number, { n: number; r: number; g: number; b: number; a: number }>();
      let transparent = 0;
      let total = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const s = (yy * w + xx) * 4;
          total++;
          if (src[s + 3] < 128) {
            transparent++;
            continue;
          }
          const key = ((src[s] >> 3) << 10) | ((src[s + 1] >> 3) << 5) | (src[s + 2] >> 3);
          const c = counts.get(key);
          if (c) {
            c.n++;
            c.r += src[s];
            c.g += src[s + 1];
            c.b += src[s + 2];
            c.a += src[s + 3];
          } else counts.set(key, { n: 1, r: src[s], g: src[s + 1], b: src[s + 2], a: src[s + 3] });
        }
      }
      if (transparent * 2 > total || counts.size === 0) continue;
      let best = { n: 0, r: 0, g: 0, b: 0, a: 0 };
      counts.forEach((c) => {
        if (c.n > best.n) best = c;
      });
      out[o] = best.r / best.n;
      out[o + 1] = best.g / best.n;
      out[o + 2] = best.b / best.n;
      out[o + 3] = best.a / best.n;
    }
  }
  return out;
}

/** 같은 크기를 유지하면서 size×size 블록으로 뭉개기 (모자이크) */
export function pixelateBuffer(src: Uint8ClampedArray, w: number, h: number, size: number, mode: ResampleMode): Uint8ClampedArray {
  const s = Math.max(1, Math.round(size));
  if (s <= 1) return src;
  const nw = Math.ceil(w / s);
  const nh = Math.ceil(h / s);
  const small = downscale(src, w, h, nw, nh, mode);
  const out = createBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (Math.min(nh - 1, Math.floor(y / s)) * nw + Math.min(nw - 1, Math.floor(x / s))) * 4;
      const o = (y * w + x) * 4;
      out[o] = small[si];
      out[o + 1] = small[si + 1];
      out[o + 2] = small[si + 2];
      out[o + 3] = small[si + 3];
    }
  }
  return out;
}

export function alphaThreshold(src: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  const out = cloneBuffer(src);
  for (let i = 3; i < out.length; i += 4) out[i] = out[i] >= threshold ? 255 : 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* 컬러 사이클 / 팔레트 교체                                             */
/* ------------------------------------------------------------------ */

function colorCycle(src: Uint8ClampedArray, palette: Color[], from: number, to: number, shift: number): Uint8ClampedArray {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(palette.length - 1, Math.max(from, to));
  const len = b - a + 1;
  if (len < 2) return src;
  const lookup = new Map<number, Color>();
  for (let i = a; i <= b; i++) {
    const target = a + ((((i - a + shift) % len) + len) % len);
    lookup.set(palette[i] >>> 8, palette[target]);
  }
  const out = cloneBuffer(src);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const key = ((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]) >>> 0;
    const c = lookup.get(key);
    if (c === undefined) continue;
    out[i] = (c >>> 24) & 255;
    out[i + 1] = (c >>> 16) & 255;
    out[i + 2] = (c >>> 8) & 255;
  }
  return out;
}

function swapColors(src: Uint8ClampedArray, pairs: [Color, Color][]): Uint8ClampedArray {
  const lookup = new Map<number, Color>();
  for (const [a, b] of pairs) if (a !== b) lookup.set(a >>> 8, b);
  if (lookup.size === 0) return src;
  const out = cloneBuffer(src);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const c = lookup.get(((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]) >>> 0);
    if (c === undefined) continue;
    out[i] = (c >>> 24) & 255;
    out[i + 1] = (c >>> 16) & 255;
    out[i + 2] = (c >>> 8) & 255;
    out[i + 3] = Math.min(out[i + 3], c & 255);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 모션 효과 (프레임마다 자동으로 움직임)                                  */
/* ------------------------------------------------------------------ */

/**
 * 반복 주기 안에서의 진행도 (cycles 단위).
 * loopFrames=0 이면 "전체 프레임 수" 를 한 바퀴로 써서 애니메이션이 자연스럽게 반복됩니다.
 */
function loopPhase(ctx: EffectContext, speed: number, loopFrames: number): number {
  const total = loopFrames > 0 ? loopFrames : Math.max(1, ctx.project.frames.length);
  return ((ctx.frameIndex % total) / total) * speed;
}

export type SwayAnchor = 'bottom' | 'top' | 'left' | 'right' | 'none';

/**
 * 흔들림(바람/머리카락/깃발/물결)
 *  - anchor 쪽은 고정되고, 반대쪽으로 갈수록 크게 흔들립니다.
 *    풀/나무 = 아래 고정, 머리카락/망토 = 위 고정, 깃발 = 왼쪽 고정, 물결 = 고정 없음
 *  - 줄(또는 열) 단위로 정수 픽셀만큼 밀어서 도트가 깨지지 않습니다.
 */
export function swayBuffer(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  amplitude: number,
  wavelength: number,
  phase: number,
  anchor: SwayAnchor,
  curve: number,
): Uint8ClampedArray {
  const b = contentBounds(src, w, h);
  if (!b || amplitude === 0) return src;
  const out = createBuffer(w, h);
  const vertical = anchor === 'left' || anchor === 'right';
  const lines = vertical ? w : h;
  const len = vertical ? h : w;
  const lam = Math.max(1, wavelength);
  for (let i = 0; i < lines; i++) {
    let d = 1;
    if (anchor === 'bottom') d = (b.y + b.h - 1 - i) / Math.max(1, b.h - 1);
    else if (anchor === 'top') d = (i - b.y) / Math.max(1, b.h - 1);
    else if (anchor === 'left') d = (i - b.x) / Math.max(1, b.w - 1);
    else if (anchor === 'right') d = (b.x + b.w - 1 - i) / Math.max(1, b.w - 1);
    d = Math.max(0, Math.min(1, d));
    const weight = anchor === 'none' ? 1 : d ** Math.max(0.2, curve);
    const off = Math.round(amplitude * weight * Math.sin(2 * Math.PI * (phase + i / lam)));
    for (let j = 0; j < len; j++) {
      const sj = j - off;
      if (sj < 0 || sj >= len) continue;
      const s = vertical ? (sj * w + i) * 4 : (i * w + sj) * 4;
      const o = vertical ? (j * w + i) * 4 : (i * w + j) * 4;
      out[o] = src[s];
      out[o + 1] = src[s + 1];
      out[o + 2] = src[s + 2];
      out[o + 3] = src[s + 3];
    }
  }
  return out;
}

/** 숨쉬기/출렁임: 아래쪽을 기준으로 세로로 늘었다 줄었다 (가로는 반대로 살짝) */
export function breatheBuffer(src: Uint8ClampedArray, w: number, h: number, amountPct: number, phase: number): Uint8ClampedArray {
  const b = contentBounds(src, w, h);
  if (!b || amountPct === 0) return src;
  const sy = 1 + (amountPct / 100) * Math.sin(2 * Math.PI * phase);
  const sx = 1 - (sy - 1) * 0.5;
  const cx = b.x + b.w / 2;
  const by = b.y + b.h;
  const out = createBuffer(w, h);
  for (let y = 0; y < h; y++) {
    const syy = Math.floor(by + (y + 0.5 - by) / sy);
    if (syy < 0 || syy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sxx = Math.floor(cx + (x + 0.5 - cx) / sx);
      if (sxx < 0 || sxx >= w) continue;
      const s = (syy * w + sxx) * 4;
      const o = (y * w + x) * 4;
      out[o] = src[s];
      out[o + 1] = src[s + 1];
      out[o + 2] = src[s + 2];
      out[o + 3] = src[s + 3];
    }
  }
  return out;
}

/** 프레임 번호로 정해지는 의사 난수 (-1 ~ 1) */
function hashNoise(n: number, seed: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35);
  x ^= x >>> 13;
  x = Math.imul(x, 0x27d4eb2f);
  x ^= x >>> 16;
  return ((x >>> 0) / 4294967295) * 2 - 1;
}

/* ------------------------------------------------------------------ */
/* 효과 목록                                                             */
/* ------------------------------------------------------------------ */

function paletteFor(source: string, ctx: EffectContext): Color[] {
  if (source === 'project') return ctx.project.palette;
  return presetToColors(getPreset(source));
}

export const EFFECTS: EffectDef[] = [
  {
    type: 'outline',
    params: [
      { key: 'color', kind: 'color', default: '#181425ff' },
      { key: 'thickness', kind: 'number', default: 1, min: 1, max: 4, step: 1 },
      { key: 'position', kind: 'select', default: 'outside', options: ['outside', 'inside'] },
      { key: 'diagonal', kind: 'boolean', default: false },
      { key: 'auto', kind: 'boolean', default: false },
    ],
    apply: (src, w, h, p) =>
      outlineBuffer(
        src,
        w,
        h,
        colorParam(p.color, 0x181425ff),
        num(p.thickness, 1),
        str(p.position, 'outside') as 'outside' | 'inside',
        !!p.diagonal,
        !!p.auto,
      ),
  },
  {
    type: 'shadow',
    params: [
      { key: 'dx', kind: 'number', default: 1, min: -16, max: 16, step: 1 },
      { key: 'dy', kind: 'number', default: 1, min: -16, max: 16, step: 1 },
      { key: 'color', kind: 'color', default: '#00000080' },
    ],
    apply: (src, w, h, p) => shadowBuffer(src, w, h, Math.round(num(p.dx, 1)), Math.round(num(p.dy, 1)), colorParam(p.color, 0x00000080)),
  },
  {
    type: 'colorAdjust',
    params: [
      { key: 'hue', kind: 'number', default: 0, min: -180, max: 180, step: 1 },
      { key: 'saturation', kind: 'number', default: 0, min: -100, max: 100, step: 1 },
      { key: 'brightness', kind: 'number', default: 0, min: -100, max: 100, step: 1 },
      { key: 'contrast', kind: 'number', default: 0, min: -100, max: 100, step: 1 },
    ],
    apply: (src, _w, _h, p) => adjustColors(src, num(p.hue, 0), num(p.saturation, 0), num(p.brightness, 0), num(p.contrast, 0)),
  },
  {
    type: 'indexPalette',
    usesPalette: true,
    params: [
      { key: 'palette', kind: 'select', default: 'project', options: ['project', 'endesga32', 'pico8', 'sweetie16', 'db16', 'db32', 'gameboy', 'grayscale', '1bit'] },
      { key: 'dither', kind: 'select', default: 'none', options: DITHER_MODES },
      { key: 'strength', kind: 'number', default: 50, min: 0, max: 200, step: 5 },
      { key: 'metric', kind: 'select', default: 'perceptual', options: ['perceptual', 'rgb'] },
    ],
    apply: (src, w, h, p, ctx) =>
      mapToPalette(src, w, h, paletteFor(str(p.palette, 'project'), ctx), str(p.dither, 'none') as DitherMode, num(p.strength, 50), str(p.metric, 'perceptual') as ColorMetric),
  },
  {
    type: 'quantize',
    params: [
      { key: 'colors', kind: 'number', default: 8, min: 2, max: 64, step: 1 },
      { key: 'dither', kind: 'select', default: 'none', options: DITHER_MODES },
      { key: 'strength', kind: 'number', default: 50, min: 0, max: 200, step: 5 },
    ],
    apply: (src, w, h, p) => mapToPalette(src, w, h, quantizeColors(src, Math.round(num(p.colors, 8))), str(p.dither, 'none') as DitherMode, num(p.strength, 50)),
  },
  {
    type: 'pixelate',
    params: [
      { key: 'size', kind: 'number', default: 2, min: 2, max: 32, step: 1 },
      { key: 'mode', kind: 'select', default: 'mode', options: ['mode', 'average', 'nearest'] },
    ],
    apply: (src, w, h, p) => pixelateBuffer(src, w, h, num(p.size, 2), str(p.mode, 'mode') as ResampleMode),
  },
  {
    type: 'alphaThreshold',
    params: [{ key: 'threshold', kind: 'number', default: 128, min: 1, max: 255, step: 1 }],
    apply: (src, _w, _h, p) => alphaThreshold(src, num(p.threshold, 128)),
  },
  {
    type: 'colorOverlay',
    params: [
      { key: 'color', kind: 'color', default: '#ffffffff' },
      { key: 'amount', kind: 'number', default: 100, min: 0, max: 100, step: 1 },
    ],
    apply: (src, _w, _h, p) => colorOverlay(src, colorParam(p.color, 0xffffffff), num(p.amount, 100) / 100),
  },
  {
    type: 'colorCycle',
    frameDependent: true,
    usesPalette: true,
    params: [
      { key: 'from', kind: 'number', default: 0, min: 0, max: 255, step: 1 },
      { key: 'to', kind: 'number', default: 3, min: 0, max: 255, step: 1 },
      { key: 'speed', kind: 'number', default: 1, min: 1, max: 30, step: 1 },
      { key: 'reverse', kind: 'boolean', default: false },
    ],
    apply: (src, _w, _h, p, ctx) => {
      const speed = Math.max(1, Math.round(num(p.speed, 1)));
      const step = Math.floor(ctx.frameIndex / speed) * (p.reverse ? -1 : 1);
      return colorCycle(src, ctx.project.palette, Math.round(num(p.from, 0)), Math.round(num(p.to, 3)), step);
    },
  },
  {
    type: 'sway',
    frameDependent: true,
    params: [
      { key: 'anchor', kind: 'select', default: 'bottom', options: ['bottom', 'top', 'left', 'right', 'none'] },
      { key: 'amplitude', kind: 'number', default: 1, min: -12, max: 12, step: 1 },
      { key: 'wavelength', kind: 'number', default: 24, min: 2, max: 256, step: 1 },
      { key: 'speed', kind: 'number', default: 1, min: 0, max: 8, step: 1 },
      { key: 'curve', kind: 'number', default: 1.5, min: 0.2, max: 4, step: 0.1 },
      { key: 'loopFrames', kind: 'number', default: 0, min: 0, max: 600, step: 1 },
    ],
    apply: (src, w, h, p, ctx) =>
      swayBuffer(
        src,
        w,
        h,
        num(p.amplitude, 1),
        num(p.wavelength, 24),
        loopPhase(ctx, num(p.speed, 1), num(p.loopFrames, 0)),
        str(p.anchor, 'bottom') as SwayAnchor,
        num(p.curve, 1.5),
      ),
  },
  {
    type: 'breathe',
    frameDependent: true,
    params: [
      { key: 'amount', kind: 'number', default: 6, min: -40, max: 40, step: 1 },
      { key: 'speed', kind: 'number', default: 1, min: 0, max: 8, step: 1 },
      { key: 'loopFrames', kind: 'number', default: 0, min: 0, max: 600, step: 1 },
    ],
    apply: (src, w, h, p, ctx) => breatheBuffer(src, w, h, num(p.amount, 6), loopPhase(ctx, num(p.speed, 1), num(p.loopFrames, 0))),
  },
  {
    type: 'bob',
    frameDependent: true,
    params: [
      { key: 'amplitude', kind: 'number', default: 1, min: -16, max: 16, step: 1 },
      { key: 'horizontal', kind: 'boolean', default: false },
      { key: 'speed', kind: 'number', default: 1, min: 0, max: 8, step: 1 },
      { key: 'loopFrames', kind: 'number', default: 0, min: 0, max: 600, step: 1 },
    ],
    apply: (src, w, h, p, ctx) => {
      const off = Math.round(num(p.amplitude, 1) * Math.sin(2 * Math.PI * loopPhase(ctx, num(p.speed, 1), num(p.loopFrames, 0))));
      if (off === 0) return src;
      return p.horizontal ? resizeBuffer(src, w, h, w, h, off, 0) : resizeBuffer(src, w, h, w, h, 0, off);
    },
  },
  {
    type: 'shake',
    frameDependent: true,
    params: [
      { key: 'amplitude', kind: 'number', default: 1, min: 0, max: 16, step: 1 },
      { key: 'seed', kind: 'number', default: 1, min: 0, max: 9999, step: 1 },
    ],
    apply: (src, w, h, p, ctx) => {
      const a = num(p.amplitude, 1);
      const seed = num(p.seed, 1);
      const dx = Math.round(hashNoise(ctx.frameIndex, seed) * a);
      const dy = Math.round(hashNoise(ctx.frameIndex + 7919, seed) * a);
      if (dx === 0 && dy === 0) return src;
      return resizeBuffer(src, w, h, w, h, dx, dy);
    },
  },
  {
    type: 'flicker',
    frameDependent: true,
    params: [
      { key: 'interval', kind: 'number', default: 2, min: 2, max: 30, step: 1 },
      { key: 'opacity', kind: 'number', default: 0, min: 0, max: 100, step: 5 },
    ],
    apply: (src, _w, _h, p, ctx) => {
      const interval = Math.max(2, Math.round(num(p.interval, 2)));
      if (ctx.frameIndex % interval < interval / 2) return src;
      const out = cloneBuffer(src);
      const k = num(p.opacity, 0) / 100;
      for (let i = 3; i < out.length; i += 4) out[i] = out[i] * k;
      return out;
    },
  },
  {
    type: 'paletteSwap',
    params: [
      { key: 'from1', kind: 'color', default: '#000000ff' },
      { key: 'to1', kind: 'color', default: '#000000ff' },
      { key: 'from2', kind: 'color', default: '#000000ff' },
      { key: 'to2', kind: 'color', default: '#000000ff' },
      { key: 'from3', kind: 'color', default: '#000000ff' },
      { key: 'to3', kind: 'color', default: '#000000ff' },
    ],
    apply: (src, _w, _h, p) =>
      swapColors(src, [
        [colorParam(p.from1, 0), colorParam(p.to1, 0)],
        [colorParam(p.from2, 0), colorParam(p.to2, 0)],
        [colorParam(p.from3, 0), colorParam(p.to3, 0)],
      ]),
  },
];

/* ------------------------------------------------------------------ */
/* 원클릭 프리셋 (초보자용)                                               */
/* ------------------------------------------------------------------ */

export type EffectGroup = 'outline' | 'motion' | 'color' | 'pixel';

export interface EffectPreset {
  id: string;
  type: string;
  group: EffectGroup;
  params: Record<string, EffectParamValue>;
  /** 효과 값 키프레임 (offset = 지금 프레임에서 몇 프레임 뒤. 음수 키는 앞 프레임이 있을 때만 찍어요) */
  keys?: { offset: number; values: Record<string, number>; ease?: EaseKind }[];
}

export const EFFECT_PRESETS: EffectPreset[] = [
  { id: 'whiteBorder', type: 'outline', group: 'outline', params: { color: '#ffffffff', thickness: 1, position: 'outside', diagonal: true } },
  { id: 'blackOutline', type: 'outline', group: 'outline', params: { color: '#181425ff', thickness: 1, position: 'outside', diagonal: false } },
  { id: 'selout', type: 'outline', group: 'outline', params: { color: '#000000ff', thickness: 1, position: 'inside', diagonal: false, auto: true } },
  { id: 'dropShadow', type: 'shadow', group: 'outline', params: { dx: 1, dy: 1, color: '#00000066' } },
  { id: 'hairSway', type: 'sway', group: 'motion', params: { anchor: 'top', amplitude: 1, wavelength: 16, speed: 1, curve: 1.5 } },
  { id: 'grassSway', type: 'sway', group: 'motion', params: { anchor: 'bottom', amplitude: 1, wavelength: 32, speed: 1, curve: 1.2 } },
  { id: 'flag', type: 'sway', group: 'motion', params: { anchor: 'left', amplitude: 1, wavelength: 12, speed: 2, curve: 1 } },
  { id: 'water', type: 'sway', group: 'motion', params: { anchor: 'none', amplitude: 1, wavelength: 8, speed: 2, curve: 1 } },
  { id: 'breathe', type: 'breathe', group: 'motion', params: { amount: 5, speed: 1 } },
  { id: 'float', type: 'bob', group: 'motion', params: { amplitude: 1, speed: 1 } },
  { id: 'hitShake', type: 'shake', group: 'motion', params: { amplitude: 1 } },
  { id: 'invincible', type: 'flicker', group: 'motion', params: { interval: 2, opacity: 20 } },
  { id: 'hitFlash', type: 'colorOverlay', group: 'color', params: { color: '#ffffffff', amount: 100 } },
  {
    id: 'flashFade',
    type: 'colorOverlay',
    group: 'color',
    params: { color: '#ffffffff', amount: 100 },
    keys: [
      { offset: -1, values: { amount: 0 }, ease: 'step' },
      { offset: 0, values: { amount: 100 }, ease: 'easeOut' },
      { offset: 3, values: { amount: 0 } },
    ],
  },
  {
    id: 'fadeIn',
    type: 'colorAdjust',
    group: 'color',
    params: { hue: 0, saturation: 0, brightness: -100, contrast: 0 },
    keys: [
      { offset: 0, values: { brightness: -100 }, ease: 'easeInOut' },
      { offset: 5, values: { brightness: 0 } },
    ],
  },
  { id: 'nightTone', type: 'colorAdjust', group: 'color', params: { hue: 20, saturation: -30, brightness: -25, contrast: 0 } },
  { id: 'retroPalette', type: 'indexPalette', group: 'pixel', params: { palette: 'pico8', dither: 'bayer4', strength: 40 } },
  { id: 'gameboy', type: 'indexPalette', group: 'pixel', params: { palette: 'gameboy', dither: 'bayer4', strength: 60 } },
  { id: 'fewColors', type: 'quantize', group: 'pixel', params: { colors: 8, dither: 'none' } },
];

export function effectDef(type: string): EffectDef | undefined {
  return EFFECTS.find((e) => e.type === type);
}

export function defaultParams(type: string): Record<string, EffectParamValue> {
  const def = effectDef(type);
  const params: Record<string, EffectParamValue> = {};
  for (const d of def?.params ?? []) params[d.key] = d.default;
  return params;
}

/** 효과 목록을 차례로 적용합니다. (켜진 것만, 효과 값 키프레임이 있으면 이 프레임의 값으로) */
export function applyEffects(src: Uint8ClampedArray, w: number, h: number, effects: Effect[], ctx: EffectContext): Uint8ClampedArray {
  let buf = src;
  for (const e of effects) {
    if (!e.enabled) continue;
    const def = effectDef(e.type);
    if (!def) continue;
    buf = def.apply(buf, w, h, effectParamsAt(ctx.project, e, ctx.frameIndex), ctx);
  }
  return buf;
}

/**
 * 캐시 키: 효과 설정 + (필요하면) 프레임 번호와 팔레트.
 * 키프레임이 있는 효과는 "이 프레임에서 계산된 값"을 넣어서, 값이 같은 프레임끼리는 결과를 함께 씁니다.
 */
export function effectsKey(effects: Effect[], frameIndex: number, p: Project): string {
  let key = '';
  for (const e of effects) {
    if (!e.enabled) continue;
    const def = effectDef(e.type);
    key += `${e.type}${JSON.stringify(isEffectAnimated(e) ? effectParamsAt(p, e, frameIndex) : e.params)}`;
    if (def?.frameDependent) key += `@${frameIndex}`;
    if (def?.usesPalette) key += `#${p.palette.map((c) => colorToHex(c)).join('')}`;
    key += ';';
  }
  return key;
}
