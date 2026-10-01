/**
 * AI 다듬기 테스트: AI 결과를 원래 도트 크기·색·위치로 되돌리는 과정 + 적용
 */
import { describe, expect, it } from 'vitest';
import { alignToGuide, buildSheet, planLayout, postProcess, sheetSize, shiftBuffer, splitResult, stabilize } from '../src/core/aiPolish';
import { createRig, DEFAULT_BUILD, RIG_PARTS } from '../src/core/autoRig';
import { effectParamsAt } from '../src/core/effectKeys';
import { applyMotion } from '../src/core/motionTemplates';
import { uniqueColors, upscaleInteger } from '../src/core/pixels';
import { createProject, layerIndex } from '../src/core/project';
import { compositeFrame } from '../src/core/render';
import { drawHero } from '../src/editor/sampleHero';
import { replaceProject } from '../src/store/actions';
import { applyPolish, polishTarget, renderGuides, renderReference } from '../src/store/aiPolishActions';

const W = 64;
const names = Object.fromEntries([...RIG_PARTS, 'group', 'armF', 'armB', 'legF', 'legB'].map((k) => [k, k])) as never;

function walkProject() {
  const hero = drawHero(W, W, 8, 18);
  const p = createProject(W, W);
  p.cels[`${p.layers[0].id}|${p.frames[0].id}`] = hero.pixels;
  const rig = createRig(p, p.layers[0].id, 0, hero.points, { ...DEFAULT_BUILD, facing: 1, view: 'side', names })!;
  applyMotion(p, rig.rigId, 'walk', 0);
  return { p, rig, frames: p.frames.map((_, i) => compositeFrame(p, i)) };
}

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.every((v, i) => v === b[i]);

describe('AI polish post-processing', () => {
  it('plans a near-square grid of about 1024px', () => {
    const { frames } = walkProject();
    const l = planLayout(frames, W, W)!;
    expect(l.count).toBe(8);
    expect(l.cols * l.rows).toBeGreaterThanOrEqual(8);
    const s = sheetSize(l);
    expect(Math.max(s.w, s.h) * l.scale).toBeLessThanOrEqual(1024);
    expect(Math.max(s.w, s.h) * l.scale).toBeGreaterThan(400);
  });

  it('recovers the exact frames from a perfect AI answer (identity)', () => {
    const { frames } = walkProject();
    const l = planLayout(frames, W, W)!;
    const s = sheetSize(l);
    const big = upscaleInteger(buildSheet(frames, W, l), s.w, s.h, l.scale);
    const palette = uniqueColors(frames[0], 256).concat(...frames.map((f) => uniqueColors(f, 64)));
    const back = splitResult(big, s.w * l.scale, s.h * l.scale, l, W, W, palette);
    back.forEach((f, i) => expect(same(f, frames[i]), `frame ${i}`).toBe(true));
  });

  it('snaps colors back to the palette and re-aligns a shifted answer', () => {
    const { frames } = walkProject();
    const l = planLayout(frames, W, W)!;
    const s = sheetSize(l);
    // "AI" 가 1픽셀 오른쪽으로 밀려 그리고, 색을 살짝 틀리게 칠함
    const sheet = buildSheet(frames.map((f) => shiftBuffer(f, W, W, 1, 0)), W, l);
    for (let i = 0; i < sheet.length; i += 4) {
      if (sheet[i + 3] === 0) continue;
      sheet[i] = Math.min(255, sheet[i] + 6);
      sheet[i + 2] = Math.max(0, sheet[i + 2] - 5);
    }
    const big = upscaleInteger(sheet, s.w, s.h, l.scale);
    const palette = Array.from(new Set(frames.flatMap((f) => uniqueColors(f, 64))));
    const out = postProcess(big, s.w * l.scale, s.h * l.scale, l, frames, W, W, palette, { stabilize: false });
    out.forEach((f, i) => {
      expect(same(f, frames[i]), `frame ${i}`).toBe(true);
    });
  });

  it('alignment picks the best overlapping shift', () => {
    const { frames } = walkProject();
    const moved = shiftBuffer(frames[2], W, W, -2, 1);
    expect(same(alignToGuide(moved, frames[2], W, W), frames[2])).toBe(true);
  });

  it('stabilize copies still areas from the previous frame', () => {
    const { frames } = walkProject();
    // AI 가 1번 프레임 머리(움직이지 않는 곳)에 엉뚱한 점을 찍음
    const ai = frames.map((f) => new Uint8ClampedArray(f));
    const headY = 18 + 14;
    const k = (headY * W + 31) * 4;
    ai[1][k] = 255;
    ai[1][k + 1] = 0;
    ai[1][k + 2] = 255;
    const fixed = stabilize(ai, frames, W, W);
    expect(fixed[1][k + 1]).toBe(frames[1][k + 1]);
  });
});

describe('applying a polish', () => {
  it('adds an AI layer above the rig and hides the rig only on those frames', () => {
    const { p } = walkProject();
    // 걷기 뒤에 프레임 하나 더 (다듬지 않는 프레임)
    applyMotion(p, polishTargetFor(p).rigId, 'idle', 8);
    replaceProject(p, null);
    const target = polishTarget()!;
    const frames = [2, 3, 4];
    const guides = renderGuides(target, frames);
    expect(renderReference(target).some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    const marked = guides.map((g) => {
      const c = new Uint8ClampedArray(g);
      c[(5 * W + 5) * 4 + 3] = 255; // AI 결과 표시용 점
      return c;
    });
    expect(applyPolish(target, frames, marked, 'AI')).toBe(true);
    const ai = p.layers.find((l) => l.name === 'AI')!;
    expect(layerIndex(p, ai.id)).toBeGreaterThan(layerIndex(p, target.groupId));
    const group = p.layers.find((l) => l.id === target.groupId)!;
    const hide = group.effects.find((e) => e.type === 'opacity')!;
    const amount = (i: number) => effectParamsAt(p, hide, i).amount;
    expect([0, 1, 2, 3, 4, 5, 9].map(amount)).toEqual([100, 100, 0, 0, 0, 100, 100]);
    // 다듬은 프레임은 AI 레이어 그림, 나머지는 리그 그림
    expect(compositeFrame(p, 3)[(5 * W + 5) * 4 + 3]).toBe(255);
    expect(compositeFrame(p, 1)[(5 * W + 5) * 4 + 3]).toBe(0);
    // 다시 다듬을 때 원래 프레임은 숨김을 무시하고 그려짐
    const again = renderGuides(target, [3])[0];
    expect(again.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });
});

function polishTargetFor(p: ReturnType<typeof walkProject>['p']) {
  const root = p.bones.find((b) => b.rig?.part === 'root')!;
  return { rigId: root.rig!.rigId, groupId: root.rig!.groupId! };
}
