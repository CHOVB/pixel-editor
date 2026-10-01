/**
 * 예제 프로젝트 테스트: 모든 레이어가 모든 프레임에 보이고, 애니메이션이 실제로 움직이는지
 */
import { describe, expect, it } from 'vitest';
import { setPixel } from '../src/core/pixels';
import { createProject, ensureCel, addFrame, layerHolds, sourceFrameId } from '../src/core/project';
import { compositeFrame, renderLayer } from '../src/core/render';
import { packColor } from '../src/core/color';
import { buildSample, SAMPLE_IDS } from '../src/editor/samples';

describe('samples', () => {
  for (const id of SAMPLE_IDS) {
    it(`${id}: every drawing layer is visible on every frame`, () => {
      const p = buildSample(id);
      for (const layer of p.layers) {
        if (layer.kind === 'group' || layer.kind === 'reference') continue;
        for (let f = 0; f < p.frames.length; f++) {
          expect(renderLayer(p, layer, f, { includeHidden: true }), `${layer.name} @${f}`).not.toBeNull();
        }
      }
    });

    it(`${id}: frames are animated (not all identical)`, () => {
      const p = buildSample(id);
      const frames = p.frames.map((_, f) => Array.from(compositeFrame(p, f)).join(','));
      expect(new Set(frames).size).toBeGreaterThan(1);
    });
  }
});

describe('hold rule', () => {
  it('a layer with a motion effect keeps showing its single drawing', () => {
    const p = createProject(8, 8);
    addFrame(p, 1);
    const l = p.layers[0];
    setPixel(ensureCel(p, l.id, p.frames[0].id), 8, 4, 4, packColor(255, 0, 0));
    expect(sourceFrameId(p, l, 1)).toBeNull();
    l.effects.push({ id: 'fx', type: 'sway', enabled: true, params: {} });
    expect(layerHolds(l)).toBe(true);
    expect(sourceFrameId(p, l, 1)).toBe(p.frames[0].id);
    // 색만 바꾸는 효과(프레임과 무관)는 hold 하지 않음
    l.effects = [{ id: 'fx', type: 'outline', enabled: true, params: {} }];
    expect(layerHolds(l)).toBe(false);
  });
});
