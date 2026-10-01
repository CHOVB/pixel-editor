/**
 * 자동 애니메이션 테스트: 점 추측 → 리깅 → 부위 → 동작 (예제 모험가로)
 */
import { describe, expect, it } from 'vitest';
import { guessRigPoints, guessView, neededRoom, previewMotion } from '../src/core/autoAnimate';
import { buildParts, createRig, DEFAULT_BUILD, findRig, planJoints, RIG_PARTS, segmentParts, type RigPoints } from '../src/core/autoRig';
import { deserializeProject, serializeProject } from '../src/core/fileFormat';
import { applyMotion, MOTION_IDS, motionTemplate } from '../src/core/motionTemplates';
import { contentBounds } from '../src/core/pixels';
import { createProject } from '../src/core/project';
import { compositeFrame } from '../src/core/render';
import { drawHero } from '../src/editor/sampleHero';

const W = 64;
const names = Object.fromEntries([...RIG_PARTS, 'group', 'armF', 'armB', 'legF', 'legB'].map((k) => [k, k])) as never;

function heroProject() {
  const hero = drawHero(W, W, 8, 18);
  const p = createProject(W, W);
  p.cels[`${p.layers[0].id}|${p.frames[0].id}`] = hero.pixels;
  const rig = createRig(p, p.layers[0].id, 0, hero.points, { ...DEFAULT_BUILD, facing: 1, view: 'side', names });
  if (!rig) throw new Error('rig failed');
  return { p, rig, hero };
}

/** 그림이 있는 가장 아래 줄 */
const lowestRow = (buf: Uint8ClampedArray) => {
  const b = contentBounds(buf, W, W);
  return b ? b.y + b.h - 1 : -1;
};

describe('auto rig', () => {
  it('guesses points close to the real joints and recognises a side view', () => {
    const hero = drawHero(W, W, 8, 18);
    const g = guessRigPoints(hero.pixels, W, W) as RigPoints;
    for (const k of Object.keys(hero.points) as (keyof RigPoints)[]) {
      expect(Math.hypot(g[k].x - hero.points[k].x, g[k].y - hero.points[k].y), k).toBeLessThan(2.5);
    }
    expect(guessView(hero.pixels, W, W)).toBe('side');
  });

  it('splits the drawing into every body part', () => {
    const hero = drawHero(W, W, 8, 18);
    const j = planJoints(hero.pixels, W, W, hero.points);
    const labels = segmentParts(hero.pixels, W, W, j);
    const counts = RIG_PARTS.map((_, i) => labels.filter((l) => l === i).length);
    // 뒤팔 윗부분은 몸통에 완전히 가려져서 안 보일 수 있음 → 대신 만든 부위 그림이 비어 있지 않은지 확인
    for (const [i, n] of counts.entries()) if (RIG_PARTS[i] !== 'upperArmB') expect(n, RIG_PARTS[i]).toBeGreaterThan(0);
    const { parts } = buildParts(hero.pixels, W, W, j, labels);
    for (const part of RIG_PARTS) expect(parts[part].some((v, i) => i % 4 === 3 && v > 0), part).toBe(true);
    const at = (q: { x: number; y: number }) => RIG_PARTS[labels[Math.floor(q.y) * W + Math.floor(q.x)]];
    expect(at(hero.points.head)).toBe('head');
    expect(at({ x: hero.points.handF.x, y: hero.points.handF.y - 0.5 })).toBe('foreArmF');
    // 팔꿈치는 어깨와 손 사이
    expect(j.elbowF.y).toBeGreaterThan(j.shoulderF.y);
    expect(j.elbowF.y).toBeLessThan(hero.points.handF.y);
  });

  it('builds a rig whose rest pose looks like the original drawing', () => {
    const { p, hero } = heroProject();
    const rest = compositeFrame(p, 0);
    let diff = 0;
    for (let i = 0; i < rest.length; i += 4) if (rest[i + 3] !== hero.pixels[i + 3] || rest[i] !== hero.pixels[i]) diff++;
    expect(diff).toBeLessThan(60); // 4096 픽셀 중 외곽선 이음새 몇 개만 다름
    expect(p.layers[0].visible).toBe(false); // 원본은 숨겨 둠
    expect(p.bones.filter((b) => b.rig).length).toBe(11);
  });

  it('places shoulders at the body sides for a front view', () => {
    const hero = drawHero(W, W, 8, 18);
    const pts = { ...hero.points, handF: { x: 40, y: 48 }, handB: { x: 24, y: 48 } };
    const side = planJoints(hero.pixels, W, W, pts, 'side');
    const front = planJoints(hero.pixels, W, W, pts, 'front');
    expect(Math.abs(side.shoulderF.x - side.shoulderB.x)).toBeLessThan(0.01);
    expect(front.shoulderF.x - front.shoulderB.x).toBeGreaterThan(8);
  });
});

describe('motions', () => {
  it('walk keeps the feet on the ground and actually moves', () => {
    const { p, rig } = heroProject();
    const ground = lowestRow(compositeFrame(p, 0));
    const res = applyMotion(p, rig.rigId, 'walk', 0);
    expect(res?.frames).toHaveLength(8);
    const frames = res!.frames.map((i) => compositeFrame(p, i));
    for (const f of frames) expect(Math.abs(lowestRow(f) - ground)).toBeLessThanOrEqual(1);
    expect(new Set(frames.map((f) => Array.from(f).join(','))).size).toBeGreaterThan(5);
    expect(p.frames.every((f) => f.duration > 0)).toBe(true);
  });

  it('jump leaves the ground and lands again', () => {
    const { p, rig } = heroProject();
    const ground = lowestRow(compositeFrame(p, 0));
    const res = applyMotion(p, rig.rigId, 'jump', 0)!;
    const lows = res.frames.map((i) => lowestRow(compositeFrame(p, i)));
    expect(Math.min(...lows)).toBeLessThan(ground - 8); // 공중
    expect(Math.abs(lows[lows.length - 1] - ground)).toBeLessThanOrEqual(1); // 착지
    // 예비 동작: 2번째 프레임은 웅크림 (머리가 내려감)
    const top = (i: number) => contentBounds(compositeFrame(p, res.frames[i]), W, W)!.y;
    expect(top(2)).toBeGreaterThan(top(0));
  });

  it('every motion has matching durations and poses; hurt adds a white flash', () => {
    for (const m of MOTION_IDS) {
      const tpl = motionTemplate(m);
      expect(tpl.durations.length, m).toBe(tpl.poses.length);
    }
    const { p, rig } = heroProject();
    applyMotion(p, rig.rigId, 'hurt', 0);
    const group = p.layers.find((l) => l.id === rig.groupId)!;
    expect(group.effects.some((e) => e.type === 'colorOverlay' && (e.keys?.length ?? 0) > 0)).toBe(true);
    const first = compositeFrame(p, 0);
    const white = Array.from({ length: first.length / 4 }, (_, i) => i).filter((i) => first[i * 4 + 3] > 0 && first[i * 4] > 240 && first[i * 4 + 1] > 240);
    expect(white.length).toBeGreaterThan(100);
  });

  it('can add another motion to the same rig later, and survives save/load', async () => {
    const { p, rig } = heroProject();
    applyMotion(p, rig.rigId, 'idle', 0);
    const before = p.frames.length;
    applyMotion(p, rig.rigId, 'run', before);
    expect(p.frames.length).toBe(before + 8);
    const loaded = await deserializeProject(await serializeProject(p));
    expect(findRig(loaded)?.rigId).toBe(rig.rigId);
    expect(Array.from(compositeFrame(loaded, 10))).toEqual(Array.from(compositeFrame(p, 10)));
  });

  it('preview tells how much room a jump needs', () => {
    const hero = drawHero(48, 48, 0, 2); // 위쪽 여백이 거의 없음
    const setup = { points: hero.points, facing: 1 as const, view: 'side' as const, build: DEFAULT_BUILD };
    const prev = previewMotion(hero.pixels, 48, 48, setup, 'jump', { strength: 1, speed: 1 })!;
    expect(prev.frames).toHaveLength(12);
    expect(neededRoom(prev, 48, 48).top).toBeGreaterThan(5);
    const walk = previewMotion(hero.pixels, 48, 48, setup, 'walk', { strength: 1, speed: 1 })!;
    expect(neededRoom(walk, 48, 48).top).toBe(0);
  });
});
