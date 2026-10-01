/**
 * 자동 애니메이션 명령 (마법사 화면 → 프로젝트)
 * ------------------------------------------------------------
 * 한 번의 "실행 취소" 로 되돌릴 수 있게 아래를 한꺼번에 합니다.
 *  1) 리그 만들기 (이미 있으면 그대로 사용)
 *  2) 점프처럼 캔버스 밖으로 나가는 동작이면 캔버스 넓히기
 *  3) 고른 동작들을 차례로 프레임에 넣고, 동작마다 태그(이름표) 붙이기
 */
import { createRig, findRig, type RigGroupId, type RigPartId } from '../core/autoRig';
import { neededRoom, previewMotion, type AutoAnimSetup } from '../core/autoAnimate';
import { applyMotion, motionTemplate, type MotionId, type MotionOptions } from '../core/motionTemplates';
import { addTag, editableFrameId, findLayer, resizeCanvas } from '../core/project';
import { tr, type TKey } from '../i18n';
import { commitStructure, notify } from './actions';
import { getState as S, setState } from './editorStore';

export interface AutoAnimSource {
  layerId: string;
  /** 그림이 실제로 들어 있는 프레임 번호 */
  frameIndex: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 지금 고른 레이어의 그림 (자동 애니메이션 재료). 그림이 없으면 null */
export function autoAnimSource(): AutoAnimSource | null {
  const s = S();
  const p = s.project;
  const layer = findLayer(p, s.currentLayerId);
  if (!layer || layer.kind !== 'pixel') return null;
  const fid = editableFrameId(p, layer, s.currentFrame);
  const pixels = p.cels[`${layer.id}|${fid}`];
  if (!pixels || !pixels.some((v, i) => i % 4 === 3 && v > 0)) return null;
  return { layerId: layer.id, frameIndex: p.frames.findIndex((f) => f.id === fid), pixels, width: p.width, height: p.height };
}

/** 이 프로젝트에 이미 만든 리그 */
export function existingRigId(): string | null {
  return findRig(S().project)?.rigId ?? null;
}

/** 번역된 부위 이름 */
export function rigNames(): Record<RigPartId | RigGroupId | 'group', string> {
  const keys: (RigPartId | RigGroupId | 'group')[] = [
    'group',
    'torso',
    'head',
    'upperArmF',
    'foreArmF',
    'upperArmB',
    'foreArmB',
    'thighF',
    'shinF',
    'thighB',
    'shinB',
    'armF',
    'armB',
    'legF',
    'legB',
  ];
  return Object.fromEntries(keys.map((k) => [k, tr(`rigPart.${k}` as TKey)])) as Record<RigPartId | RigGroupId | 'group', string>;
}

export interface AutoAnimateRequest {
  setup: AutoAnimSetup;
  motions: MotionId[];
  options: MotionOptions;
  /** 이미 있는 리그에 동작만 더하기 */
  reuseRig: boolean;
  /** 캔버스 밖으로 나가면 넓히기 */
  expandCanvas: boolean;
}

/** 고른 동작들에 필요한 여백 (캔버스 넓히기 계산용) */
export function roomFor(src: AutoAnimSource, setup: AutoAnimSetup, motions: MotionId[], options: MotionOptions) {
  const room = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const m of motions) {
    const prev = previewMotion(src.pixels, src.width, src.height, setup, m, options);
    if (!prev) continue;
    const r = neededRoom(prev, src.width, src.height);
    room.top = Math.max(room.top, r.top);
    room.bottom = Math.max(room.bottom, r.bottom);
    room.left = Math.max(room.left, r.left);
    room.right = Math.max(room.right, r.right);
  }
  return room;
}

export function autoAnimateAction(req: AutoAnimateRequest): boolean {
  const src = autoAnimSource();
  const reuse = req.reuseRig ? existingRigId() : null;
  if (!reuse && !src) {
    notify(tr('autoAnim.noDrawing'), 'error');
    return false;
  }
  if (req.motions.length === 0) return false;
  const room = req.expandCanvas && src && !reuse ? roomFor(src, req.setup, req.motions, req.options) : null;
  let firstFrame = 0;
  const ok = commitStructure(tr('history.autoAnimate'), (p) => {
    let rigId = reuse;
    if (!rigId && src) {
      const rig = createRig(p, src.layerId, src.frameIndex, req.setup.points, {
        ...req.setup.build,
        facing: req.setup.facing,
        view: req.setup.view,
        names: rigNames(),
      }, req.setup.labels);
      if (!rig) return false;
      rigId = rig.rigId;
    }
    if (!rigId) return false;
    // 캔버스 넓히기 (그림이 잘리지 않게)
    if (room && (room.top || room.bottom || room.left || room.right)) {
      const nw = p.width + room.left + room.right;
      const nh = p.height + room.top + room.bottom;
      resizeCanvas(p, nw, nh, room.left / Math.max(1, room.left + room.right), room.top / Math.max(1, room.top + room.bottom));
    }
    // 동작 넣기: 프레임이 하나뿐이면 그 프레임부터, 아니면 맨 뒤에 이어서
    let start = p.frames.length === 1 && !reuse ? 0 : p.frames.length;
    firstFrame = start;
    for (const m of req.motions) {
      const res = applyMotion(p, rigId, m, start, req.options);
      if (!res) continue;
      addTag(p, tr(`motion.${m}` as TKey), res.frames[0], res.frames[res.frames.length - 1]);
      start += motionTemplate(m).poses.length;
    }
    return { frame: firstFrame };
  });
  if (!ok) return false;
  setState({ currentFrame: firstFrame, playing: true });
  notify(tr('autoAnim.done', { count: req.motions.length }), 'success');
  return true;
}
