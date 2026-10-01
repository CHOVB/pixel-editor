/**
 * 프레임 일괄 변형 · 어니언 "바뀌는 프레임만" 테스트
 */
import { describe, expect, it } from 'vitest';
import { packColor } from '../src/core/color';
import { changeFrames, onionTargets, transformCelBuffer, NO_TRANSFORM } from '../src/core/frameTools';
import { createTrack, setKey } from '../src/core/keyframes';
import { createBuffer, getPixel, setPixel } from '../src/core/pixels';
import { addFrame, celKey, createProject, ensureCel, getCel, linkCels } from '../src/core/project';
import { setState } from '../src/store/editorStore';
import { transformFramesAction } from '../src/store/frameActions';
import { replaceProject } from '../src/store/actions';

const red = packColor(255, 0, 0);
const blue = packColor(0, 0, 255);

function where(buf: Uint8ClampedArray, w: number, color: number) {
  for (let i = 0; i < buf.length / 4; i++) if (getPixel(buf, w, i % w, Math.floor(i / w)) === color) return [i % w, Math.floor(i / w)];
  return null;
}

describe('transformCelBuffer', () => {
  const w = 5;
  const src = createBuffer(w, w);
  setPixel(src, w, 1, 0, red); // 위쪽 가운데보다 왼쪽

  it('moves, with and without wrap', () => {
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, dx: 2, dy: 3 }), w, red)).toEqual([3, 3]);
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, dx: -3 }), w, red)).toBeNull();
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, dx: -3, wrap: true }), w, red)).toEqual([3, 0]);
  });

  it('flips and rotates around the center', () => {
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, flipH: true }), w, red)).toEqual([3, 0]);
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, flipV: true }), w, red)).toEqual([1, 4]);
    // 시계 방향 90°: 위쪽 → 오른쪽
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, rotate: 90 }), w, red)).toEqual([4, 1]);
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, rotate: 180 }), w, red)).toEqual([3, 4]);
    expect(where(transformCelBuffer(src, w, w, { ...NO_TRANSFORM, rotate: 270 }), w, red)).toEqual([0, 3]);
  });
});

describe('transformFramesAction', () => {
  it('moves only the selected range and keeps links inside it', () => {
    const p = createProject(6, 6);
    for (let i = 1; i < 4; i++) addFrame(p, i);
    const l = p.layers[0];
    setPixel(ensureCel(p, l.id, p.frames[0].id), 6, 0, 0, red);
    linkCels(p, l.id, 0, [1, 2, 3]);
    replaceProject(p, null);
    setState({ currentLayerId: l.id, currentFrame: 1, frameRange: [1, 2] });
    const n = transformFramesAction({ ...NO_TRANSFORM, dx: 2, frames: 'range', layers: 'current' });
    expect(n).toBe(2);
    const cel = (i: number) => getCel(p, l.id, p.frames[i].id) as Uint8ClampedArray;
    expect(where(cel(0), 6, red)).toEqual([0, 0]); // 범위 밖은 그대로
    expect(where(cel(1), 6, red)).toEqual([2, 0]);
    expect(cel(1)).toBe(cel(2)); // 범위 안 링크 유지
    expect(cel(0)).toBe(cel(3)); // 범위 밖끼리 링크 유지
  });
});

describe('onion: changing frames only', () => {
  it('skips held frames and finds keyframes', () => {
    const p = createProject(4, 4);
    for (let i = 1; i < 8; i++) addFrame(p, i);
    const l = p.layers[0];
    // 0~2: 같은 그림(링크), 3: 새 그림, 4~7: 링크
    setPixel(ensureCel(p, l.id, p.frames[0].id), 4, 0, 0, red);
    linkCels(p, l.id, 0, [1, 2]);
    setPixel(ensureCel(p, l.id, p.frames[3].id), 4, 1, 1, blue);
    linkCels(p, l.id, 3, [4, 5, 6, 7]);
    // 6번 프레임에 키프레임
    l.anim = createTrack(0, 0);
    setKey(l.anim, p.frames[6].id, { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    expect(changeFrames(p)).toEqual([true, false, false, true, false, false, true, false]);
    expect(onionTargets(p, 5, 2, 2, true, false)).toEqual({ prev: [3, 0], next: [6] });
    expect(onionTargets(p, 5, 2, 2, false, false)).toEqual({ prev: [4, 3], next: [6, 7] });
    expect(onionTargets(p, 7, 1, 1, true, true)).toEqual({ prev: [6], next: [0] });
    expect(p.cels[celKey(l.id, p.frames[1].id)]).toBe(p.cels[celKey(l.id, p.frames[0].id)]);
  });
});
