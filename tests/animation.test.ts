/**
 * 2·4단계 핵심 기능 테스트: 이징 / 키프레임 / 렌더 / RotSprite / 링크 셀 / 굽기 / 뼈대 / IK / 자동 중간 프레임
 */
import { describe, expect, it } from 'vitest';
import { compose, rotateDeg, translate } from '../src/core/affine';
import { bakeLayer } from '../src/core/bake';
import { packColor } from '../src/core/color';
import { EASE_KINDS, ease } from '../src/core/easing';
import { deserializeProject, serializeProject } from '../src/core/fileFormat';
import { generateInbetweens } from '../src/core/inbetween';
import { createTrack, evaluateTrack, keyAt, removeKey, setKey } from '../src/core/keyframes';
import { createBuffer, getPixel, setPixel, uniqueColors } from '../src/core/pixels';
import { addFrame, celKey, createProject, ensureCel, getCel, isLinkedToPrev, linkCels, sourceFrameId, unlinkCel } from '../src/core/project';
import { compositeFrame } from '../src/core/render';
import { transformBuffer } from '../src/core/resample';
import { boneEndpoints, createBone, poseWorld, setBoneKey, solveIK } from '../src/core/skeleton';
import type { Ease, TransformValues } from '../src/core/types';

const red = packColor(255, 0, 0);
const blue = packColor(0, 0, 255);
const LINEAR: Ease = { kind: 'linear' };

function values(patch: Partial<TransformValues>): TransformValues {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ...patch };
}

function countOpaque(buf: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++;
  return n;
}

function findColor(buf: Uint8ClampedArray, w: number, color: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < buf.length / 4; i++) {
    if (getPixel(buf, w, i % w, Math.floor(i / w)) === color) out.push({ x: i % w, y: Math.floor(i / w) });
  }
  return out;
}

/** 프레임 n 개짜리 프로젝트 */
function projectWithFrames(w: number, h: number, n: number) {
  const p = createProject(w, h);
  for (let i = 1; i < n; i++) addFrame(p, i);
  return p;
}

describe('easing', () => {
  it('starts at 0 and ends at 1 for every curve', () => {
    for (const kind of EASE_KINDS) {
      const e: Ease = kind === 'bezier' ? { kind, bezier: [0.3, 0, 0.7, 1] } : { kind };
      expect(ease(e, 0)).toBeCloseTo(0, 5);
      expect(ease(e, 1)).toBeCloseTo(1, 5);
    }
  });

  it('ease-in is slow at the start, ease-out is fast at the start', () => {
    expect(ease({ kind: 'easeIn' }, 0.5)).toBeLessThan(0.5);
    expect(ease({ kind: 'easeOut' }, 0.5)).toBeGreaterThan(0.5);
    expect(ease(LINEAR, 0.25)).toBeCloseTo(0.25);
  });
});

describe('keyframe tween', () => {
  it('interpolates between two keys and holds outside them', () => {
    const p = projectWithFrames(16, 8, 8);
    const track = createTrack(0, 0);
    setKey(track, p.frames[0].id, values({ x: 0 }), LINEAR);
    setKey(track, p.frames[7].id, values({ x: 14, rotation: 70 }), LINEAR);
    expect(evaluateTrack(p, track, 0).x).toBe(0);
    expect(evaluateTrack(p, track, 3).x).toBeCloseTo(6);
    expect(evaluateTrack(p, track, 3).rotation).toBeCloseTo(30);
    expect(evaluateTrack(p, track, 7).x).toBe(14);
    expect(keyAt(track, p.frames[7].id)).toBeTruthy();
    expect(removeKey(track, p.frames[7].id)).toBe(true);
    expect(evaluateTrack(p, track, 5).x).toBe(0);
  });

  it('one drawing + keyframes moves the layer on every frame (hold)', () => {
    const p = projectWithFrames(16, 4, 8);
    const layer = p.layers[0];
    setPixel(ensureCel(p, layer.id, p.frames[0].id), 16, 1, 1, red);
    layer.anim = createTrack(1, 1);
    setKey(layer.anim, p.frames[0].id, values({ x: 0 }), LINEAR);
    setKey(layer.anim, p.frames[7].id, values({ x: 14 }), LINEAR);
    // 프레임 3 에는 그림이 없지만 0번 그림을 이어서 씁니다.
    expect(sourceFrameId(p, layer, 3)).toBe(p.frames[0].id);
    const out = compositeFrame(p, 3);
    expect(findColor(out, 16, red)).toEqual([{ x: 7, y: 1 }]);
  });
});

describe('RotSprite / transform', () => {
  it('rotating 90° keeps pixel count and does not invent colors', () => {
    const w = 9;
    const src = createBuffer(w, w);
    for (let x = 2; x <= 6; x++) setPixel(src, w, x, 4, red);
    setPixel(src, w, 6, 4, blue);
    const m = compose(translate(4.5, 4.5), rotateDeg(90), translate(-4.5, -4.5));
    for (const method of ['nearest', 'rotsprite'] as const) {
      const out = transformBuffer(src, w, w, m, method);
      expect(countOpaque(out)).toBe(5);
      expect(new Set(uniqueColors(out))).toEqual(new Set([red, blue]));
      // 가로줄이 세로줄이 됩니다.
      const xs = new Set(findColor(out, w, red).map((p) => p.x));
      expect(xs.size).toBe(1);
    }
  });
});

describe('linked cels', () => {
  it('linking shares one drawing, unlinking makes a copy', () => {
    const p = projectWithFrames(4, 4, 3);
    const id = p.layers[0].id;
    setPixel(ensureCel(p, id, p.frames[0].id), 4, 0, 0, red);
    linkCels(p, id, 0, [1, 2]);
    expect(getCel(p, id, p.frames[2].id)).toBe(getCel(p, id, p.frames[0].id));
    expect(isLinkedToPrev(p, id, 1)).toBe(true);
    // 한 곳을 고치면 모두 바뀜
    setPixel(ensureCel(p, id, p.frames[1].id), 4, 3, 3, blue);
    expect(getPixel(getCel(p, id, p.frames[2].id) as Uint8ClampedArray, 4, 3, 3)).toBe(blue);
    expect(unlinkCel(p, id, 2)).toBe(true);
    expect(getCel(p, id, p.frames[2].id)).not.toBe(getCel(p, id, p.frames[0].id));
    expect(getPixel(getCel(p, id, p.frames[2].id) as Uint8ClampedArray, 4, 3, 3)).toBe(blue);
  });

  it('keeps links after save & load', async () => {
    const p = projectWithFrames(4, 4, 3);
    const id = p.layers[0].id;
    setPixel(ensureCel(p, id, p.frames[0].id), 4, 1, 1, red);
    linkCels(p, id, 0, [1, 2]);
    p.layers[0].anim = createTrack(2, 2);
    setKey(p.layers[0].anim, p.frames[2].id, values({ x: 1 }), LINEAR);
    p.layers[0].guide = true;
    const loaded = await deserializeProject(await serializeProject(p));
    const l = loaded.layers[0];
    expect(loaded.cels[celKey(l.id, loaded.frames[1].id)]).toBe(loaded.cels[celKey(l.id, loaded.frames[0].id)]);
    expect(l.anim?.keys.length).toBe(1);
    expect(l.guide).toBe(true);
  });
});

describe('bake', () => {
  it('turns keyframe motion into real pixels on every frame', () => {
    const p = projectWithFrames(8, 2, 3);
    const layer = p.layers[0];
    setPixel(ensureCel(p, layer.id, p.frames[0].id), 8, 0, 0, red);
    layer.anim = createTrack(0, 0);
    setKey(layer.anim, p.frames[0].id, values({ x: 0 }), LINEAR);
    setKey(layer.anim, p.frames[2].id, values({ x: 4 }), LINEAR);
    expect(bakeLayer(p, layer.id)).toBe(true);
    expect(layer.anim).toBeNull();
    expect(findColor(getCel(p, layer.id, p.frames[1].id) as Uint8ClampedArray, 8, red)).toEqual([{ x: 2, y: 0 }]);
    expect(findColor(getCel(p, layer.id, p.frames[2].id) as Uint8ClampedArray, 8, red)).toEqual([{ x: 4, y: 0 }]);
  });
});

describe('skeleton', () => {
  function arm() {
    const p = projectWithFrames(64, 64, 2);
    const upper = createBone(p, 10, 10, 0, 10, null, 'upper');
    p.bones.push(upper);
    const lower = createBone(p, 20, 10, 0, 10, upper.id, 'lower');
    p.bones.push(lower);
    return { p, upper, lower };
  }

  it('child bones follow their parent (forward kinematics)', () => {
    const { p, upper, lower } = arm();
    setBoneKey(upper, p.frames[1].id, { rotation: 90, x: 0, y: 0, scale: 1 });
    const world = poseWorld(p, 1);
    const end = boneEndpoints(world.get(lower.id)!, lower);
    expect(end.head.x).toBeCloseTo(10);
    expect(end.head.y).toBeCloseTo(20);
    expect(end.tail.x).toBeCloseTo(10);
    expect(end.tail.y).toBeCloseTo(30);
    // 키가 없는 0번 프레임은 키 하나뿐이므로 같은 자세를 유지
    const rest = boneEndpoints(poseWorld(p, 0).get(lower.id)!, lower);
    expect(rest.tail.y).toBeCloseTo(30);
  });

  it('IK reaches a target within reach', () => {
    const { p, lower } = arm();
    const target = { x: 22, y: 18 };
    const overrides = solveIK(p, 0, lower.id, target, 2, 32);
    const tip = boneEndpoints(poseWorld(p, 0, overrides).get(lower.id)!, lower).tail;
    expect(Math.hypot(tip.x - target.x, tip.y - target.y)).toBeLessThan(1);
  });
});

describe('auto in-betweens', () => {
  it('morph moves a sprite step by step without duplicating it', () => {
    const w = 16;
    const h = 6;
    const a = createBuffer(w, h);
    const b = createBuffer(w, h);
    // 2×2 덩어리가 왼쪽에서 오른쪽으로 이동
    for (const [x, y] of [
      [1, 2],
      [2, 2],
      [1, 3],
      [2, 3],
    ]) {
      setPixel(a, w, x, y, red);
      setPixel(b, w, x + 12, y, red);
    }
    const frames = generateInbetweens(a, b, w, h, { count: 3, method: 'morph', ease: LINEAR, smoothing: 1, fillHoles: true });
    expect(frames).toHaveLength(3);
    const centers = frames.map((f) => {
      const pts = findColor(f, w, red);
      expect(pts.length).toBeGreaterThanOrEqual(3);
      expect(pts.length).toBeLessThanOrEqual(5);
      return pts.reduce((s, q) => s + q.x, 0) / pts.length;
    });
    // 순서대로 오른쪽으로 이동 (대략 4, 7.5, 10.5)
    expect(centers[0]).toBeLessThan(centers[1]);
    expect(centers[1]).toBeLessThan(centers[2]);
    expect(centers[1]).toBeGreaterThan(6);
    expect(centers[1]).toBeLessThan(9);
  });

  it('dither crossfade mixes both drawings', () => {
    const w = 8;
    const a = createBuffer(w, w);
    const b = createBuffer(w, w);
    for (let i = 0; i < w * w; i++) {
      setPixel(a, w, i % w, Math.floor(i / w), red);
      setPixel(b, w, i % w, Math.floor(i / w), blue);
    }
    const [mid] = generateInbetweens(a, b, w, w, { count: 1, method: 'dither', ease: LINEAR });
    const reds = findColor(mid, w, red).length;
    expect(reds).toBeGreaterThan(16);
    expect(reds).toBeLessThan(48);
  });
});
