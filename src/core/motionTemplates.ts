/**
 * 동작 템플릿 (자동 리깅한 캐릭터를 움직이는 "안무")
 * ------------------------------------------------------------
 * 걷기 · 달리기 · 대기 · 점프 · 공격 · 피격 6가지.
 * 애니메이션의 기본 원칙을 넣어서 손으로 만든 것처럼 보이게 했습니다.
 *  - 예비 동작(anticipation): 점프 전에 웅크리고, 휘두르기 전에 팔을 뒤로
 *  - 따라오는 동작(follow-through / overlap): 팔이 다리보다 한 박자 늦게, 휘두른 뒤 살짝 넘어갔다 돌아옴
 *  - 찌그러짐과 늘어남(squash & stretch): 착지할 때 웅크리고, 뛸 때 쭉 펴짐
 *  - 타이밍: 예비 동작은 길게, 타격 순간은 짧게 (프레임마다 시간이 다름)
 *  - 발 붙이기: 땅을 딛는 프레임은 발이 정확히 땅에 닿도록 몸 높이를 자동 계산 (미끄러짐·뜸 방지)
 *
 * 각도는 "몸 기준"입니다. (+ = 앞으로/구부림) → 캐릭터가 보는 방향에 맞게 뼈 회전으로 바꿉니다.
 * 앞모습(front) 캐릭터는 앞뒤로 흔드는 동작을 "길이가 짧아지는 것"(원근)으로 바꿔서 보여 줍니다.
 */
import type { Mat } from './affine';
import { boneEndpoints, poseWorld, setBoneKey } from './skeleton';
import { addFrame, layerHolds } from './project';
import { findRig, type RigPartId } from './autoRig';
import { LINEAR } from './easing';
import type { Bone, Effect, Layer, Project } from './types';

export type MotionId = 'idle' | 'walk' | 'run' | 'jump' | 'attack' | 'hurt';
export const MOTION_IDS: MotionId[] = ['walk', 'run', 'idle', 'jump', 'attack', 'hurt'];

/** 한 프레임의 자세 (각도: 도, 이동: "단위" = 캐릭터 키의 1/32) */
export interface MotionPose {
  rootX: number;
  /** 추가로 띄우기(-)/낮추기(+). 땅 붙이기 결과에 더해짐 */
  rootY: number;
  torso: number;
  head: number;
  upperArmF: number;
  foreArmF: number;
  upperArmB: number;
  foreArmB: number;
  thighF: number;
  shinF: number;
  thighB: number;
  shinB: number;
  /** 몸통 늘이기(>1)/찌그러뜨리기(<1) */
  torsoScale: number;
  /** 윗몸(몸통·머리·팔)만 아래로(+) 내리기 – 다리는 그대로 (숨쉬기) */
  bodyY: number;
  /** 팔만 위(-)/아래(+)로 – 몸보다 한 박자 늦게 따라오는 느낌 */
  armsY: number;
  /** 이 프레임에서 발을 땅에 붙일지 (공중이면 false) */
  grounded: boolean;
}

export interface MotionTemplate {
  id: MotionId;
  loop: boolean;
  /** 프레임별 재생 시간 (ms) */
  durations: number[];
  poses: MotionPose[];
  /** 피격 같은 동작에서 쓰는 번쩍임 효과 (프레임 번호 → 하얗게 %) */
  flash?: { frame: number; amount: number }[];
}

const ZERO: MotionPose = {
  rootX: 0,
  rootY: 0,
  torso: 0,
  head: 0,
  upperArmF: 0,
  foreArmF: 0,
  upperArmB: 0,
  foreArmB: 0,
  thighF: 0,
  shinF: 0,
  thighB: 0,
  shinB: 0,
  torsoScale: 1,
  bodyY: 0,
  armsY: 0,
  grounded: true,
};

const pose = (p: Partial<MotionPose>): MotionPose => ({ ...ZERO, ...p });
const at = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];

/* ------------------------------------------------------------------ */
/* 템플릿                                                                */
/* ------------------------------------------------------------------ */

/** 걷기 (8프레임): 닿기 → 내려앉기 → 지나가기 → 올라서기 × 2 */
function walk(): MotionTemplate {
  // 앞다리 기준 (0 = 앞다리가 앞으로 뻗어 땅에 닿음). 뒷다리는 반 박자(4프레임) 어긋남
  const thigh = [24, 14, 0, -13, -22, -14, 6, 20];
  const shin = [4, 16, 6, 2, 10, 38, 50, 22];
  const poses: MotionPose[] = [];
  for (let i = 0; i < 8; i++) {
    // 팔은 반대쪽 다리와 함께, 한 프레임 늦게 (따라오는 동작)
    const armF = -0.75 * at(thigh, i - 1);
    const armB = -0.75 * at(thigh, i + 3);
    poses.push(
      pose({
        thighF: thigh[i],
        shinF: shin[i],
        thighB: at(thigh, i + 4),
        shinB: at(shin, i + 4),
        upperArmF: armF,
        foreArmF: 10 + Math.max(0, armF) * 0.6,
        upperArmB: armB,
        foreArmB: 10 + Math.max(0, armB) * 0.6,
      }),
    );
  }
  return { id: 'walk', loop: true, durations: Array(8).fill(110), poses };
}

/** 달리기 (8프레임): 몸을 앞으로 숙이고, 두 발이 모두 뜨는 순간이 있음 */
function run(): MotionTemplate {
  const thigh = [32, 8, -28, -42, -22, 18, 48, 50];
  const shin = [14, 34, 16, 62, 96, 100, 64, 28];
  const air = [false, false, true, true, false, false, true, true];
  const lift = [0, 0, -2, -1.5, 0, 0, -2, -1.5];
  const poses: MotionPose[] = [];
  for (let i = 0; i < 8; i++) {
    const armF = -1.0 * at(thigh, i - 1);
    const armB = -1.0 * at(thigh, i + 3);
    poses.push(
      pose({
        torso: 10,
        head: -6,
        thighF: thigh[i],
        shinF: shin[i],
        thighB: at(thigh, i + 4),
        shinB: at(shin, i + 4),
        upperArmF: armF,
        foreArmF: 85,
        upperArmB: armB,
        foreArmB: 85,
        rootY: lift[i],
        grounded: !air[i],
      }),
    );
  }
  return { id: 'run', loop: true, durations: Array(8).fill(75), poses };
}

/** 대기 (8프레임): 숨 쉬듯 윗몸이 1픽셀 내려갔다 올라오고, 팔은 한 박자 늦게 따라옴 (다리는 그대로 → 도트가 흔들리지 않음) */
function idle(): MotionTemplate {
  const drop = [0, 0, 0, 1, 1, 1, 1, 0];
  const poses = drop.map((d, i) =>
    pose({
      bodyY: d,
      // 몸이 내려가는 순간 팔은 잠깐 제자리(-1), 올라오는 순간은 잠깐 아래(+1)
      armsY: at(drop, i - 1) - d,
    }),
  );
  return { id: 'idle', loop: true, durations: [180, 140, 140, 180, 140, 140, 140, 140], poses };
}

/**
 * 점프 (12프레임): 웅크림 → 박차기(늘어남) → 웅크려 날기 → 내려오며 다리 펴기 → 착지(찌그러짐) → 회복
 * 앞팔은 앞으로(얼굴을 가리지 않게), 뒤팔은 머리 뒤로 더 높이
 */
function jump(): MotionTemplate {
  const P: Partial<MotionPose>[] = [
    {},
    { thighF: 26, shinF: 52, thighB: 26, shinB: 52, torso: 12, upperArmF: -35, foreArmF: 20, upperArmB: -30, foreArmB: 20 },
    { thighF: 42, shinF: 84, thighB: 42, shinB: 84, torso: 20, upperArmF: -55, foreArmF: 30, upperArmB: -50, foreArmB: 30, torsoScale: 0.94 },
    { thighF: -4, shinF: 2, thighB: -8, shinB: 4, upperArmF: 82, foreArmF: 6, upperArmB: 125, foreArmB: 8, torsoScale: 1.06, rootY: -3, grounded: false },
    { thighF: 22, shinF: 44, thighB: 14, shinB: 34, torso: 4, upperArmF: 78, foreArmF: 12, upperArmB: 116, foreArmB: 14, rootY: -9, grounded: false },
    { thighF: 46, shinF: 74, thighB: 38, shinB: 70, torso: 8, upperArmF: 70, foreArmF: 20, upperArmB: 102, foreArmB: 24, rootY: -13, grounded: false },
    { thighF: 55, shinF: 88, thighB: 48, shinB: 84, torso: 10, upperArmF: 62, foreArmF: 26, upperArmB: 92, foreArmB: 30, rootY: -14, grounded: false },
    { thighF: 34, shinF: 46, thighB: 28, shinB: 44, torso: 6, upperArmF: 72, foreArmF: 16, upperArmB: 106, foreArmB: 20, rootY: -11, grounded: false },
    { thighF: 12, shinF: 14, thighB: 8, shinB: 12, torso: 2, upperArmF: 78, foreArmF: 10, upperArmB: 114, foreArmB: 12, rootY: -5, grounded: false },
    { thighF: 30, shinF: 60, thighB: 30, shinB: 60, torso: 14, upperArmF: 45, foreArmF: 25, upperArmB: 40, foreArmB: 25 },
    { thighF: 40, shinF: 80, thighB: 40, shinB: 80, torso: 20, upperArmF: 20, foreArmF: 30, upperArmB: 15, foreArmB: 30, torsoScale: 0.94 },
    { thighF: 10, shinF: 20, thighB: 10, shinB: 20, torso: 5, upperArmF: 5, foreArmF: 10, upperArmB: 4, foreArmB: 10 },
  ];
  return {
    id: 'jump',
    loop: false,
    durations: [120, 90, 110, 60, 60, 70, 100, 70, 60, 60, 110, 140],
    poses: P.map(pose),
  };
}

/** 공격 (9프레임): 팔을 뒤로 젖혀 모았다가(길게) → 순식간에 휘두름(짧게) → 살짝 넘어갔다 돌아옴 */
function attack(): MotionTemplate {
  const stance = { thighF: 12, shinF: 6, thighB: -12, shinB: 8 };
  const P: Partial<MotionPose>[] = [
    { ...stance },
    { ...stance, thighF: 18, torso: -6, rootX: -1, upperArmF: -60, foreArmF: 70, upperArmB: 25, foreArmB: 20 },
    { ...stance, thighF: 20, torso: -10, head: 4, rootX: -1, upperArmF: -115, foreArmF: 60, upperArmB: 35, foreArmB: 25 },
    { thighF: 32, shinF: 12, thighB: -26, shinB: 14, torso: 14, head: -4, rootX: 2, upperArmF: 62, foreArmF: 4, upperArmB: -35, foreArmB: 15 },
    { thighF: 34, shinF: 14, thighB: -28, shinB: 14, torso: 18, head: -6, rootX: 2, upperArmF: 86, foreArmF: 0, upperArmB: -42, foreArmB: 15 },
    { thighF: 32, shinF: 12, thighB: -26, shinB: 14, torso: 15, head: -4, rootX: 2, upperArmF: 74, foreArmF: 6, upperArmB: -36, foreArmB: 15 },
    { thighF: 24, shinF: 10, thighB: -20, shinB: 12, torso: 8, rootX: 1, upperArmF: 36, foreArmF: 20, upperArmB: -18, foreArmB: 15 },
    { ...stance, torso: 3, upperArmF: 12, foreArmF: 16, upperArmB: -6, foreArmB: 12 },
    { ...stance },
  ];
  return { id: 'attack', loop: false, durations: [100, 120, 160, 50, 50, 80, 100, 110, 140], poses: P.map(pose) };
}

/** 피격 (7프레임): 맞는 순간 뒤로 밀리고 머리가 한 박자 늦게 젖혀짐(채찍처럼) + 하얗게 번쩍 */
function hurt(): MotionTemplate {
  const P: Partial<MotionPose>[] = [
    { rootX: -2, torso: -14, head: -6, upperArmF: 30, foreArmF: 30, upperArmB: 25, foreArmB: 30, thighF: 14, shinF: 10, thighB: -6, shinB: 12 },
    { rootX: -3, torso: -20, head: -18, upperArmF: 45, foreArmF: 40, upperArmB: 38, foreArmB: 40, thighF: 18, shinF: 14, thighB: -8, shinB: 14 },
    { rootX: -3, torso: -15, head: -12, upperArmF: 32, foreArmF: 30, upperArmB: 28, foreArmB: 30, thighF: 16, shinF: 12, thighB: -6, shinB: 12 },
    { rootX: -2, torso: -9, head: -4, upperArmF: 18, foreArmF: 20, upperArmB: 16, foreArmB: 20, thighF: 10, shinF: 10, thighB: -4, shinB: 8 },
    { rootX: -1, torso: -4, head: 0, upperArmF: 8, foreArmF: 12, upperArmB: 6, foreArmB: 12, thighF: 5, shinF: 6 },
    { rootX: 0, torso: -1, upperArmF: 2, foreArmF: 6, upperArmB: 2, foreArmB: 6 },
    {},
  ];
  return {
    id: 'hurt',
    loop: false,
    durations: [60, 80, 100, 100, 100, 120, 140],
    poses: P.map(pose),
    flash: [
      { frame: 0, amount: 100 },
      { frame: 1, amount: 70 },
      { frame: 2, amount: 0 },
    ],
  };
}

const BUILDERS: Record<MotionId, () => MotionTemplate> = { idle, walk, run, jump, attack, hurt };

export function motionTemplate(id: MotionId): MotionTemplate {
  return BUILDERS[id]();
}

/* ------------------------------------------------------------------ */
/* 자세 → 뼈 키프레임                                                    */
/* ------------------------------------------------------------------ */

export interface MotionOptions {
  /** 움직임 크기 (1 = 기본, 0.5 = 절반, 1.5 = 크게) */
  strength: number;
  /** 빠르기 (1 = 기본, 2 = 두 배 빠르게) */
  speed: number;
}

export const DEFAULT_MOTION_OPTIONS: MotionOptions = { strength: 1, speed: 1 };

interface BonePoseOut {
  rotation: number;
  scale: number;
  /** 화면 기준 이동 (픽셀) */
  dx?: number;
  dy?: number;
}

/** 화면 기준 이동 → 뼈 자신의 축 기준 이동 (뼈 키의 x/y 는 뼈 방향 축) */
function toBoneLocal(b: Bone, dx: number, dy: number): { x: number; y: number } {
  const r = deg(-b.rotation);
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

const deg = (d: number) => (d * Math.PI) / 180;
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/**
 * 몸 기준 각도 → 뼈 회전/길이
 * 옆모습: 앞으로 흔들기 = 보는 방향 쪽으로 회전
 * 앞모습: 앞뒤 흔들기는 화면에서 보면 "짧아짐" → 길이(scale) 로, 살짝 바깥쪽으로 벌어짐
 */
function toBones(p: MotionPose, facing: 1 | -1, view: 'side' | 'front', strength: number): Record<RigPartId, BonePoseOut> {
  const s = (v: number) => v * strength;
  if (view === 'side') {
    return {
      torso: { rotation: facing * s(p.torso), scale: 1 + (p.torsoScale - 1) * strength },
      head: { rotation: facing * s(p.head), scale: 1 },
      upperArmF: { rotation: -facing * s(p.upperArmF), scale: 1 },
      foreArmF: { rotation: -facing * s(p.foreArmF), scale: 1 },
      upperArmB: { rotation: -facing * s(p.upperArmB), scale: 1 },
      foreArmB: { rotation: -facing * s(p.foreArmB), scale: 1 },
      thighF: { rotation: -facing * s(p.thighF), scale: 1 },
      shinF: { rotation: facing * s(p.shinF), scale: 1 },
      thighB: { rotation: -facing * s(p.thighB), scale: 1 },
      shinB: { rotation: facing * s(p.shinB), scale: 1 },
    };
  }
  // 앞모습: 화면에 보이는 길이 = cos(앞뒤 각도). 자식 뼈는 부모 길이 변화를 이어받으므로 비율로 나눔
  const fore = (upper: number, lower: number) => {
    const u = Math.max(0.35, Math.abs(Math.cos(deg(s(upper)))));
    const l = Math.max(0.35, Math.abs(Math.cos(deg(s(upper) - s(lower)))));
    return [u, l / u] as const;
  };
  const [aF, aFl] = fore(p.upperArmF, -p.foreArmF);
  const [aB, aBl] = fore(p.upperArmB, -p.foreArmB);
  const [lF, lFl] = fore(p.thighF, p.shinF);
  const [lB, lBl] = fore(p.thighB, p.shinB);
  const out = (v: number, side: 1 | -1) => side * Math.min(10, Math.abs(s(v)) * 0.12);
  return {
    torso: { rotation: 0, scale: (1 + (p.torsoScale - 1) * strength) * Math.max(0.8, Math.cos(deg(s(p.torso)))) },
    head: { rotation: 0, scale: 1 },
    upperArmF: { rotation: out(p.upperArmF, -1), scale: aF },
    foreArmF: { rotation: 0, scale: aFl },
    upperArmB: { rotation: out(p.upperArmB, 1), scale: aB },
    foreArmB: { rotation: 0, scale: aBl },
    thighF: { rotation: out(p.thighF, -1) * 0.5, scale: lF },
    shinF: { rotation: 0, scale: lFl },
    thighB: { rotation: out(p.thighB, 1) * 0.5, scale: lB },
    shinB: { rotation: 0, scale: lBl },
  };
}

export interface ApplyMotionResult {
  /** 동작이 들어간 프레임 번호들 */
  frames: number[];
}

/**
 * 리그에 동작을 넣습니다.
 *  - startFrame 부터 템플릿 길이만큼 프레임을 쓰며, 모자라면 새 프레임을 만듭니다.
 *  - 프레임 시간, 뼈 키프레임, (피격이면) 번쩍임 효과 키까지 넣습니다.
 */
export function applyMotion(p: Project, rigId: string, motion: MotionId, startFrame: number, opts: MotionOptions = DEFAULT_MOTION_OPTIONS): ApplyMotionResult | null {
  const rig = findRig(p, rigId);
  if (!rig?.root.rig) return null;
  const tpl = motionTemplate(motion);
  const n = tpl.poses.length;
  const facing = rig.root.rig.facing ?? 1;
  const view = rig.root.rig.view ?? 'side';
  const unit = Math.max(0.5, (rig.root.rig.height ?? 32) / 32);
  const strength = Math.max(0.2, Math.min(2, opts.strength));
  const speed = Math.max(0.25, Math.min(4, opts.speed));

  // 프레임 준비
  while (p.frames.length < startFrame + n) addFrame(p, p.frames.length);
  const frames = Array.from({ length: n }, (_, i) => startFrame + i);
  frames.forEach((fi, i) => {
    p.frames[fi].duration = Math.max(20, Math.round(tpl.durations[i] / speed));
  });

  const bones = rig.bones as Record<RigPartId, Bone>;
  const footBones = [bones.shinF, bones.shinB].filter(Boolean);
  const footY = (world: Map<string, Mat>) => Math.max(...footBones.map((b) => boneEndpoints(world.get(b.id) ?? IDENTITY, b).tail.y));
  // 기본 자세에서 발 높이 = 땅
  const ground = footY(poseWorld(p, 0, new Map(p.bones.map((b) => [b.id, { rotation: 0, x: 0, y: 0, scale: 1 }]))));

  // 1) 뼈 회전/길이 키 (+ 윗몸·팔 내리기는 정수 픽셀 이동)
  tpl.poses.forEach((ps, i) => {
    const fid = p.frames[frames[i]].id;
    const out = toBones(ps, facing, view, strength);
    out.torso.dy = Math.round(ps.bodyY * unit * strength);
    out.upperArmF.dy = Math.round(ps.armsY * unit * strength);
    out.upperArmB.dy = Math.round(ps.armsY * unit * strength);
    for (const part of Object.keys(out) as RigPartId[]) {
      const b = bones[part];
      if (!b) continue;
      const o = out[part];
      const t = o.dx || o.dy ? toBoneLocal(b, o.dx ?? 0, o.dy ?? 0) : { x: 0, y: 0 };
      setBoneKey(b, fid, { rotation: o.rotation, x: t.x, y: t.y, scale: o.scale }).ease = { ...LINEAR };
    }
    setBoneKey(rig.root, fid, { rotation: 0, x: 0, y: 0, scale: 1 }).ease = { ...LINEAR };
  });

  // 2) 땅 붙이기: 땅을 딛는 프레임은 낮은 쪽 발이 정확히 땅에 닿는 높이
  const aligned = tpl.poses.map((ps, i) => (ps.grounded || view === 'front' ? ground - footY(poseWorld(p, frames[i])) : null));
  //    공중 프레임은 앞뒤로 땅을 딛는 프레임 높이의 사이 + 템플릿의 띄우기
  const baseline = (i: number): number => {
    const own = aligned[i];
    if (own !== null) return own;
    let prev: number | null = null;
    let next: number | null = null;
    let dp = 0;
    let dn = 0;
    for (let k = 1; k < n && prev === null; k++) {
      const j = tpl.loop ? (i - k + n) % n : i - k;
      if (j < 0) break;
      prev = aligned[j];
      dp = k;
    }
    for (let k = 1; k < n && next === null; k++) {
      const j = tpl.loop ? (i + k) % n : i + k;
      if (j >= n) break;
      next = aligned[j];
      dn = k;
    }
    if (prev !== null && next !== null) return prev + ((next - prev) * dp) / (dp + dn);
    return prev ?? next ?? 0;
  };
  tpl.poses.forEach((ps, i) => {
    const fid = p.frames[frames[i]].id;
    const y = baseline(i) + ps.rootY * unit * strength;
    const x = view === 'side' ? ps.rootX * unit * strength * facing : 0;
    setBoneKey(rig.root, fid, { rotation: 0, x: Math.round(x), y: Math.round(y), scale: 1 }).ease = { ...LINEAR };
  });

  // 번쩍임 (피격): 리그 그룹 레이어에 "단색 덮기" 효과 + 효과 키
  if (tpl.flash) {
    const group = rigGroup(p, rigId);
    if (group) {
      let fx = group.effects.find((e) => e.type === 'colorOverlay' && e.params.color === '#ffffffff');
      if (!fx) {
        fx = { id: `fx-${rigId}-flash`, type: 'colorOverlay', enabled: true, params: { color: '#ffffffff', amount: 0 } } as Effect;
        group.effects = [...group.effects, fx];
      }
      const keys = fx.keys ?? [];
      // 동작 바로 앞 프레임은 0 (앞 동작이 하얗게 되지 않게)
      const before = startFrame > 0 ? p.frames[startFrame - 1].id : null;
      if (before && !keys.some((k) => k.frameId === before)) keys.push({ frameId: before, values: { amount: 0 }, ease: { kind: 'step' } });
      for (const f of tpl.flash) {
        const fid = p.frames[frames[f.frame]].id;
        const existing = keys.find((k) => k.frameId === fid);
        if (existing) existing.values.amount = f.amount;
        else keys.push({ frameId: fid, values: { amount: f.amount }, ease: { kind: 'step' } });
      }
      fx.keys = keys;
    }
  }
  return { frames };
}

/** 리그의 그룹 레이어 (부위 레이어들이 들어 있는 폴더) */
export function rigGroup(p: Project, rigId: string): Layer | undefined {
  const id = findRig(p, rigId)?.root.rig?.groupId;
  return id ? p.layers.find((l) => l.id === id) : undefined;
}

/** 리그 부위 레이어가 모든 프레임에 보이는지 (뼈 연결이 있어 hold 됨) */
export function rigLayersHold(p: Project, rigId: string): boolean {
  const rig = findRig(p, rigId);
  if (!rig) return false;
  const boneIds = new Set(Object.values(rig.bones).map((b) => b?.id));
  const parts = p.layers.filter((l) => l.bind?.boneId && boneIds.has(l.bind.boneId));
  return parts.length > 0 && parts.every((l) => layerHolds(l));
}
