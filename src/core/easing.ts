/**
 * 이징(Easing): 움직임의 "느낌"
 * ------------------------------------------------------------
 * t(0~1, 시간 진행률) 를 받아서 실제 움직임 진행률(0~1 근처)을 돌려줍니다.
 *  - linear: 일정한 속도
 *  - easeIn: 천천히 출발해서 빨라짐
 *  - easeOut: 빠르게 출발해서 천천히 멈춤 (가장 자연스러움)
 *  - easeInOut: 천천히 출발 → 빠르게 → 천천히 멈춤
 *  - back: 살짝 넘어갔다가 돌아옴
 *  - bounce: 공처럼 통통 튐
 *  - elastic: 고무줄처럼 출렁임
 *  - step: 중간 없이 뚝 바뀜 (프레임 애니메이션 느낌)
 *  - bezier: 곡선을 직접 조절 (CSS cubic-bezier 와 같은 방식)
 */
import type { Ease, EaseKind } from './types';

export const EASE_KINDS: EaseKind[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'back', 'bounce', 'elastic', 'step', 'bezier'];

export const LINEAR: Ease = { kind: 'linear' };

/** 프리셋을 베지어 곡선으로 근사 (곡선 편집기에서 시작점으로 사용) */
export const PRESET_BEZIER: Partial<Record<EaseKind, [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.55, 0.055, 0.675, 0.19],
  easeOut: [0.215, 0.61, 0.355, 1],
  easeInOut: [0.645, 0.045, 0.355, 1],
  back: [0.175, 0.885, 0.32, 1.275],
};

/** 3차 베지어 곡선 값 (p0=0, p3=1) */
function bezierAt(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierSlope(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** x 값이 주어졌을 때 베지어 곡선의 y 값 (뉴턴법 + 이분법) */
export function cubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bezierAt(t, x1, x2) - x;
    if (Math.abs(err) < 1e-6) return bezierAt(t, y1, y2);
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    t -= err / slope;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const v = bezierAt(t, x1, x2);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bezierAt(t, y1, y2);
}

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

export function ease(e: Ease | undefined, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  switch (e?.kind ?? 'linear') {
    case 'linear':
      return x;
    case 'step':
      return x < 1 ? 0 : 1;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - (1 - x) ** 3;
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case 'back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
    }
    case 'bounce':
      return bounceOut(x);
    case 'elastic': {
      if (x === 0 || x === 1) return x;
      const c4 = (2 * Math.PI) / 3;
      return 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    }
    case 'bezier': {
      const [x1, y1, x2, y2] = e?.bezier ?? [0, 0, 1, 1];
      return cubicBezier(x, Math.max(0, Math.min(1, x1)), y1, Math.max(0, Math.min(1, x2)), y2);
    }
    default:
      return x;
  }
}
