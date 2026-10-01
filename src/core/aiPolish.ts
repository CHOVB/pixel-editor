/**
 * AI 다듬기 – 자동 애니메이션 프레임을 "손으로 그린 도트"처럼 (계산 부분)
 * ------------------------------------------------------------
 * 뼈대로 만든 애니메이션은 움직임은 정확하지만, 부위를 돌린 자국(계단·각진 관절)이 남을 수 있습니다.
 * AI(Codex) 에게 "자세는 그대로 두고 손으로 다시 그려 줘" 라고 맡긴 뒤, 결과를 이 파일에서 다듬습니다.
 *
 *  1) planLayout     : 프레임들을 격자 한 장으로 (AI 는 여러 장보다 한 장을 더 일관되게 그림)
 *  2) buildSheet     : 각 칸에 프레임을 배치 (그림이 있는 영역만 잘라서)
 *  3) splitResult    : AI 결과 → 원래 도트 크기로 줄이고, 원래 그림의 색으로만 칠하고, 칸별로 자름
 *  4) alignToGuide   : AI 가 칸 안에서 조금 밀려 그렸으면 원래 프레임 위치에 맞춤
 *  5) stabilize      : 움직이지 않아야 할 곳(예: 걷는 동안의 머리)은 앞 프레임과 똑같이 → 깜빡임 방지
 */
import { downscale, mapToPalette } from './effects';
import { contentBounds, createBuffer } from './pixels';
import type { Color, Rect } from './types';

export interface PolishLayout {
  /** 모든 프레임의 그림을 감싸는 영역 (+여백), 캔버스 좌표 */
  crop: Rect;
  cols: number;
  rows: number;
  /** AI 에게 보낼 때 확대 배율 (한 칸 = 이만큼의 블록) */
  scale: number;
  count: number;
}

/** 여러 프레임을 감싸는 영역 */
export function unionBounds(frames: Uint8ClampedArray[], w: number, h: number): Rect | null {
  let r: Rect | null = null;
  for (const f of frames) {
    const b = contentBounds(f, w, h);
    if (!b) continue;
    if (!r) r = { ...b };
    else {
      const x1 = Math.max(r.x + r.w, b.x + b.w);
      const y1 = Math.max(r.y + r.h, b.y + b.h);
      r.x = Math.min(r.x, b.x);
      r.y = Math.min(r.y, b.y);
      r.w = x1 - r.x;
      r.h = y1 - r.y;
    }
  }
  return r;
}

/** 격자 모양 정하기: 결과 이미지가 정사각형에 가깝게, 긴 변이 약 1024px 이 되게 */
export function planLayout(frames: Uint8ClampedArray[], w: number, h: number, margin = 2, target = 1024): PolishLayout | null {
  const b = unionBounds(frames, w, h);
  if (!b || frames.length === 0) return null;
  const x = Math.max(0, b.x - margin);
  const y = Math.max(0, b.y - margin);
  const crop = { x, y, w: Math.min(w, b.x + b.w + margin) - x, h: Math.min(h, b.y + b.h + margin) - y };
  const n = frames.length;
  let best = { cols: n, rows: 1, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const ratio = (cols * crop.w) / (rows * crop.h);
    const score = Math.abs(Math.log(ratio)) + (cols * rows - n) * 0.05;
    if (score < best.score) best = { cols, rows, score };
  }
  const longest = Math.max(best.cols * crop.w, best.rows * crop.h);
  const scale = Math.max(2, Math.min(16, Math.floor(target / longest)));
  return { crop, cols: best.cols, rows: best.rows, scale, count: n };
}

/** 격자 이미지 크기 (1배) */
export function sheetSize(l: PolishLayout): { w: number; h: number } {
  return { w: l.cols * l.crop.w, h: l.rows * l.crop.h };
}

/** 프레임들을 격자 한 장으로 (1배, 빈 칸은 투명) */
export function buildSheet(frames: Uint8ClampedArray[], w: number, l: PolishLayout): Uint8ClampedArray {
  const { w: sw, h: sh } = sheetSize(l);
  const out = createBuffer(sw, sh);
  frames.forEach((f, i) => {
    const cx = (i % l.cols) * l.crop.w;
    const cy = Math.floor(i / l.cols) * l.crop.h;
    for (let y = 0; y < l.crop.h; y++) {
      const s = ((l.crop.y + y) * w + l.crop.x) * 4;
      out.set(f.subarray(s, s + l.crop.w * 4), ((cy + y) * sw + cx) * 4);
    }
  });
  return out;
}

/**
 * AI 결과 이미지(아무 크기) → 원래 크기의 프레임들
 *  - 격자 크기로 줄이기(칸마다 가장 많은 색) → 반투명 없애기 → 원래 그림의 색으로만
 *  - 칸을 잘라서 캔버스(w×h)의 원래 위치에 다시 놓음
 */
export function splitResult(img: Uint8ClampedArray, imgW: number, imgH: number, l: PolishLayout, w: number, h: number, palette: Color[]): Uint8ClampedArray[] {
  const { w: sw, h: sh } = sheetSize(l);
  let small = downscale(img, imgW, imgH, sw, sh, 'mode');
  for (let i = 3; i < small.length; i += 4) small[i] = small[i] >= 128 ? 255 : 0;
  if (palette.length > 0) small = mapToPalette(small, sw, sh, palette, 'none', 0, 'perceptual');
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < l.count; i++) {
    const cx = (i % l.cols) * l.crop.w;
    const cy = Math.floor(i / l.cols) * l.crop.h;
    const out = createBuffer(w, h);
    for (let y = 0; y < l.crop.h; y++) {
      const s = ((cy + y) * sw + cx) * 4;
      out.set(small.subarray(s, s + l.crop.w * 4), ((l.crop.y + y) * w + l.crop.x) * 4);
    }
    frames.push(out);
  }
  return frames;
}

/** 버퍼를 (dx, dy) 만큼 옮김 (밖으로 나간 곳은 잘림) */
export function shiftBuffer(buf: Uint8ClampedArray, w: number, h: number, dx: number, dy: number): Uint8ClampedArray {
  if (dx === 0 && dy === 0) return buf;
  const out = createBuffer(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      const s = (sy * w + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = buf[s];
      out[d + 1] = buf[s + 1];
      out[d + 2] = buf[s + 2];
      out[d + 3] = buf[s + 3];
    }
  }
  return out;
}

/** 두 그림의 모양(불투명한 곳)이 얼마나 겹치는지 (b 를 dx,dy 만큼 옮겼을 때) */
function overlap(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, dx: number, dy: number): number {
  let inter = 0;
  let union = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = a[(y * w + x) * 4 + 3] > 0;
      const sx = x - dx;
      const sy = y - dy;
      const pb = sx >= 0 && sy >= 0 && sx < w && sy < h && b[(sy * w + sx) * 4 + 3] > 0;
      if (pa && pb) inter++;
      if (pa || pb) union++;
    }
  }
  return union ? inter / union : 0;
}

/** AI 그림이 원래 프레임보다 조금 밀려 있으면 가장 잘 겹치는 위치로 옮김 (최대 maxShift 픽셀) */
export function alignToGuide(ai: Uint8ClampedArray, guide: Uint8ClampedArray, w: number, h: number, maxShift = 3): Uint8ClampedArray {
  let best = { dx: 0, dy: 0, score: overlap(guide, ai, w, h, 0, 0) };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      if (dx === 0 && dy === 0) continue;
      const score = overlap(guide, ai, w, h, dx, dy);
      // 같은 점수면 덜 움직이는 쪽
      if (score > best.score + 1e-9) best = { dx, dy, score };
    }
  }
  return shiftBuffer(ai, w, h, best.dx, best.dy);
}

/** 두 원래 프레임 사이에 몸 전체가 움직인 양 (걷기의 위아래 흔들림 등) */
function bodyShift(prev: Uint8ClampedArray, cur: Uint8ClampedArray, w: number, h: number, maxShift = 2): { dx: number; dy: number } {
  let best = { dx: 0, dy: 0, score: overlap(cur, prev, w, h, 0, 0) };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const score = overlap(cur, prev, w, h, dx, dy);
      if (score > best.score + 1e-9) best = { dx, dy, score };
    }
  }
  return { dx: best.dx, dy: best.dy };
}

/**
 * 깜빡임 줄이기: 원래(뼈대) 프레임에서 앞 프레임과 똑같은 곳은 AI 결과도 앞 프레임과 똑같게.
 * (몸 전체가 1픽셀 오르내리는 것도 고려) → 움직이지 않는 머리·몸통이 프레임마다 달라 보이지 않음
 */
export function stabilize(ai: Uint8ClampedArray[], guides: Uint8ClampedArray[], w: number, h: number): Uint8ClampedArray[] {
  const out = ai.map((f) => new Uint8ClampedArray(f));
  for (let i = 1; i < out.length; i++) {
    const { dx, dy } = bodyShift(guides[i - 1], guides[i], w, h);
    const g0 = guides[i - 1];
    const g1 = guides[i];
    const prev = out[i - 1];
    const cur = out[i];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        const sy = y - dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const d = (y * w + x) * 4;
        const s = (sy * w + sx) * 4;
        // 원래 프레임에서 이 픽셀이 (몸 이동만큼 옮긴) 앞 프레임과 같으면 = 움직이지 않는 곳
        if (g1[d] !== g0[s] || g1[d + 1] !== g0[s + 1] || g1[d + 2] !== g0[s + 2] || g1[d + 3] !== g0[s + 3]) continue;
        // 이웃도 모두 같을 때만 (경계 근처는 AI 가 고친 모양을 살림)
        let still = true;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + ox;
          const ny = y + oy;
          const mx = sx + ox;
          const my = sy + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || mx < 0 || my < 0 || mx >= w || my >= h) continue;
          const a = (ny * w + nx) * 4;
          const b = (my * w + mx) * 4;
          if (g1[a + 3] !== g0[b + 3] || g1[a] !== g0[b]) {
            still = false;
            break;
          }
        }
        if (!still) continue;
        cur[d] = prev[s];
        cur[d + 1] = prev[s + 1];
        cur[d + 2] = prev[s + 2];
        cur[d + 3] = prev[s + 3];
      }
    }
  }
  return out;
}

export interface PolishPostOptions {
  /** 깜빡임 줄이기 (기본 켬) */
  stabilize: boolean;
}

/** AI 결과 정리 전체: 칸 나누기 → 위치 맞추기 → 깜빡임 줄이기 */
export function postProcess(
  img: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  layout: PolishLayout,
  guides: Uint8ClampedArray[],
  w: number,
  h: number,
  palette: Color[],
  opts: PolishPostOptions = { stabilize: true },
): Uint8ClampedArray[] {
  const cells = splitResult(img, imgW, imgH, layout, w, h, palette);
  const aligned = cells.map((c, i) => alignToGuide(c, guides[i], w, h));
  return opts.stabilize ? stabilize(aligned, guides, w, h) : aligned;
}
