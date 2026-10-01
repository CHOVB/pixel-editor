/**
 * VFX(시각 효과) 타이밍 분석 & 절차적 이펙트 생성
 * ------------------------------------------------------------
 * "이 동작에서 어느 프레임에 먼지/충격/베기 효과를 넣으면 자연스러울까?" 를 자동으로 찾아줍니다.
 *
 *  분석 방법 (프레임마다 그림을 비교)
 *   - 착지(발 닿음): 가장 아래 픽셀이 내려오다가 멈추는 프레임 → 먼지(dust)
 *   - 타격(임팩트): 크게 움직이다가 갑자기 멈추는 프레임 → 충격 스파크(impact)
 *   - 빠른 휘두르기: 움직임이 가장 큰 프레임 → 베기 잔상(slash)
 *   - 빠른 이동: 그림 전체가 크게 옮겨간 프레임 → 속도선(speedLines)
 *   - 최고점: 점프의 가장 높은 프레임 → 반짝(sparkle)
 *
 *  각 이펙트는 몇 프레임짜리 작은 도트 애니메이션으로 "직접 계산해서" 그립니다. (외부 파일 불필요)
 */
import { hexToColor } from './color';
import { createBuffer } from './pixels';
import type { Color, Point } from './types';

export type VfxKind = 'dust' | 'impact' | 'slash' | 'speedLines' | 'sparkle';
export const VFX_KINDS: VfxKind[] = ['dust', 'impact', 'slash', 'speedLines', 'sparkle'];

export interface FrameMetrics {
  /** 보이는 픽셀이 있는지 */
  empty: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  count: number;
  /** 이전 프레임과 달라진 픽셀 수 */
  diff: number;
  /** 달라진 픽셀들의 중심 */
  diffCx: number;
  diffCy: number;
  /** 움직인 방향 (새로 생긴 픽셀 중심 - 사라진 픽셀 중심) */
  dirX: number;
  dirY: number;
}

export interface VfxSuggestion {
  frame: number;
  kind: VfxKind;
  x: number;
  y: number;
  /** 방향 (도, 0=오른쪽) */
  angle: number;
  /** 0~1 추천 강도 */
  score: number;
  /** 이유 코드 (번역 키에 사용) */
  reason: 'landing' | 'impact' | 'fastSwing' | 'fastMove' | 'apex';
}

export function analyzeFrames(frames: Uint8ClampedArray[], w: number, h: number): FrameMetrics[] {
  const out: FrameMetrics[] = [];
  frames.forEach((buf, fi) => {
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (buf[(y * w + x) * 4 + 3] < 32) continue;
        count++;
        sx += x;
        sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    let diff = 0;
    let dx = 0;
    let dy = 0;
    let addX = 0;
    let addY = 0;
    let addN = 0;
    let remX = 0;
    let remY = 0;
    let remN = 0;
    const prev = fi > 0 ? frames[fi - 1] : null;
    if (prev) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const a = buf[i + 3] >= 32;
          const b = prev[i + 3] >= 32;
          const changed = a !== b || (a && (buf[i] !== prev[i] || buf[i + 1] !== prev[i + 1] || buf[i + 2] !== prev[i + 2]));
          if (!changed) continue;
          diff++;
          dx += x;
          dy += y;
          if (a && !b) {
            addX += x;
            addY += y;
            addN++;
          } else if (!a && b) {
            remX += x;
            remY += y;
            remN++;
          }
        }
      }
    }
    out.push({
      empty: count === 0,
      minX,
      minY,
      maxX,
      maxY,
      cx: count ? sx / count : w / 2,
      cy: count ? sy / count : h / 2,
      count,
      diff,
      diffCx: diff ? dx / diff : w / 2,
      diffCy: diff ? dy / diff : h / 2,
      dirX: addN && remN ? addX / addN - remX / remN : 0,
      dirY: addN && remN ? addY / addN - remY / remN : 0,
    });
  });
  return out;
}

/** 동작을 분석해서 VFX 를 넣기 좋은 프레임을 추천합니다. (점수 순) */
export function suggestVfx(metrics: FrameMetrics[]): VfxSuggestion[] {
  const n = metrics.length;
  if (n < 2) return [];
  const out: VfxSuggestion[] = [];
  const diffs = metrics.map((m) => m.diff);
  const sorted = [...diffs].sort((a, b) => a - b);
  const maxDiff = Math.max(1, sorted[sorted.length - 1]);
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const highCut = sorted[Math.floor(sorted.length * 0.75)];
  const at = (i: number) => metrics[(i + n) % n];

  for (let i = 0; i < n; i++) {
    const m = metrics[i];
    if (m.empty) continue;
    const prev = at(i - 1);
    const next = at(i + 1);
    // 착지: 가장 아래 픽셀이 이전보다 내려왔고, 다음 프레임에서는 더 내려가지 않음
    if (!prev.empty && m.maxY > prev.maxY && next.maxY <= m.maxY) {
      out.push({ frame: i, kind: 'dust', x: m.cx, y: m.maxY, angle: 0, score: Math.min(1, 0.5 + (m.maxY - prev.maxY) / 6), reason: 'landing' });
    }
    // 타격: 많이 움직였다가 다음 프레임에 갑자기 멈춤
    if (m.diff >= highCut && m.diff > mean * 1.3 && next.diff < m.diff * 0.45) {
      const angle = (Math.atan2(m.dirY, m.dirX) * 180) / Math.PI;
      const tipX = m.dirX >= 0 ? m.maxX : m.minX;
      out.push({ frame: i, kind: 'impact', x: Math.abs(m.dirX) > Math.abs(m.dirY) ? tipX : m.diffCx, y: m.diffCy, angle, score: Math.min(1, m.diff / maxDiff + 0.2), reason: 'impact' });
    }
    // 빠른 휘두르기: 움직임이 가장 큰 구간
    if (m.diff === maxDiff && m.diff > mean * 1.5) {
      const angle = (Math.atan2(m.dirY, m.dirX) * 180) / Math.PI;
      out.push({ frame: i, kind: 'slash', x: m.diffCx, y: m.diffCy, angle, score: 0.9, reason: 'fastSwing' });
    }
    // 빠른 이동: 중심이 크게 이동
    const move = Math.hypot(m.cx - prev.cx, m.cy - prev.cy);
    if (!prev.empty && move >= 3) {
      const angle = (Math.atan2(m.cy - prev.cy, m.cx - prev.cx) * 180) / Math.PI;
      out.push({ frame: i, kind: 'speedLines', x: m.cx, y: m.cy, angle, score: Math.min(1, move / 10), reason: 'fastMove' });
    }
    // 최고점: 위쪽 끝이 가장 높고 앞뒤보다 높음
    if (!prev.empty && !next.empty && m.minY < prev.minY && m.minY <= next.minY && m.minY < Math.max(...metrics.map((q) => q.minY)) - 2) {
      out.push({ frame: i, kind: 'sparkle', x: m.cx, y: m.minY, angle: -90, score: 0.4, reason: 'apex' });
    }
  }
  // 같은 프레임/종류 중복 제거
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const k = `${s.frame}:${s.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/* ------------------------------------------------------------------ */
/* 절차적 이펙트 스프라이트                                               */
/* ------------------------------------------------------------------ */

export interface VfxStyle {
  colors: string[];
  /** 크기 배율 (1 = 기본) */
  size: number;
}

export const DEFAULT_VFX_STYLE: Record<VfxKind, VfxStyle> = {
  dust: { colors: ['#e8b796', '#c28569', '#733e39'], size: 1 },
  impact: { colors: ['#ffffff', '#fee761', '#feae34'], size: 1 },
  slash: { colors: ['#ffffff', '#c0cbdc', '#8b9bb4'], size: 1 },
  speedLines: { colors: ['#ffffff', '#c0cbdc'], size: 1 },
  sparkle: { colors: ['#ffffff', '#fee761', '#2ce8f5'], size: 1 },
};

/** 몇 프레임짜리 이펙트인지 */
export const VFX_LENGTH: Record<VfxKind, number> = { dust: 5, impact: 4, slash: 3, speedLines: 3, sparkle: 4 };

function plot(buf: Uint8ClampedArray, w: number, h: number, x: number, y: number, c: Color): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  const o = (yi * w + xi) * 4;
  buf[o] = (c >>> 24) & 255;
  buf[o + 1] = (c >>> 16) & 255;
  buf[o + 2] = (c >>> 8) & 255;
  buf[o + 3] = c & 255;
}

function col(style: VfxStyle, t: number): Color {
  const list = style.colors.map((h) => hexToColor(h) ?? 0xffffffff);
  return list[Math.min(list.length - 1, Math.floor(t * list.length))];
}

/**
 * 캔버스 크기의 이펙트 한 장 (step = 0 ~ VFX_LENGTH-1) 을 그립니다.
 * at: 이펙트 중심, angle: 방향(도)
 */
export function drawVfx(kind: VfxKind, step: number, w: number, h: number, at: Point, angle: number, style: VfxStyle = DEFAULT_VFX_STYLE[kind]): Uint8ClampedArray {
  const buf = createBuffer(w, h);
  const len = VFX_LENGTH[kind];
  const t = step / Math.max(1, len - 1);
  const s = style.size;
  const rad = (angle * Math.PI) / 180;
  switch (kind) {
    case 'dust': {
      // 좌우로 퍼지며 작아지는 먼지 구름 두 덩이
      const spread = (2 + step * 2.2) * s;
      const r = Math.max(0.6, (2.6 - step * 0.45) * s);
      for (const side of [-1, 1]) {
        const cx = at.x + side * spread;
        const cy = at.y - 1 - step * 0.6 * s;
        for (let yy = -Math.ceil(r); yy <= Math.ceil(r); yy++) {
          for (let xx = -Math.ceil(r); xx <= Math.ceil(r); xx++) {
            if (xx * xx + yy * yy > r * r) continue;
            plot(buf, w, h, cx + xx, cy + yy, col(style, yy < 0 ? t * 0.6 : t * 0.6 + 0.4));
          }
        }
      }
      break;
    }
    case 'impact': {
      // 별 모양으로 뻗는 선 + 가운데 섬광
      const rays = 8;
      const inner = (1 + step * 1.5) * s;
      const outer = inner + (3 - step * 0.5) * s;
      for (let k = 0; k < rays; k++) {
        const a = rad + (k * Math.PI * 2) / rays;
        const long = k % 2 === 0 ? 1 : 0.6;
        for (let d = inner; d <= inner + (outer - inner) * long; d += 0.5) plot(buf, w, h, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, col(style, t));
      }
      if (step < 2) for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) if (!(xx && yy)) plot(buf, w, h, at.x + xx, at.y + yy, col(style, 0));
      break;
    }
    case 'slash': {
      // 진행 방향에 수직인 초승달 잔상
      const r = (6 + step * 1.5) * s;
      const thick = Math.max(1, (3 - step) * s);
      const sweep = Math.PI * (0.8 - step * 0.15);
      const base = rad - Math.PI / 2;
      for (let a = -sweep / 2; a <= sweep / 2; a += 0.04) {
        const fade = 1 - Math.abs(a) / (sweep / 2);
        const th = Math.max(0.5, thick * fade);
        for (let d = r - th; d <= r; d += 0.5) plot(buf, w, h, at.x + Math.cos(base + a) * d - Math.cos(rad) * r * 0.6, at.y + Math.sin(base + a) * d - Math.sin(rad) * r * 0.6, col(style, (1 - fade) * 0.7 + t * 0.3));
      }
      break;
    }
    case 'speedLines': {
      // 움직임 반대 방향으로 뒤쪽에 생기는 선
      const back = rad + Math.PI;
      const nx = -Math.sin(rad);
      const ny = Math.cos(rad);
      for (let k = -2; k <= 2; k++) {
        const off = k * 3 * s;
        const start = (4 + step * 2 + Math.abs(k)) * s;
        const length = (6 - step * 1.5) * s;
        for (let d = start; d <= start + length; d += 0.5) plot(buf, w, h, at.x + Math.cos(back) * d + nx * off, at.y + Math.sin(back) * d + ny * off, col(style, t));
      }
      break;
    }
    case 'sparkle': {
      // 십자 반짝임: 커졌다 작아짐
      const size = [1, 3, 2, 1][step] ?? 1;
      const c = col(style, step === 1 ? 0 : t);
      for (let d = -size * s; d <= size * s; d++) {
        plot(buf, w, h, at.x + d, at.y, c);
        plot(buf, w, h, at.x, at.y + d, c);
      }
      if (step === 1) {
        plot(buf, w, h, at.x + 1, at.y + 1, c);
        plot(buf, w, h, at.x - 1, at.y - 1, c);
        plot(buf, w, h, at.x + 1, at.y - 1, c);
        plot(buf, w, h, at.x - 1, at.y + 1, c);
      }
      break;
    }
  }
  return buf;
}
