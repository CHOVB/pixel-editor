/**
 * 렌더링 캐시 테스트 (프레임 합성 캐시 · 그룹 캐시 · 메모리 한도)
 */
import { describe, expect, it } from 'vitest';
import { packColor } from '../src/core/color';
import { getPixel, setPixel } from '../src/core/pixels';
import { addLayer, createProject, ensureCel } from '../src/core/project';
import { clearRenderCache, compositeFrame, layerPieces, piecesKey, renderCacheBytes } from '../src/core/render';
import { markEdited } from '../src/core/versions';

const red = packColor(255, 0, 0);
const blue = packColor(0, 0, 255);

describe('render caches', () => {
  it('frame composite cache refreshes after an in-place edit', () => {
    const p = createProject(8, 8);
    const cel = ensureCel(p, p.layers[0].id, p.frames[0].id);
    setPixel(cel, 8, 1, 1, red);
    expect(getPixel(compositeFrame(p, 0), 8, 1, 1)).toBe(red);
    setPixel(cel, 8, 1, 1, blue);
    markEdited(cel); // 그리기 도구가 하는 것과 같음
    expect(getPixel(compositeFrame(p, 0), 8, 1, 1)).toBe(blue);
  });

  it('returns a copy, so callers can change the result safely', () => {
    const p = createProject(4, 4);
    setPixel(ensureCel(p, p.layers[0].id, p.frames[0].id), 4, 0, 0, red);
    const a = compositeFrame(p, 0);
    a.fill(0);
    expect(getPixel(compositeFrame(p, 0), 4, 0, 0)).toBe(red);
  });

  it('group composite follows its children', () => {
    const p = createProject(4, 4);
    const group = addLayer(p, undefined, 'g', 'group');
    const child = addLayer(p, undefined, 'c', 'pixel', group.id);
    const cel = ensureCel(p, child.id, p.frames[0].id);
    setPixel(cel, 4, 2, 2, red);
    expect(getPixel(compositeFrame(p, 0), 4, 2, 2)).toBe(red);
    const before = piecesKey(layerPieces(p, null, 0));
    setPixel(cel, 4, 2, 2, blue);
    markEdited(cel);
    expect(piecesKey(layerPieces(p, null, 0))).not.toBe(before);
    expect(getPixel(compositeFrame(p, 0), 4, 2, 2)).toBe(blue);
    // 그룹 불투명도 0 → 그 그룹은 합성 목록에서 빠짐
    group.opacity = 0;
    expect(layerPieces(p, null, 0).some((x) => x.key.startsWith(group.id))).toBe(false);
  });

  it('keeps memory under the budget on big canvases', () => {
    clearRenderCache();
    const p = createProject(1024, 1024);
    const layer = p.layers[0];
    const cel = ensureCel(p, layer.id, p.frames[0].id);
    for (let i = 0; i < 120; i++) {
      setPixel(cel, 1024, i, 0, red);
      markEdited(cel);
      compositeFrame(p, 0);
    }
    expect(renderCacheBytes()).toBeLessThanOrEqual(384 * 1024 * 1024);
    clearRenderCache();
    expect(renderCacheBytes()).toBe(0);
  });
});
