/**
 * 도우미 기능 명령: 파츠 분리 / VFX 넣기 / 외곽선·정리
 * ------------------------------------------------------------
 */
import { addOutline, fillPinholes, removeHalo, removeOrphans, smoothJaggies } from '../core/cleanup';
import { blendInto } from '../core/blend';
import { holeMask, inpaint } from '../core/inpaint';
import { cloneBuffer, createBuffer, isBufferEmpty } from '../core/pixels';
import { addLayer, addLayerAbove, celKey, createFrame, editableFrameId, ensureCel, findLayer, getCel } from '../core/project';
import { compositeFrame } from '../core/render';
import type { Color, Layer } from '../core/types';
import { analyzeFrames, drawVfx, suggestVfx, VFX_LENGTH, type VfxKind, type VfxSuggestion } from '../core/vfx';
import { tr } from '../i18n';
import { canEditCurrentLayer, commitStructure, currentLayer, notify, selectedFrames } from './actions';
import { getState as S, setState } from './editorStore';

/* ================================================================== */
/* 파츠 분리                                                             */
/* ================================================================== */

export interface SplitPlan {
  layerId: string;
  frameId: string;
  /** 잘라낼 영역 */
  partMask: Uint8Array;
  /** 잘라낸 뒤 남은 몸통 */
  body: Uint8ClampedArray;
  /** 잘라낸 파츠 */
  part: Uint8ClampedArray;
  /** 몸통에서 메워야 할 빈 곳 */
  hole: Uint8Array;
  holeCount: number;
}

/** 선택 영역으로 파츠 분리 계획 세우기 (아직 프로젝트는 바꾸지 않음) */
export function planSplit(): SplitPlan | null {
  const s = S();
  if (!s.selection) {
    notify(tr('toast.selectPartFirst'), 'error');
    return null;
  }
  if (!canEditCurrentLayer()) return null;
  const p = s.project;
  const layer = currentLayer() as Layer;
  const frameId = editableFrameId(p, layer, s.currentFrame);
  const cel = getCel(p, layer.id, frameId);
  if (!cel) {
    notify(tr('toast.nothingToSplit'), 'error');
    return null;
  }
  const mask = s.selection.mask;
  const body = cloneBuffer(cel);
  const part = createBuffer(p.width, p.height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const k = i * 4;
    part[k] = cel[k];
    part[k + 1] = cel[k + 1];
    part[k + 2] = cel[k + 2];
    part[k + 3] = cel[k + 3];
    body[k] = 0;
    body[k + 1] = 0;
    body[k + 2] = 0;
    body[k + 3] = 0;
  }
  if (isBufferEmpty(part)) {
    notify(tr('toast.nothingToSplit'), 'error');
    return null;
  }
  const hole = holeMask(body, p.width, p.height, mask);
  return { layerId: layer.id, frameId, partMask: mask, body, part, hole, holeCount: hole.reduce((a, b) => a + b, 0) };
}

/** 파츠 분리 창 열기: "선택 영역"이 있어야 합니다. 없으면 올가미 도구로 바꿔서 먼저 영역을 고르도록 안내합니다. */
export function openPartSplit(): void {
  if (!S().selection) {
    setState({ tool: 'lasso' });
    notify(tr('toast.selectPartFirst'), 'info');
    return;
  }
  setState({ dialog: { id: 'partFill' } });
}

/** 자동(알고리즘)으로 빈 곳 채우기 */
export function autoFillHole(plan: SplitPlan): Uint8ClampedArray {
  const p = S().project;
  return inpaint(plan.body, p.width, p.height, plan.hole);
}

/** 계획대로 분리 실행: 파츠는 새 레이어로, 몸통은 (채워진) 새 그림으로 */
export function applySplit(plan: SplitPlan, filledBody: Uint8ClampedArray | null, partName: string): void {
  commitStructure(tr('history.splitPart'), (p) => {
    const layer = findLayer(p, plan.layerId);
    if (!layer) return false;
    p.cels[celKey(layer.id, plan.frameId)] = filledBody ?? plan.body;
    const part = addLayerAbove(p, layer.id, partName || tr('layer.partName'));
    // 같은 뼈대 연결/움직임 설정을 이어받아 처음엔 그대로 보이게 합니다.
    part.bind = layer.bind ? { ...layer.bind } : null;
    part.anim = layer.anim ? structuredClone(layer.anim) : null;
    p.cels[celKey(part.id, plan.frameId)] = plan.part;
    return { layerId: part.id, selection: null };
  });
  notify(tr('toast.partSplit'), 'success');
}

/* ================================================================== */
/* VFX                                                                  */
/* ================================================================== */

/** 현재 애니메이션을 분석해서 VFX 넣을 곳을 추천 */
export function analyzeAnimation(scope: 'all' | 'current'): VfxSuggestion[] {
  const s = S();
  const p = s.project;
  const layer = currentLayer();
  const frames = p.frames.map((_, i) => {
    if (scope === 'current' && layer) {
      const out = createBuffer(p.width, p.height);
      const fid = editableFrameId(p, layer, i);
      const cel = getCel(p, layer.id, fid);
      if (cel) blendInto(out, cel, 1, 'normal');
      return out;
    }
    return compositeFrame(p, i);
  });
  return suggestVfx(analyzeFrames(frames, p.width, p.height));
}

export interface VfxPlacement {
  kind: VfxKind;
  frame: number;
  x: number;
  y: number;
  angle: number;
}

/** VFX 레이어에 이펙트를 그려 넣습니다. (없으면 맨 위에 새로 만듦) */
export function applyVfxAction(items: VfxPlacement[], extendFrames: boolean): void {
  if (items.length === 0) return;
  commitStructure(tr('history.addVfx'), (p) => {
    const vfxName = tr('layer.vfxName');
    let layer = p.layers.find((l) => l.kind === 'pixel' && l.name === vfxName && l.parentId === null);
    if (!layer) layer = addLayer(p, undefined, vfxName);
    for (const it of items) {
      for (let step = 0; step < VFX_LENGTH[it.kind]; step++) {
        const fi = it.frame + step;
        if (fi >= p.frames.length) {
          if (!extendFrames) break;
          p.frames.push(createFrame(p.frames[p.frames.length - 1].duration));
        }
        const key = celKey(layer.id, p.frames[fi].id);
        const base = p.cels[key] ? cloneBuffer(p.cels[key]) : createBuffer(p.width, p.height);
        blendInto(base, drawVfx(it.kind, step, p.width, p.height, { x: it.x, y: it.y }, it.angle), 1, 'normal');
        p.cels[key] = base;
      }
    }
    return { layerId: layer.id };
  });
  notify(tr('toast.vfxAdded', { count: items.length }), 'success');
}

/* ================================================================== */
/* 외곽선 / 정리                                                          */
/* ================================================================== */

export type CleanupOp =
  | { kind: 'outline'; color: Color; thickness: number; position: 'outside' | 'inside'; diagonal: boolean; auto: boolean }
  | { kind: 'orphans' }
  | { kind: 'pinholes' }
  | { kind: 'jaggies' }
  | { kind: 'halo'; color: Color; tolerance: number; passes: number };

export function runCleanup(buf: Uint8ClampedArray, w: number, h: number, op: CleanupOp): Uint8ClampedArray {
  switch (op.kind) {
    case 'outline':
      return addOutline(buf, w, h, op.color, op.thickness, op.position, op.diagonal, op.auto);
    case 'orphans':
      return removeOrphans(buf, w, h).buf;
    case 'pinholes':
      return fillPinholes(buf, w, h);
    case 'jaggies':
      return smoothJaggies(buf, w, h).buf;
    case 'halo':
      return removeHalo(buf, w, h, op.color, op.tolerance, op.passes).buf;
  }
}

/** 현재 레이어의 현재 프레임(또는 범위/전체 프레임)에 정리 작업 적용 */
export function applyCleanupAction(op: CleanupOp, scope: 'current' | 'range' | 'all'): void {
  if (!canEditCurrentLayer()) return;
  const s = S();
  const layerId = s.currentLayerId;
  const [ra, rb] = selectedFrames();
  commitStructure(tr('history.cleanup'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer) return false;
    const indices = scope === 'all' ? p.frames.map((_, i) => i) : scope === 'range' ? Array.from({ length: rb - ra + 1 }, (_, i) => ra + i) : [s.currentFrame];
    const memo = new Map<Uint8ClampedArray, Uint8ClampedArray>();
    let changed = false;
    for (const i of indices) {
      const fid = editableFrameId(p, layer, i);
      const key = celKey(layer.id, fid);
      const cel = p.cels[key];
      if (!cel) continue;
      let out = memo.get(cel);
      if (!out) {
        out = runCleanup(cel, p.width, p.height, op);
        memo.set(cel, out);
      }
      if (out !== cel) {
        p.cels[key] = out;
        changed = true;
      }
    }
    return changed;
  });
}

/** 현재 셀 미리보기용 (원본, 결과) */
export function cleanupPreview(op: CleanupOp): { before: Uint8ClampedArray; after: Uint8ClampedArray } | null {
  const s = S();
  const p = s.project;
  const layer = currentLayer();
  if (!layer || layer.kind !== 'pixel') return null;
  const cel = ensureCel(p, layer.id, editableFrameId(p, layer, s.currentFrame));
  return { before: cel, after: runCleanup(cel, p.width, p.height, op) };
}

/** 파티클 레이어 추가 */
export function addParticleLayerAction(preset: string, createSettings: (preset: string) => NonNullable<Layer['particles']>): void {
  commitStructure(tr('history.addParticles'), (p) => {
    const layer = addLayerAbove(p, S().currentLayerId, `${tr('layer.particlesName')}: ${tr(`particlePreset.${preset}` as 'particlePreset.rain')}`, 'particles');
    layer.particles = createSettings(preset);
    return { layerId: layer.id };
  });
  setState((st) => ({ collapsed: { ...st.collapsed, layer: false } }));
}
