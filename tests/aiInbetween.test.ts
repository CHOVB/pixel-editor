/**
 * AI 중간 프레임 정리 테스트: Codex 가 캐릭터를 다른 크기로 그려도 시작/끝 프레임 크기·발 위치에 맞추는지
 */
import { describe, expect, it } from 'vitest';
import { fitInbetweens } from '../src/core/aiInbetween';
import { createRig, DEFAULT_BUILD, RIG_PARTS } from '../src/core/autoRig';
import { applyMotion } from '../src/core/motionTemplates';
import { contentBounds, createBuffer, uniqueColors, upscaleInteger } from '../src/core/pixels';
import { cropBuffer } from '../src/core/pixelfix';
import { createProject } from '../src/core/project';
import { compositeFrame } from '../src/core/render';
import { drawHero } from '../src/editor/sampleHero';

const W = 64;
const S = 8; // AI 에게 보내는 배율
const names = Object.fromEntries([...RIG_PARTS, 'group', 'armF', 'armB', 'legF', 'legB'].map((k) => [k, k])) as never;

/** 모험가 걷기 1~5번 프레임: 1번 = 시작, 5번 = 끝, 2~4번 = 정답 중간 프레임 */
function walk() {
  const hero = drawHero(W, W, 8, 18);
  const p = createProject(W, W);
  p.cels[`${p.layers[0].id}|${p.frames[0].id}`] = hero.pixels;
  const rig = createRig(p, p.layers[0].id, 0, hero.points, { ...DEFAULT_BUILD, facing: 1, view: 'side', names })!;
  applyMotion(p, rig.rigId, 'walk', 0);
  const f = p.frames.map((_, i) => compositeFrame(p, i));
  return { a: f[0], b: f[4], mids: f.slice(1, 4) };
}

/** 고해상도 띠 그림에 칸마다 그림 붙이기 */
function paste(img: Uint8ClampedArray, imgW: number, src: Uint8ClampedArray, sw: number, sh: number, ox: number, oy: number) {
  for (let y = 0; y < sh; y++) img.set(src.subarray(y * sw * 4, (y + 1) * sw * 4), ((oy + y) * imgW + ox) * 4);
}

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.every((v, i) => v === b[i]);

describe('AI in-between post-processing', () => {
  it('keeps a correctly sized answer exactly as drawn', () => {
    const { a, b, mids } = walk();
    const strip = createBuffer(W * 3, W);
    mids.forEach((m, i) => paste(strip, W * 3, cropBuffer(m, W, { x: 0, y: 0, w: W, h: W }), W, W, i * W, 0));
    const big = upscaleInteger(strip, W * 3, W, S);
    const palette = Array.from(new Set([...uniqueColors(a, 256), ...uniqueColors(b, 256), ...mids.flatMap((m) => uniqueColors(m, 64))]));
    const out = fitInbetweens(big, W * 3 * S, W * S, a, b, W, W, 3, palette);
    out.forEach((f, i) => expect(same(f, mids[i]), `frame ${i + 1}`).toBe(true));
  });

  it('shrinks a character the AI drew 1.5x too big back to the key-frame size, feet on the ground', () => {
    const { a, b, mids } = walk();
    const big = createBuffer(W * 3 * S, W * S);
    // "AI" 가 캐릭터를 1.5배로, 칸 위쪽에 그림 (실제 Codex 에서 본 실수)
    mids.forEach((m, i) => {
      const c = contentBounds(m, W, W)!;
      const up = upscaleInteger(cropBuffer(m, W, c), c.w, c.h, S * 1.5);
      paste(big, W * 3 * S, up, c.w * S * 1.5, c.h * S * 1.5, i * W * S + 40, 30);
    });
    const palette = Array.from(new Set([...uniqueColors(a, 256), ...uniqueColors(b, 256)]));
    const out = fitInbetweens(big, W * 3 * S, W * S, a, b, W, W, 3, palette);
    const ba = contentBounds(a, W, W)!;
    const bb = contentBounds(b, W, W)!;
    out.forEach((f, i) => {
      const t = (i + 1) / 4;
      const got = contentBounds(f, W, W)!;
      const want = contentBounds(mids[i], W, W)!;
      expect(Math.abs(got.h - (ba.h + (bb.h - ba.h) * t)), `height ${i + 1}`).toBeLessThanOrEqual(1);
      expect(Math.abs(got.y + got.h - (ba.y + ba.h + (bb.y + bb.h - ba.y - ba.h) * t)), `feet ${i + 1}`).toBeLessThanOrEqual(1);
      expect(Math.abs(got.w - want.w), `width ${i + 1}`).toBeLessThanOrEqual(2);
      expect(Math.abs(got.x + got.w / 2 - (want.x + want.w / 2)), `centre ${i + 1}`).toBeLessThanOrEqual(2);
      // 원래 그림의 색으로만
      const colors = new Set(palette);
      for (const c of uniqueColors(f, 256)) expect(colors.has(c), `colour ${c.toString(16)}`).toBe(true);
    });
  });
});
