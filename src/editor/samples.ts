/**
 * 예제 프로젝트
 * ------------------------------------------------------------
 * 처음 쓰는 사람이 "이 기능은 이렇게 쓰는구나"를 바로 볼 수 있도록
 * 코드로 그린 작은 예제들을 만듭니다. (그림은 아래 글자 지도로 그립니다)
 *
 *  - slime: 키프레임 + 이징으로 통통 튀는 슬라임 (늘어나고 찌그러짐)
 *  - tree:  바람에 흔들리는 나무(흔들림 효과) + 떨어지는 낙엽(파티클)
 *  - walk:  걷기 핵심 자세 2장 → "자동 중간 프레임" 연습용
 *  - arm:   뼈대로 팔 흔들기 (뼈 키프레임)
 *  - hero:  그림 한 장짜리 모험가 → "자동 애니메이션" 마법사로 걷기·점프 등을 바로 만들어 보기
 */
import { hexToColor } from '../core/color';
import { createTrack, setKey } from '../core/keyframes';
import { DEFAULT_PALETTE_ID, getPreset, presetToColors } from '../core/palettes';
import { createParticleSettings } from '../core/particles';
import { setPixel } from '../core/pixels';
import { addFrame, addLayer, createProject, ensureCel, linkCels, uid } from '../core/project';
import { createBone, setBoneKey } from '../core/skeleton';
import type { Ease, Project, TransformValues } from '../core/types';
import { tr } from '../i18n';
import { replaceProject } from '../store/actions';
import { setState } from '../store/editorStore';
import { confirmDiscard } from './fileActions';
import { drawHero } from './sampleHero';

export type SampleId = 'slime' | 'tree' | 'walk' | 'arm' | 'hero';
export const SAMPLE_IDS: SampleId[] = ['hero', 'slime', 'tree', 'walk', 'arm'];
/** 움직임 없이 그림 한 장만 있는 예제 (자동 애니메이션 연습용) */
export const STILL_SAMPLES: SampleId[] = ['hero'];

/** 글자 지도로 그리기: 각 글자 → 색 (공백/점 = 투명) */
function drawArt(p: Project, layerId: string, frameId: string, art: string[], colors: Record<string, string>, ox: number, oy: number): void {
  const cel = ensureCel(p, layerId, frameId);
  art.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const hex = colors[ch];
      if (!hex) return;
      const c = hexToColor(hex);
      const px = ox + x;
      const py = oy + y;
      if (c !== null && px >= 0 && py >= 0 && px < p.width && py < p.height) setPixel(cel, p.width, px, py, c);
    });
  });
}

function values(v: Partial<TransformValues>): TransformValues {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ...v };
}

/** 움직이지 않는 레이어는 모든 프레임에 같은 그림을 링크해서 보이게 합니다. */
function linkAllFrames(p: Project, layerId: string): void {
  linkCels(
    p,
    layerId,
    0,
    p.frames.map((_, i) => i).slice(1),
  );
}

const EASE_OUT: Ease = { kind: 'easeOut' };
const EASE_IN: Ease = { kind: 'easeIn' };
const EASE_IN_OUT: Ease = { kind: 'easeInOut' };

function base(width: number, height: number, frames: number, duration: number, name: string): Project {
  // 예제는 기본 팔레트(Endesga 32)로 시작합니다. (예제 그림의 색도 이 팔레트에서 골랐어요)
  const p = createProject(width, height, { name, layerName: tr('layer.defaultName'), palette: presetToColors(getPreset(DEFAULT_PALETTE_ID)) });
  p.frames[0].duration = duration;
  for (let i = 1; i < frames; i++) addFrame(p, i, duration);
  return p;
}

/* ------------------------------------------------------------------ */

const SLIME = [
  '.....kkkkkk.....',
  '...kkggggggkk...',
  '..kggggggggwwk..',
  '.kggggggggggwwk.',
  '.kgggggggggggwk.',
  'kggggkggggkgggk.',
  'kggggkggggkggggk',
  'kgggggggggggggdk',
  'kggggggrrgggggdk',
  'kgggggggggggdddk',
  '.kdddddddddddddk',
  '..kkkkkkkkkkkkk.',
];

function slime(): Project {
  const p = base(32, 32, 8, 90, tr('sample.slime'));
  const body = p.layers[0];
  body.name = tr('sample.layer.slime');
  drawArt(p, body.id, p.frames[0].id, SLIME, { k: '#181425', g: '#63c74d', d: '#3e8948', w: '#feffff', r: '#e43b44' }, 8, 16);
  // 바닥 그림자 (밑에 따로 둔 레이어)
  const shadow = addLayer(p, 0, tr('sample.layer.shadow'));
  const sc = ensureCel(p, shadow.id, p.frames[0].id);
  const dark = hexToColor('#18142580') as number;
  for (let x = 10; x <= 22; x++) setPixel(sc, 32, x, 28, dark);
  for (let x = 12; x <= 20; x++) setPixel(sc, 32, x, 29, dark);
  // 슬라임: 찌그러짐 → 늘어나며 점프 → 꼭대기 → 떨어짐 (발밑을 중심으로)
  body.anim = createTrack(16, 27);
  const f = p.frames;
  setKey(body.anim, f[0].id, values({ scaleX: 1.2, scaleY: 0.8 }), EASE_OUT);
  setKey(body.anim, f[2].id, values({ y: -6, scaleX: 0.9, scaleY: 1.15 }), EASE_OUT);
  setKey(body.anim, f[4].id, values({ y: -10 }), EASE_IN);
  setKey(body.anim, f[6].id, values({ y: -4, scaleX: 0.92, scaleY: 1.1 }), EASE_IN);
  setKey(body.anim, f[7].id, values({ y: 0, scaleX: 1.1, scaleY: 0.9 }), EASE_OUT);
  // 그림자는 높이 뛸수록 작아짐
  shadow.anim = createTrack(16, 28);
  setKey(shadow.anim, f[0].id, values({ scaleX: 1.1 }), EASE_OUT);
  setKey(shadow.anim, f[4].id, values({ scaleX: 0.6, opacity: 0.6 }), EASE_IN);
  setKey(shadow.anim, f[7].id, values({ scaleX: 1.05 }), EASE_OUT);
  return p;
}

/* ------------------------------------------------------------------ */

const TREE_TOP = [
  '.......kkkkkk.......',
  '.....kkggggggkk.....',
  '....kgggglgggggk....',
  '...kgggllggggggdk...',
  '..kggggggggggggddk..',
  '..kgglgggggggggddk..',
  '.kggllggggggggggddk.',
  '.kgggggggggglggdddk.',
  '.kggggggggggllgdddk.',
  '..kggggggggggggddk..',
  '..kdggggggggggdddk..',
  '...kddddggggdddddk..',
  '....kkddddddddkkk...',
  '......kkkkkkkk......',
];

const TREE_TRUNK = ['..kbbk..', '..kbbk..', '..kbtk..', '..kbtk..', '.kbbtk..', 'kbbbttk.'];

function tree(): Project {
  const p = base(32, 32, 8, 120, tr('sample.tree'));
  const ground = p.layers[0];
  ground.name = tr('sample.layer.ground');
  const gc = ensureCel(p, ground.id, p.frames[0].id);
  const g1 = hexToColor('#265c42') as number;
  const g2 = hexToColor('#3e8948') as number;
  for (let x = 0; x < 32; x++) {
    setPixel(gc, 32, x, 29, g2);
    setPixel(gc, 32, x, 30, g1);
    setPixel(gc, 32, x, 31, g1);
  }
  linkAllFrames(p, ground.id);
  const trunk = addLayer(p, undefined, tr('sample.layer.trunk'));
  drawArt(p, trunk.id, p.frames[0].id, TREE_TRUNK, { k: '#181425', b: '#733e39', t: '#3e2731' }, 12, 23);
  linkAllFrames(p, trunk.id);
  const leaves = addLayer(p, undefined, tr('sample.layer.leaves'));
  drawArt(p, leaves.id, p.frames[0].id, TREE_TOP, { k: '#181425', g: '#63c74d', l: '#c0cbdc', d: '#3e8948' }, 6, 10);
  // 나뭇잎: 아래(줄기 쪽)는 고정, 위로 갈수록 바람에 흔들림
  leaves.effects.push({
    id: uid('fx'),
    type: 'sway',
    enabled: true,
    params: { anchor: 'bottom', amplitude: 1, wavelength: 24, speed: 1, curve: 1.3, loopFrames: 8 },
  });
  // 바람에 날리는 낙엽
  const fall = addLayer(p, undefined, `${tr('layer.particlesName')}: ${tr('particlePreset.leaves')}`, 'particles');
  fall.particles = { ...createParticleSettings('leaves', p), rate: 0.4 };
  return p;
}

/* ------------------------------------------------------------------ */

const WALK_HEAD = ['..kkkk..', '.kssssk.', 'kssssssk', 'ksekseks', 'kssssssk', '.kssssk.', '..kkkk..'];
const WALK_BODY = ['.kbbbbk.', 'kbbbbbbk', 'kbbbbbbk', 'kbbbbbbk', '.kbbbbk.'];
const LEGS_IDLE = ['.kp..pk.', '.kp..pk.', '.kp..pk.', '.kkk.kkk'];
const LEGS_STEP = ['.kp..pk.', 'kp....pk', 'kp....pk', 'kkk...kkk'];

function walk(): Project {
  const p = base(24, 24, 2, 120, tr('sample.walk'));
  const l = p.layers[0];
  l.name = tr('sample.layer.character');
  const colors = { k: '#181425', s: '#e8b796', e: '#181425', b: '#0099db', p: '#3a4466' };
  for (let i = 0; i < 2; i++) {
    const fid = p.frames[i].id;
    drawArt(p, l.id, fid, WALK_HEAD, colors, 8, 3);
    drawArt(p, l.id, fid, WALK_BODY, colors, 8, 10);
    drawArt(p, l.id, fid, i === 0 ? LEGS_IDLE : LEGS_STEP, colors, 8, 15);
  }
  return p;
}

/* ------------------------------------------------------------------ */

function arm(): Project {
  const p = base(32, 32, 8, 100, tr('sample.arm'));
  const body = p.layers[0];
  body.name = tr('sample.layer.body');
  const colors = { k: '#181425', s: '#e8b796', e: '#181425', b: '#b55088', p: '#3a4466' };
  const f0 = p.frames[0].id;
  drawArt(p, body.id, f0, WALK_HEAD, colors, 12, 4);
  drawArt(p, body.id, f0, ['.kbbbbk.', 'kbbbbbbk', 'kbbbbbbk', 'kbbbbbbk', 'kbbbbbbk', '.kbbbbk.'], colors, 12, 11);
  drawArt(p, body.id, f0, LEGS_IDLE, colors, 12, 17);
  linkAllFrames(p, body.id);
  // 오른팔 (따로 떼어 둔 파츠 레이어 → 뼈에 연결)
  const armLayer = addLayer(p, undefined, tr('sample.layer.arm'));
  drawArt(p, armLayer.id, f0, ['kbk', 'kbk', 'kbk', 'kbk', 'ksk', '.k.'], colors, 19, 12);
  // 뼈: 어깨(20,12)에서 아래로 6px
  const bone = createBone(p, 20, 12, 90, 6, null, tr('sample.layer.arm'));
  p.bones.push(bone);
  armLayer.bind = { boneId: bone.id, mode: 'rigid', meshCols: 4, meshRows: 4 };
  const f = p.frames;
  const k0 = setBoneKey(bone, f[0].id, { rotation: 0, x: 0, y: 0, scale: 1 });
  k0.ease = { ...EASE_IN_OUT };
  const k1 = setBoneKey(bone, f[3].id, { rotation: -150, x: 0, y: 0, scale: 1 });
  k1.ease = { ...EASE_IN_OUT };
  const k2 = setBoneKey(bone, f[5].id, { rotation: -110, x: 0, y: 0, scale: 1 });
  k2.ease = { ...EASE_IN_OUT };
  setBoneKey(bone, f[7].id, { rotation: -150, x: 0, y: 0, scale: 1 });
  return p;
}

/* ------------------------------------------------------------------ */

/** 모험가 한 장 (64×64, 점프할 공간을 위쪽에 남겨 둠) */
export const HERO_OFFSET = { x: 8, y: 18 };

function hero(): Project {
  const p = base(64, 64, 1, 110, tr('sample.hero'));
  const l = p.layers[0];
  l.name = tr('sample.layer.character');
  p.cels[`${l.id}|${p.frames[0].id}`] = drawHero(64, 64, HERO_OFFSET.x, HERO_OFFSET.y).pixels;
  return p;
}

/** 예제 모험가의 자동 리깅 점 */
export function heroRigPoints() {
  return drawHero(64, 64, HERO_OFFSET.x, HERO_OFFSET.y).points;
}

const BUILDERS: Record<SampleId, () => Project> = { slime, tree, walk, arm, hero };

export function buildSample(id: SampleId): Project {
  return BUILDERS[id]();
}

/** 예제 열기 (저장 안 된 작업이 있으면 먼저 물어봄) */
export function openSample(id: SampleId, after?: () => void): void {
  confirmDiscard(() => {
    replaceProject(buildSample(id), null);
    setState({ playing: id !== 'walk' && !STILL_SAMPLES.includes(id) });
    after?.();
    // 모험가: 바로 자동 애니메이션 마법사를 열어 줌 (점은 미리 찍어 둠)
    if (id === 'hero') setState({ dialog: { id: 'autoAnimate', payload: { points: heroRigPoints() } } });
  });
}
