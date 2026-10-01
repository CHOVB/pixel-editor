/**
 * 예제 캐릭터 "모험가" 그리기 (자동 애니메이션 연습용)
 * ------------------------------------------------------------
 * 오른쪽을 보고 서 있는 옆모습 캐릭터를 도형(타원, 굵은 선)으로 그립니다.
 * 부위마다 따로 그리고 테두리를 둘러서 겹쳐 놓기 때문에, 도트 작가가 그린 것처럼
 * 팔·다리·몸통 사이에 외곽선이 생깁니다. (자동 리깅이 부위를 구분하는 데에도 도움이 됨)
 *
 * 자동 리깅에 쓸 "점 위치"(머리, 목, 골반, 손, 발)도 함께 알려줍니다.
 */
import { hexToColor } from '../core/color';
import { outlineBuffer } from '../core/effects';
import { blendOver, createBuffer, setPixel } from '../core/pixels';
import type { Color, Point } from '../core/types';

const C = (hex: string): Color => hexToColor(hex) as Color;

export const HERO_COLORS = {
  outline: C('#181425'),
  skin: C('#e8b796'),
  skinShade: C('#c28569'),
  hair: C('#733e39'),
  hairShade: C('#3e2731'),
  hairHi: C('#b86f50'),
  tunic: C('#0099db'),
  tunicShade: C('#124e89'),
  tunicHi: C('#2ce8f5'),
  belt: C('#3e2731'),
  buckle: C('#feae34'),
  pants: C('#5a6988'),
  pantsShade: C('#3a4466'),
  boots: C('#733e39'),
  bootsShade: C('#3e2731'),
  eye: C('#181425'),
};

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number; side: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  // side < 0: 선의 왼쪽(진행 방향 기준)
  const side = (dx * (py - ay) - dy * (px - ax)) / Math.sqrt(len2);
  return { d: Math.hypot(px - cx, py - cy), t, side };
}

type Painter = (x: number, y: number, t: number, side: number) => Color | null;

/** 굵은 선(캡슐) 칠하기 */
function capsule(buf: Uint8ClampedArray, w: number, h: number, a: Point, b: Point, r: number, paint: Painter): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = distToSegment(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
      if (s.d > r) continue;
      const c = paint(x, y, s.t, s.side / r);
      if (c !== null) setPixel(buf, w, x, y, c);
    }
  }
}

function ellipse(buf: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, rx: number, ry: number, paint: (x: number, y: number, nx: number, ny: number) => Color | null): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const c = paint(x, y, nx, ny);
      if (c !== null) setPixel(buf, w, x, y, c);
    }
  }
}

export interface HeroSprite {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** 자동 리깅 점 (머리 중심, 목, 골반, 앞/뒤 손, 앞/뒤 발) */
  points: { head: Point; neck: Point; pelvis: Point; handF: Point; handB: Point; footF: Point; footB: Point };
}

/** 48×48 캔버스에 모험가를 그립니다. (ox, oy 만큼 옮겨서) */
export function drawHero(width = 48, height = 48, ox = 0, oy = 0): HeroSprite {
  const w = width;
  const h = height;
  const P = (x: number, y: number): Point => ({ x: x + ox, y: y + oy });
  const K = HERO_COLORS;
  const out = createBuffer(w, h);
  const part = (draw: (buf: Uint8ClampedArray) => void) => {
    const buf = createBuffer(w, h);
    draw(buf);
    blendOver(out, outlineBuffer(buf, w, h, K.outline, 1, 'outside', false));
  };

  const shoulderF = P(24.5, 22);
  const shoulderB = P(21.5, 22);
  const handF = P(26.5, 31.5);
  const handB = P(18.5, 30.5);
  const hipF = P(24, 32);
  const hipB = P(21.5, 32);
  const footF = P(25.5, 42);
  const footB = P(20.5, 42);

  // 팔 (소매 + 손)
  const arm = (s: Point, hand: Point, back: boolean) =>
    part((buf) => {
      capsule(buf, w, h, s, { x: hand.x, y: hand.y - 1.5 }, 1.6, (_x, _y, t, side) => {
        if (t > 0.62) return back ? K.skinShade : side < -0.2 ? K.skinShade : K.skin;
        return back ? K.tunicShade : side < -0.25 ? K.tunicShade : K.tunic;
      });
      ellipse(buf, w, h, hand.x, hand.y - 0.5, 1.5, 1.6, () => (back ? K.skinShade : K.skin));
    });
  // 다리 (바지 + 장화 + 발끝)
  const leg = (hip: Point, foot: Point, back: boolean) =>
    part((buf) => {
      capsule(buf, w, h, hip, foot, 1.9, (_x, y) => {
        if (y >= foot.y - 3.5) return back ? K.bootsShade : K.boots;
        return back ? K.pantsShade : K.pants;
      });
      capsule(buf, w, h, { x: foot.x, y: foot.y }, { x: foot.x + 2.2, y: foot.y + 0.3 }, 1.4, () => (back ? K.bootsShade : K.boots));
    });

  arm(shoulderB, handB, true);
  leg(hipB, footB, true);
  leg(hipF, footF, false);

  // 몸통 (윗옷 + 허리띠)
  part((buf) => {
    ellipse(buf, w, h, P(23, 26.5).x, P(23, 26.5).y, 4.6, 6.6, (_x, _y, nx, ny) => {
      if (ny > 0.55) return ny > 0.72 ? K.tunic : K.belt;
      if (nx < -0.45) return K.tunicShade;
      if (nx > 0.35 && ny < -0.2) return K.tunicHi;
      return K.tunic;
    });
    setPixel(buf, w, Math.floor(P(25, 0).x), Math.floor(P(0, 30).y), K.buckle);
  });

  // 머리 (얼굴 + 머리카락 + 눈)
  part((buf) => {
    const c = P(23.5, 14);
    ellipse(buf, w, h, c.x, c.y, 5.6, 5.4, (x, y, nx, ny) => {
      // 뒤통수·윗머리는 머리카락
      if (ny < -0.35 || nx < -0.1 || (nx < 0.25 && ny < 0.05)) {
        if (ny < -0.6 && nx > -0.2) return K.hairHi;
        return nx < -0.6 || ny > 0.5 ? K.hairShade : K.hair;
      }
      void x;
      void y;
      return nx > 0.75 || ny > 0.7 ? K.skinShade : K.skin;
    });
    // 앞머리 한 가닥
    setPixel(buf, w, Math.floor(c.x + 3), Math.floor(c.y - 3), K.hair);
    // 눈 (세로 2픽셀)
    setPixel(buf, w, Math.floor(c.x + 3), Math.floor(c.y), K.eye);
    setPixel(buf, w, Math.floor(c.x + 3), Math.floor(c.y + 1), K.eye);
  });

  arm(shoulderF, handF, false);

  return {
    width: w,
    height: h,
    pixels: out,
    points: {
      head: P(23.5, 14),
      neck: P(23, 20),
      pelvis: P(23, 32),
      handF: { x: handF.x, y: handF.y },
      handB: { x: handB.x, y: handB.y },
      footF: { x: footF.x, y: footF.y },
      footB: { x: footB.x, y: footB.y },
    },
  };
}
