import { describe, expect, it } from 'vitest';
import { packColor } from '../src/core/color';
import { applyPatch, diffBuffers, History } from '../src/core/history';
import { cloneBuffer, getPixel, setPixel } from '../src/core/pixels';
import {
  addFrame,
  addLayer,
  addTag,
  celKey,
  createProject,
  duplicateFrame,
  duplicateLayer,
  ensureCel,
  mergeDown,
  moveFrame,
  removeFrame,
  removeLayer,
  resizeCanvas,
  restoreStructure,
  reverseFrames,
  rotateProject,
  snapshotStructure,
} from '../src/core/project';
import { compositeFrame } from '../src/core/render';
import { combineMasks, maskOutline, rectMask, translateMask } from '../src/core/selection';

const red = packColor(255, 0, 0);
const blue = packColor(0, 0, 255);

describe('history', () => {
  it('undoes and redoes in order', () => {
    const h = new History();
    let value = 0;
    const push = (n: number) => {
      const before = value;
      value = n;
      h.push({ label: `set ${n}`, undo: () => (value = before), redo: () => (value = n) });
    };
    push(1);
    push(2);
    h.undo();
    expect(value).toBe(1);
    h.redo();
    expect(value).toBe(2);
    h.undo();
    push(3); // 새 작업을 하면 redo 기록은 사라짐
    expect(h.canRedo()).toBe(false);
    h.undo();
    h.undo();
    expect(value).toBe(0);
    expect(h.canUndo()).toBe(false);
  });

  it('stores only the changed rectangle', () => {
    const before = new Uint8ClampedArray(8 * 8 * 4);
    const after = cloneBuffer(before);
    setPixel(after, 8, 2, 3, red);
    setPixel(after, 8, 5, 4, red);
    const patch = diffBuffers(before, after, 8, 8);
    expect(patch).not.toBeNull();
    expect(patch).toMatchObject({ x: 2, y: 3, w: 4, h: 2 });
    const target = cloneBuffer(after);
    applyPatch(target, 8, patch!, 'before');
    expect(target).toEqual(before);
    applyPatch(target, 8, patch!, 'after');
    expect(target).toEqual(after);
    expect(diffBuffers(before, cloneBuffer(before), 8, 8)).toBeNull();
  });
});

describe('project structure', () => {
  it('adds, duplicates, moves and removes layers', () => {
    const p = createProject(4, 4);
    const l2 = addLayer(p);
    expect(p.layers).toHaveLength(2);
    setPixel(ensureCel(p, l2.id, p.frames[0].id), 4, 0, 0, red);
    const copy = duplicateLayer(p, l2.id)!;
    expect(getPixel(p.cels[celKey(copy.id, p.frames[0].id)], 4, 0, 0)).toBe(red);
    // 복제본은 원본과 다른 버퍼여야 합니다.
    expect(p.cels[celKey(copy.id, p.frames[0].id)]).not.toBe(p.cels[celKey(l2.id, p.frames[0].id)]);
    expect(removeLayer(p, copy.id)).toBe(true);
    expect(p.cels[celKey(copy.id, p.frames[0].id)]).toBeUndefined();
  });

  it('never removes the last layer or frame', () => {
    const p = createProject(4, 4);
    expect(removeLayer(p, p.layers[0].id)).toBe(false);
    expect(removeFrame(p, 0)).toBe(false);
  });

  it('merges a layer down with opacity', () => {
    const p = createProject(2, 1);
    const bottom = p.layers[0];
    setPixel(ensureCel(p, bottom.id, p.frames[0].id), 2, 0, 0, blue);
    const top = addLayer(p);
    top.opacity = 1;
    setPixel(ensureCel(p, top.id, p.frames[0].id), 2, 0, 0, red);
    setPixel(ensureCel(p, top.id, p.frames[0].id), 2, 1, 0, red);
    const merged = mergeDown(p, top.id);
    expect(merged?.id).toBe(bottom.id);
    expect(p.layers).toHaveLength(1);
    const cel = p.cels[celKey(bottom.id, p.frames[0].id)];
    expect(getPixel(cel, 2, 0, 0)).toBe(red);
    expect(getPixel(cel, 2, 1, 0)).toBe(red);
  });

  it('keeps tags in sync with frame changes', () => {
    const p = createProject(2, 2);
    addFrame(p, 1);
    addFrame(p, 2);
    addFrame(p, 3); // 프레임 4개
    const tag = addTag(p, 'walk', 1, 2);
    addFrame(p, 0); // 앞에 끼워 넣으면 태그가 뒤로 밀림
    expect([tag.from, tag.to]).toEqual([2, 3]);
    duplicateFrame(p, 2); // 태그 안에서 복제하면 태그가 늘어남
    expect([tag.from, tag.to]).toEqual([2, 4]);
    removeFrame(p, 0);
    expect([p.tags[0].from, p.tags[0].to]).toEqual([1, 3]);
  });

  it('moves and reverses frames', () => {
    const p = createProject(2, 2);
    addFrame(p, 1);
    addFrame(p, 2);
    const ids = p.frames.map((f) => f.id);
    moveFrame(p, 0, 2);
    expect(p.frames.map((f) => f.id)).toEqual([ids[1], ids[2], ids[0]]);
    reverseFrames(p, 0, 2);
    expect(p.frames.map((f) => f.id)).toEqual([ids[0], ids[2], ids[1]]);
  });

  it('restores a structure snapshot', () => {
    const p = createProject(4, 4);
    const snap = snapshotStructure(p);
    addLayer(p);
    addFrame(p, 1);
    resizeCanvas(p, 8, 6, 0.5, 0.5);
    restoreStructure(p, snap);
    expect(p.layers).toHaveLength(1);
    expect(p.frames).toHaveLength(1);
    expect([p.width, p.height]).toEqual([4, 4]);
  });

  it('resizes the canvas around an anchor', () => {
    const p = createProject(2, 2);
    setPixel(ensureCel(p, p.layers[0].id, p.frames[0].id), 2, 0, 0, red);
    resizeCanvas(p, 4, 4, 0.5, 0.5);
    expect(getPixel(p.cels[celKey(p.layers[0].id, p.frames[0].id)], 4, 1, 1)).toBe(red);
  });

  it('rotates the whole image', () => {
    const p = createProject(3, 2);
    setPixel(ensureCel(p, p.layers[0].id, p.frames[0].id), 3, 0, 0, red);
    rotateProject(p, true);
    expect([p.width, p.height]).toEqual([2, 3]);
    expect(getPixel(p.cels[celKey(p.layers[0].id, p.frames[0].id)], 2, 1, 0)).toBe(red);
  });
});

describe('compositeFrame', () => {
  it('stacks visible layers bottom to top', () => {
    const p = createProject(1, 1);
    setPixel(ensureCel(p, p.layers[0].id, p.frames[0].id), 1, 0, 0, blue);
    const top = addLayer(p);
    setPixel(ensureCel(p, top.id, p.frames[0].id), 1, 0, 0, red);
    expect(getPixel(compositeFrame(p, 0), 1, 0, 0)).toBe(red);
    top.visible = false;
    expect(getPixel(compositeFrame(p, 0), 1, 0, 0)).toBe(blue);
    top.visible = true;
    top.opacity = 0.5;
    const [r, , b, a] = Array.from(compositeFrame(p, 0));
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });
});

describe('selection masks', () => {
  it('combines masks', () => {
    const a = rectMask(4, 4, 0, 0, 1, 1);
    const b = rectMask(4, 4, 1, 1, 2, 2);
    expect(combineMasks(a, b, 'add').reduce((s, v) => s + v, 0)).toBe(7);
    expect(combineMasks(a, b, 'subtract').reduce((s, v) => s + v, 0)).toBe(3);
    expect(combineMasks(a, b, 'replace')).toBe(b);
  });

  it('translates masks and builds outlines', () => {
    const m = rectMask(4, 4, 0, 0, 0, 0);
    const moved = translateMask(m, 4, 4, 2, 1);
    expect(moved[1 * 4 + 2]).toBe(1);
    expect(maskOutline(m, 4, 4)).toHaveLength(4);
  });
});
