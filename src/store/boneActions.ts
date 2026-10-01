/**
 * 뼈대(본) 관련 명령
 * ------------------------------------------------------------
 *  - 뼈 추가/삭제/이름/기본 자세 수정
 *  - 레이어를 뼈에 연결 (rigid: 통째로 / mesh: 휘어짐)
 *  - 프레임별 자세(키프레임) 기록
 *  - 레이어 자동 연결: 각 파츠를 가장 가까운 뼈에 연결
 */
import { apply } from '../core/affine';
import { contentBounds } from '../core/pixels';
import { findLayer, getCel, sourceFrameId } from '../core/project';
import {
  boneDescendants,
  createBone,
  findBone,
  removeBoneKey,
  restWorld,
  setBoneKey,
  type BonePose,
  type PoseOverrides,
} from '../core/skeleton';
import type { Bone, BoneBinding, Ease } from '../core/types';
import { tr } from '../i18n';
import { commitStructure, notify } from './actions';
import { getState as S, setState } from './editorStore';

export function selectBone(boneId: string | null): void {
  setState({ selectedBoneId: boneId });
}

export function addBoneAction(x: number, y: number, rotation: number, length: number, parentId: string | null): string | null {
  let id: string | null = null;
  commitStructure(tr('history.addBone'), (p) => {
    const bone = createBone(p, Math.round(x * 2) / 2, Math.round(y * 2) / 2, Math.round(rotation), Math.max(2, Math.round(length)), parentId, `${tr('bone.defaultName')} ${p.bones.length + 1}`);
    p.bones = [...p.bones, bone];
    id = bone.id;
  });
  if (id) setState({ selectedBoneId: id });
  return id;
}

export function deleteBoneAction(boneId = S().selectedBoneId): void {
  if (!boneId) return;
  const bone = findBone(S().project, boneId);
  commitStructure(tr('history.deleteBone'), (p) => {
    const ids = new Set([boneId, ...boneDescendants(p, boneId)]);
    if (!p.bones.some((b) => ids.has(b.id))) return false;
    p.bones = p.bones.filter((b) => !ids.has(b.id));
    for (const l of p.layers) if (l.bind?.boneId && ids.has(l.bind.boneId)) l.bind = null;
  });
  setState({ selectedBoneId: bone?.parentId ?? null });
}

export function updateBoneAction(boneId: string, patch: Partial<Pick<Bone, 'name' | 'x' | 'y' | 'rotation' | 'length' | 'color'>>): void {
  commitStructure(tr('history.editBone'), (p) => {
    const b = findBone(p, boneId);
    if (!b) return false;
    Object.assign(b, patch);
  });
}

/** 레이어를 뼈에 연결 (boneId=null 이면 연결 해제) */
export function bindLayerAction(layerId: string, boneId: string | null, mode: BoneBinding['mode'] = 'rigid', cols = 4, rows = 4): void {
  commitStructure(tr('history.bindLayer'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer) return false;
    layer.bind = boneId ? { boneId, mode, meshCols: cols, meshRows: rows } : null;
  });
}

export function updateBindingAction(layerId: string, patch: Partial<BoneBinding>): void {
  commitStructure(tr('history.bindLayer'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer?.bind) return false;
    Object.assign(layer.bind, patch);
  });
}

/** 각 그림 레이어를 내용의 중심에서 가장 가까운 뼈에 연결합니다. */
export function autoBindLayersAction(): void {
  const s = S();
  const p = s.project;
  if (p.bones.length === 0) {
    notify(tr('toast.noBones'), 'error');
    return;
  }
  let count = 0;
  commitStructure(tr('history.bindLayer'), (proj) => {
    for (const layer of proj.layers) {
      if (layer.kind !== 'pixel' || layer.guide) continue;
      const fid = sourceFrameId(proj, layer, s.currentFrame);
      const cel = fid ? getCel(proj, layer.id, fid) : undefined;
      const b = cel ? contentBounds(cel, proj.width, proj.height) : null;
      if (!b) continue;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      let best: Bone | null = null;
      let bestD = Infinity;
      for (const bone of proj.bones) {
        const tail = apply(restWorld(bone), bone.length, 0);
        const dx = tail.x - bone.x;
        const dy = tail.y - bone.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - bone.x) * dx + (cy - bone.y) * dy) / len2)) : 0;
        const d = Math.hypot(cx - (bone.x + t * dx), cy - (bone.y + t * dy));
        if (d < bestD) {
          bestD = d;
          best = bone;
        }
      }
      if (best) {
        layer.bind = { boneId: best.id, mode: layer.bind?.mode ?? 'rigid', meshCols: layer.bind?.meshCols ?? 4, meshRows: layer.bind?.meshRows ?? 4 };
        count++;
      }
    }
    return count > 0;
  });
  notify(tr('toast.autoBound', { count }), count > 0 ? 'success' : 'info');
}

/** 자세 미리보기 값들을 현재 프레임 키프레임으로 기록 (프로젝트 직접 수정 – 호출자가 기록 처리) */
export function writePoseKeys(overrides: PoseOverrides, boneIds?: string[]): void {
  const s = S();
  const p = s.project;
  const frameId = p.frames[s.currentFrame].id;
  for (const [id, pose] of overrides) {
    if (boneIds && !boneIds.includes(id)) continue;
    const b = findBone(p, id);
    if (b) setBoneKey(b, frameId, pose);
  }
}

export function setBonePoseAction(boneId: string, pose: BonePose): void {
  const s = S();
  commitStructure(tr('history.pose'), (p) => {
    const b = findBone(p, boneId);
    if (!b) return false;
    setBoneKey(b, p.frames[s.currentFrame].id, pose);
  });
}

/** 현재 프레임의 자세 키 삭제 (선택한 뼈 또는 전부) */
export function clearPoseKeyAction(all = false): void {
  const s = S();
  commitStructure(tr('history.pose'), (p) => {
    const frameId = p.frames[s.currentFrame].id;
    let changed = false;
    for (const b of p.bones) {
      if (!all && b.id !== s.selectedBoneId) continue;
      changed = removeBoneKey(b, frameId) || changed;
    }
    return changed;
  });
}

export function setBoneKeyEaseAction(boneId: string, frameId: string, ease: Ease): void {
  commitStructure(tr('history.keyframeEase'), (p) => {
    const key = findBone(p, boneId)?.keys.find((k) => k.frameId === frameId);
    if (!key) return false;
    key.ease = ease;
  });
}

export function clearBoneAnimationAction(): void {
  commitStructure(tr('history.clearAnimation'), (p) => {
    if (!p.bones.some((b) => b.keys.length > 0)) return false;
    for (const b of p.bones) b.keys = [];
  });
}
