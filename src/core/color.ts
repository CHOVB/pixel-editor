/**
 * 색상 유틸리티
 * ------------------------------------------------------------
 * 색은 0xRRGGBBAA 형태의 숫자 하나로 다룹니다.
 * 숫자 하나로 다루면 비교(===)가 빠르고, 팔레트/채우기 계산이 단순해집니다.
 */
import type { Color } from './types';

/** 완전히 투명한 색 */
export const TRANSPARENT: Color = 0;

/** r,g,b,a (0~255) → 색 숫자 */
export function packColor(r: number, g: number, b: number, a = 255): Color {
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
}

/** 색 숫자 → [r,g,b,a] */
export function unpackColor(c: Color): [number, number, number, number] {
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
}

export function alphaOf(c: Color): number {
  return c & 255;
}

/** 알파값만 바꾼 새 색을 돌려줍니다. */
export function withAlpha(c: Color, a: number): Color {
  return ((c & 0xffffff00) | (a & 255)) >>> 0;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/**
 * 색 → "#rrggbb" 문자열. 알파가 255가 아니면 "#rrggbbaa" 로 만듭니다.
 * forceAlpha=true 이면 항상 8자리로 만듭니다.
 */
export function colorToHex(c: Color, forceAlpha = false): string {
  const [r, g, b, a] = unpackColor(c);
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return forceAlpha || a !== 255 ? base + hex2(a) : base;
}

/**
 * "#rgb", "#rgba", "#rrggbb", "#rrggbbaa" (# 생략 가능) → 색.
 * 잘못된 문자열이면 null 을 돌려줍니다.
 */
export function hexToColor(input: string): Color | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(s)) return null;
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = parseInt(s.slice(6, 8), 16);
  return packColor(r, g, b, a);
}

/** CSS 에서 바로 쓸 수 있는 "rgba(...)" 문자열 */
export function colorToCss(c: Color): string {
  const [r, g, b, a] = unpackColor(c);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export interface HSV {
  /** 0 ~ 360 */
  h: number;
  /** 0 ~ 1 */
  s: number;
  /** 0 ~ 1 */
  v: number;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** 두 색의 거리 (각 채널 차이 중 최댓값, 0~255). 채우기 허용 오차 계산에 사용 */
export function colorDistance(a: Color, b: Color): number {
  const [r1, g1, b1, a1] = unpackColor(a);
  const [r2, g2, b2, a2] = unpackColor(b);
  return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2), Math.abs(a1 - a2));
}

/** 밝기(0~1). 팔레트 정렬이나 글자색 대비 계산에 사용 */
export function luminance(c: Color): number {
  const [r, g, b] = unpackColor(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
