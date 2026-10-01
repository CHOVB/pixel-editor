/**
 * 효과 값 키프레임 테스트
 */
import { describe, expect, it } from 'vitest';
import { packColor } from '../src/core/color';
import {
  clearEffectKeys,
  effectParamsAt,
  hasEffectKeyAt,
  neighborEffectKeyIndex,
  removeEffectKey,
  sanitizeEffectKeys,
  setEffectKey,
} from '../src/core/effectKeys';
import { defaultParams, effectsKey } from '../src/core/effects';
import { deserializeProject, serializeProject } from '../src/core/fileFormat';
import { changeFrames } from '../src/core/frameTools';
import { getPixel, setPixel } from '../src/core/pixels';
import { addFrame, createProject, ensureCel, layerHolds, removeFrame, sourceFrameId } from '../src/core/project';
import { compositeFrame } from '../src/core/render';
import type { Effect, Project } from '../src/core/types';

const red = packColor(255, 0, 0);

function setup(frames = 5): { p: Project; fx: Effect } {
  const p = createProject(4, 4);
  for (let i = 1; i < frames; i++) addFrame(p, i);
  const layer = p.layers[0];
  setPixel(ensureCel(p, layer.id, p.frames[0].id), 4, 1, 1, red);
  const fx: Effect = { id: 'fx1', type: 'colorOverlay', enabled: true, params: { ...defaultParams('colorOverlay'), color: '#ffffffff', amount: 100 } };
  layer.effects.push(fx);
  return { p, fx };
}

describe('effect value keyframes', () => {
  it('interpolates numeric values between keys and holds outside', () => {
    const { p, fx } = setup();
    setEffectKey(fx, p.frames[1].id, { amount: 100 });
    setEffectKey(fx, p.frames[3].id, { amount: 0 });
    const at = (i: number) => effectParamsAt(p, fx, i).amount;
    expect([0, 1, 2, 3, 4].map(at)).toEqual([100, 100, 50, 0, 0]);
    // 숫자가 아닌 값은 그대로
    expect(effectParamsAt(p, fx, 2).color).toBe('#ffffffff');
  });

  it('applies ease and snaps to the slider step', () => {
    const { p, fx } = setup();
    setEffectKey(fx, p.frames[0].id, { amount: 0 }, { kind: 'step' });
    setEffectKey(fx, p.frames[4].id, { amount: 100 });
    expect(effectParamsAt(p, fx, 3).amount).toBe(0);
    fx.keys![0].ease = { kind: 'linear' };
    fx.type = 'outline';
    fx.params = { ...defaultParams('outline') };
    fx.keys = undefined;
    setEffectKey(fx, p.frames[0].id, { thickness: 1 });
    setEffectKey(fx, p.frames[4].id, { thickness: 4 });
    // 1 + 3 * 0.5 = 2.5 → 정수 단계로 반올림
    expect(effectParamsAt(p, fx, 2).thickness).toBe(3);
  });

  it('renders different pixels per frame and holds the single drawing', () => {
    const { p, fx } = setup();
    setEffectKey(fx, p.frames[0].id, { amount: 100 });
    setEffectKey(fx, p.frames[4].id, { amount: 0 });
    const layer = p.layers[0];
    expect(layerHolds(layer)).toBe(true);
    expect(sourceFrameId(p, layer, 3)).toBe(p.frames[0].id);
    const color = (i: number) => getPixel(compositeFrame(p, i), 4, 1, 1);
    expect(color(0)).toBe(packColor(255, 255, 255));
    expect(color(4)).toBe(red);
    const mid = compositeFrame(p, 2);
    expect(mid[(1 * 4 + 1) * 4 + 1]).toBeGreaterThan(100); // 초록이 섞여 분홍빛
    expect(mid[(1 * 4 + 1) * 4 + 1]).toBeLessThan(160);
    // 같은 값이 계산되는 프레임끼리는 캐시 키가 같음
    setEffectKey(fx, p.frames[4].id, { amount: 100 });
    expect(effectsKey(layer.effects, 1, p)).toBe(effectsKey(layer.effects, 3, p));
  });

  it('removing the last key keeps its value; clear keeps the current value', () => {
    const { p, fx } = setup();
    setEffectKey(fx, p.frames[2].id, { amount: 40 });
    expect(removeEffectKey(fx, p.frames[2].id)).toBe(true);
    expect(fx.keys).toBeUndefined();
    expect(fx.params.amount).toBe(40);
    setEffectKey(fx, p.frames[0].id, { amount: 0 });
    setEffectKey(fx, p.frames[4].id, { amount: 80 });
    expect(clearEffectKeys(p, fx, 2)).toBe(true);
    expect(fx.keys).toBeUndefined();
    expect(fx.params.amount).toBe(40);
  });

  it('follows frames: navigation, timeline markers, onion, frame removal', () => {
    const { p, fx } = setup(6);
    setEffectKey(fx, p.frames[1].id, { amount: 10 });
    setEffectKey(fx, p.frames[4].id, { amount: 90 });
    expect(neighborEffectKeyIndex(p, fx, 2, 1)).toBe(4);
    expect(neighborEffectKeyIndex(p, fx, 2, -1)).toBe(1);
    expect(hasEffectKeyAt(p.layers[0].effects, p.frames[4].id)).toBe(true);
    expect(changeFrames(p)).toEqual([true, true, false, false, true, false]);
    const removedId = p.frames[4].id;
    removeFrame(p, 4);
    expect(fx.keys!.some((k) => k.frameId === removedId)).toBe(false);
  });

  it('survives save and load; broken keys are dropped', async () => {
    const { p, fx } = setup();
    setEffectKey(fx, p.frames[0].id, { amount: 100 }, { kind: 'easeOut' });
    setEffectKey(fx, p.frames[3].id, { amount: 0 });
    const loaded = await deserializeProject(await serializeProject(p));
    const lfx = loaded.layers[0].effects[0];
    expect(lfx.keys).toHaveLength(2);
    expect(lfx.keys![0].ease.kind).toBe('easeOut');
    expect(effectParamsAt(loaded, lfx, 3).amount).toBe(0);
    expect(sanitizeEffectKeys([{ frameId: 'a', values: { amount: 'x', b: 2 } }, null, { values: {} }])).toEqual([
      { frameId: 'a', values: { b: 2 }, ease: { kind: 'linear' } },
    ]);
    expect(sanitizeEffectKeys('nope')).toBeUndefined();
  });
});

describe('keyed effect presets', () => {
  it('flash fade does not flash the frames before it', async () => {
    const { EFFECT_PRESETS } = await import('../src/core/effects');
    const preset = EFFECT_PRESETS.find((x) => x.id === 'flashFade')!;
    const { p } = setup(8);
    const fx: Effect = { id: 'f', type: preset.type, enabled: true, params: { ...defaultParams(preset.type), ...preset.params } };
    const start = 3;
    for (const k of preset.keys!) if (start + k.offset >= 0) setEffectKey(fx, p.frames[start + k.offset].id, k.values, k.ease ? { kind: k.ease } : undefined);
    const at = (i: number) => Number(effectParamsAt(p, fx, i).amount);
    expect([0, 1, 2, 3, 6, 7].map(at)).toEqual([0, 0, 0, 100, 0, 0]);
    expect(at(4)).toBeGreaterThan(at(5));
  });
});
