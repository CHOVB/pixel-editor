/**
 * 자동 중간 프레임 생성 (인비트윈, In-between)
 * ------------------------------------------------------------
 * 예) 1프레임 "서 있기" → 2프레임 "다리 벌림" 사이에 6장을 자동으로 만들어
 *     총 8프레임 걷기 동작을 만듭니다.
 *
 * 방법 1. morph (픽셀 이동 추적) – 추천
 *   ① 두 그림에서 "같은 색 픽셀"끼리 가장 가까운 짝을 찾습니다.
 *   ② 짝이 된 픽셀을 시간(t)에 맞춰 출발점 → 도착점으로 이동시킵니다.
 *   ③ 이동 방향을 주변 픽셀과 비슷하게 다듬어(스무딩) 덩어리째 자연스럽게 움직이게 합니다.
 *   ④ 움직이며 생긴 작은 구멍은 주변 색으로 메웁니다.
 *   → 다리, 팔처럼 "위치가 바뀌는" 동작에 잘 맞습니다.
 *
 * 방법 2. dither (디더 전환)
 *   체크무늬 패턴으로 A 에서 B 로 서서히 바뀝니다. 빛, 연기, 사라지기 같은 효과에 맞습니다.
 *
 * 결과가 완벽하지 않을 수 있으므로, 에디터에서는 "미리보기 → 적용" 후 손으로 다듬는 흐름을 권장합니다.
 * (AI 로 생성하고 싶다면 Codex 연동 기능을 사용하세요)
 */
import { ease } from './easing';
import { createBuffer } from './pixels';
import type { Ease } from './types';

export type InbetweenMethod = 'morph' | 'dither';

export interface InbetweenOptions {
  /** 만들 중간 프레임 수 */
  count: number;
  method: InbetweenMethod;
  ease: Ease;
  /** 이동하며 생긴 구멍 메우기 */
  fillHoles: boolean;
  /** 이동 방향 다듬기 강도 (0 = 끔, 1~3) */
  smoothing: number;
}

export const DEFAULT_INBETWEEN: InbetweenOptions = {
  count: 6,
  method: 'morph',
  ease: { kind: 'easeInOut' },
  fillHoles: true,
  smoothing: 2,
};

interface Px {
  x: number;
  y: number;
  c: number;
}

interface Match {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ca: number;
  cb: number;
  /** 'move' = 두 그림에 다 있음, 'out' = 사라짐(A 에만), 'in' = 나타남(B 에만) */
  kind: 'move' | 'out' | 'in';
}

function readPixels(buf: Uint8ClampedArray, w: number, h: number): Px[] {
  const out: Px[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] === 0) continue;
      out.push({ x, y, c: ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0 });
    }
  }
  return out;
}

function colorDist(a: number, b: number): number {
  const dr = ((a >>> 24) & 255) - ((b >>> 24) & 255);
  const dg = ((a >>> 16) & 255) - ((b >>> 16) & 255);
  const db = ((a >>> 8) & 255) - ((b >>> 8) & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 공간 격자: 가까운 점 빨리 찾기 */
class Grid {
  private cells = new Map<number, number[]>();
  constructor(
    private readonly pts: Px[],
    private readonly size: number,
  ) {
    pts.forEach((p, i) => {
      const k = this.key(Math.floor(p.x / size), Math.floor(p.y / size));
      const arr = this.cells.get(k);
      if (arr) arr.push(i);
      else this.cells.set(k, [i]);
    });
  }
  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }
  /** (x,y) 에서 가장 가까운 점. used 에 있는 점은 제외 (allowUsed=false 일 때) */
  nearest(x: number, y: number, used: Uint8Array | null, maxRing = 64): number {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        for (let gx = cx - r; gx <= cx + r; gx++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue;
          const list = this.cells.get(this.key(gx, gy));
          if (!list) continue;
          for (const i of list) {
            if (used && used[i]) continue;
            const p = this.pts[i];
            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      // 이번 고리에서 찾았고, 다음 고리가 더 가까울 수 없으면 종료
      if (best >= 0 && Math.sqrt(bestD) <= r * this.size) break;
    }
    return best;
  }
}

/** 같은 색끼리 가까운 짝 찾기 (탐욕적 매칭) */
function matchPixels(A: Px[], B: Px[]): Match[] {
  const matches: Match[] = [];
  const byColorA = new Map<number, Px[]>();
  const byColorB = new Map<number, Px[]>();
  for (const p of A) (byColorA.get(p.c) ?? byColorA.set(p.c, []).get(p.c))!.push(p);
  for (const p of B) (byColorB.get(p.c) ?? byColorB.set(p.c, []).get(p.c))!.push(p);
  const leftoverA: Px[] = [];
  const leftoverB: Px[] = [];

  byColorA.forEach((as, color) => {
    const bs = byColorB.get(color);
    if (!bs) {
      leftoverA.push(...as);
      return;
    }
    const grid = new Grid(bs, 4);
    const usedB = new Uint8Array(bs.length);
    // 1) 같은 자리에 그대로 있는 픽셀 먼저
    const posB = new Map<number, number>();
    bs.forEach((p, i) => posB.set(p.y * 100000 + p.x, i));
    const rest: Px[] = [];
    for (const p of as) {
      const j = posB.get(p.y * 100000 + p.x);
      if (j !== undefined && !usedB[j]) {
        usedB[j] = 1;
        matches.push({ ax: p.x, ay: p.y, bx: p.x, by: p.y, ca: color, cb: color, kind: 'move' });
      } else rest.push(p);
    }
    // 2) 나머지는 "덩어리가 통째로 어디로 갔는지" 먼저 예측합니다.
    //    (남은 픽셀들의 무게중심이 움직인 만큼) → 예측한 자리에서 가장 가까운 픽셀과 짝짓기.
    //    이렇게 하면 한 덩어리의 픽셀들이 같은 거리만큼 움직여서 중간에 겹치거나 빠지지 않습니다.
    const restB = bs.filter((_, i) => !usedB[i]);
    let shiftX = 0;
    let shiftY = 0;
    if (rest.length > 0 && restB.length > 0) {
      const avg = (list: Px[], key: 'x' | 'y') => list.reduce((s, q) => s + q[key], 0) / list.length;
      shiftX = Math.round(avg(restB, 'x') - avg(rest, 'x'));
      shiftY = Math.round(avg(restB, 'y') - avg(rest, 'y'));
    }
    const order = rest
      .map((p) => {
        const j = grid.nearest(p.x + shiftX, p.y + shiftY, usedB);
        const q = j >= 0 ? bs[j] : null;
        return { p, d: q ? (q.x - p.x - shiftX) ** 2 + (q.y - p.y - shiftY) ** 2 : Infinity };
      })
      .sort((a, b) => a.d - b.d);
    for (const { p } of order) {
      const j = grid.nearest(p.x + shiftX, p.y + shiftY, usedB);
      if (j < 0) {
        leftoverA.push(p);
        continue;
      }
      usedB[j] = 1;
      matches.push({ ax: p.x, ay: p.y, bx: bs[j].x, by: bs[j].y, ca: color, cb: color, kind: 'move' });
    }
    bs.forEach((p, i) => {
      if (!usedB[i]) leftoverB.push(p);
    });
  });
  byColorB.forEach((bs, color) => {
    if (!byColorA.has(color)) leftoverB.push(...bs);
  });

  // 3) 남은 픽셀: 같은 색(또는 비슷한 색)의 가장 가까운 픽셀과 연결 (합쳐지거나 갈라지는 움직임)
  const gridAllB = new Grid(B, 4);
  const gridAllA = new Grid(A, 4);
  for (const p of leftoverA) {
    const j = gridAllB.nearest(p.x, p.y, null, 6);
    const q = j >= 0 ? B[j] : null;
    if (q && colorDist(q.c, p.c) < 90) matches.push({ ax: p.x, ay: p.y, bx: q.x, by: q.y, ca: p.c, cb: q.c, kind: 'move' });
    else matches.push({ ax: p.x, ay: p.y, bx: p.x, by: p.y, ca: p.c, cb: p.c, kind: 'out' });
  }
  for (const q of leftoverB) {
    const j = gridAllA.nearest(q.x, q.y, null, 6);
    const p = j >= 0 ? A[j] : null;
    if (p && colorDist(q.c, p.c) < 90) matches.push({ ax: p.x, ay: p.y, bx: q.x, by: q.y, ca: p.c, cb: q.c, kind: 'move' });
    else matches.push({ ax: q.x, ay: q.y, bx: q.x, by: q.y, ca: q.c, cb: q.c, kind: 'in' });
  }
  return matches;
}

/** 주변 픽셀들과 이동 방향을 맞춥니다. (중앙값 필터) */
function smoothDisplacements(matches: Match[], passes: number): void {
  if (passes <= 0) return;
  for (let pass = 0; pass < passes; pass++) {
    const byPos = new Map<number, Match[]>();
    for (const m of matches) {
      if (m.kind !== 'move') continue;
      const k = m.ay * 100000 + m.ax;
      (byPos.get(k) ?? byPos.set(k, []).get(k))!.push(m);
    }
    const updates: [Match, number, number][] = [];
    for (const m of matches) {
      if (m.kind !== 'move') continue;
      const dxs: number[] = [];
      const dys: number[] = [];
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = byPos.get((m.ay + oy) * 100000 + (m.ax + ox));
          if (!list) continue;
          for (const n of list) {
            dxs.push(n.bx - n.ax);
            dys.push(n.by - n.ay);
          }
        }
      }
      if (dxs.length < 4) continue;
      dxs.sort((a, b) => a - b);
      dys.sort((a, b) => a - b);
      const mid = Math.floor(dxs.length / 2);
      updates.push([m, dxs[mid], dys[mid]]);
    }
    // 원래 도착점에서 너무 멀어지지 않도록, 중앙값과 원래 값을 섞습니다.
    for (const [m, dx, dy] of updates) {
      const odx = m.bx - m.ax;
      const ody = m.by - m.ay;
      m.bx = m.ax + Math.round((odx + dx) / 2);
      m.by = m.ay + Math.round((ody + dy) / 2);
    }
  }
}

/** 투명 구멍 중 주변이 대부분 칠해진 곳을 가장 흔한 주변 색으로 메웁니다. */
export function fillSmallHoles(buf: Uint8ClampedArray, w: number, h: number, passes = 2): void {
  for (let pass = 0; pass < passes; pass++) {
    const fills: [number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (buf[i + 3] !== 0) continue;
        const counts = new Map<number, number>();
        let solid = 0;
        let ortho = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = (ny * w + nx) * 4;
            if (buf[j + 3] === 0) continue;
            solid++;
            if (!ox || !oy) ortho++;
            const c = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
            counts.set(c, (counts.get(c) ?? 0) + 1);
          }
        }
        if (solid >= 6 || ortho >= 4 || (ortho >= 3 && solid >= 5)) {
          let best = 0;
          let bestN = 0;
          counts.forEach((n, c) => {
            if (n > bestN) {
              bestN = n;
              best = c;
            }
          });
          fills.push([i, best]);
        }
      }
    }
    if (fills.length === 0) break;
    for (const [i, c] of fills) {
      buf[i] = (c >>> 24) & 255;
      buf[i + 1] = (c >>> 16) & 255;
      buf[i + 2] = (c >>> 8) & 255;
      buf[i + 3] = c & 255;
    }
  }
}

function put(buf: Uint8ClampedArray, w: number, h: number, x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = (c >>> 24) & 255;
  buf[i + 1] = (c >>> 16) & 255;
  buf[i + 2] = (c >>> 8) & 255;
  buf[i + 3] = c & 255;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A 와 B 사이의 중간 그림들을 만듭니다. (A, B 자체는 포함하지 않음) */
export function generateInbetweens(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  w: number,
  h: number,
  options: Partial<InbetweenOptions> = {},
): Uint8ClampedArray[] {
  const opts = { ...DEFAULT_INBETWEEN, ...options };
  const count = Math.max(1, Math.min(60, Math.round(opts.count)));
  const ts = Array.from({ length: count }, (_, i) => ease(opts.ease, (i + 1) / (count + 1)));

  if (opts.method === 'dither') {
    return ts.map((t) => {
      const out = createBuffer(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const threshold = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
          const src = t >= threshold ? b : a;
          const i = (y * w + x) * 4;
          out[i] = src[i];
          out[i + 1] = src[i + 1];
          out[i + 2] = src[i + 2];
          out[i + 3] = src[i + 3];
        }
      }
      return out;
    });
  }

  const matches = matchPixels(readPixels(a, w, h), readPixels(b, w, h));
  smoothDisplacements(matches, Math.round(opts.smoothing));
  // 움직임이 작은 픽셀을 먼저 그리고, 많이 움직이는 픽셀을 나중에 그려서 위에 보이게 합니다.
  matches.sort((m1, m2) => Math.abs(m1.bx - m1.ax) + Math.abs(m1.by - m1.ay) - (Math.abs(m2.bx - m2.ax) + Math.abs(m2.by - m2.ay)));
  return ts.map((t) => {
    const out = createBuffer(w, h);
    for (const m of matches) {
      if (m.kind === 'out' && t >= 0.5) continue;
      if (m.kind === 'in' && t < 0.5) continue;
      const x = Math.round(m.ax + (m.bx - m.ax) * t);
      const y = Math.round(m.ay + (m.by - m.ay) * t);
      put(out, w, h, x, y, t < 0.5 ? m.ca : m.cb);
    }
    if (opts.fillHoles) fillSmallHoles(out, w, h, 2);
    return out;
  });
}
