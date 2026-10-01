/**
 * AI 다듬기 명령
 * ------------------------------------------------------------
 *  - 다듬을 프레임 고르기: 자동 애니메이션의 태그(걷기, 점프…) 또는 고른 프레임 범위
 *  - 원래 프레임 그리기: 리그 그룹만 (이전에 다듬느라 숨긴 것은 무시하고)
 *  - 적용: 다듬은 그림을 새 레이어로 넣고, 그 프레임에서만 리그를 숨김 (불투명도 효과 키)
 *    → 언제든 AI 레이어를 지우거나 효과를 끄면 원래대로. 실행 취소 한 번으로도 되돌림
 */
import { findRig } from '../core/autoRig';
import { addLayer, findLayer, layerIndex, uid } from '../core/project';
import { renderLayer } from '../core/render';
import { createBuffer, isBufferEmpty } from '../core/pixels';
import type { Effect, Layer, Project } from '../core/types';
import { tr } from '../i18n';
import { commitStructure, selectedFrames } from './actions';
import { getState as S, setState } from './editorStore';

export interface PolishTarget {
  rigId: string;
  groupId: string;
}

export interface PolishRange {
  id: string;
  label: string;
  from: number;
  to: number;
}

const HIDE_EFFECT = 'opacity';

/** 이 프로젝트의 자동 애니메이션 리그 */
export function polishTarget(): PolishTarget | null {
  const rig = findRig(S().project);
  const groupId = rig?.root.rig?.groupId;
  return rig && groupId && findLayer(S().project, groupId) ? { rigId: rig.rigId, groupId } : null;
}

/** 다듬을 수 있는 구간: 태그들 + 지금 고른 프레임 범위 */
export function polishRanges(): PolishRange[] {
  const p = S().project;
  const out: PolishRange[] = p.tags.map((t) => ({ id: t.id, label: `${t.name} (${t.from + 1}~${t.to + 1})`, from: t.from, to: t.to }));
  const [a, b] = selectedFrames();
  out.push({ id: 'selection', label: tr('polish.selection', { from: a + 1, to: b + 1 }), from: a, to: b });
  return out;
}

/** 기본으로 고를 구간: 지금 프레임이 들어 있는 태그 */
export function defaultPolishRange(ranges: PolishRange[]): PolishRange {
  const f = S().currentFrame;
  return ranges.find((r) => r.id !== 'selection' && f >= r.from && f <= r.to) ?? ranges[0];
}

/** 숨김 효과를 뺀 복사본 (원래 프레임을 그리기 위해) */
function withoutHiding(p: Project, groupId: string): { copy: Project; group: Layer } {
  const copy = structuredClone(p) as Project;
  const group = copy.layers.find((l) => l.id === groupId) as Layer;
  group.effects = group.effects.filter((e) => e.type !== HIDE_EFFECT);
  return { copy, group };
}

/** 리그 그룹만 그린 원래 프레임들 */
export function renderGuides(target: PolishTarget, frames: number[]): Uint8ClampedArray[] {
  const { copy, group } = withoutHiding(S().project, target.groupId);
  return frames.map((i) => renderLayer(copy, group, i)?.buf.slice() ?? createBuffer(copy.width, copy.height));
}

/** 기준 그림: 리그의 기본 자세 (뼈 키를 모두 뺀 모습 = 원래 그림) */
export function renderReference(target: PolishTarget): Uint8ClampedArray {
  const { copy, group } = withoutHiding(S().project, target.groupId);
  for (const b of copy.bones) if (b.rig?.rigId === target.rigId) b.keys = [];
  group.effects = group.effects.filter((e) => e.type === 'outline');
  return renderLayer(copy, group, 0)?.buf.slice() ?? createBuffer(copy.width, copy.height);
}

/** 그룹의 마지막 자손 레이어 위치 (그 바로 뒤에 넣으면 그룹 바로 위가 됨) */
function afterGroup(p: Project, groupId: string): number {
  let last = layerIndex(p, groupId);
  const inGroup = (l: Layer): boolean => {
    let cur: Layer | undefined = l;
    while (cur?.parentId) {
      if (cur.parentId === groupId) return true;
      cur = findLayer(p, cur.parentId);
    }
    return false;
  };
  p.layers.forEach((l, i) => {
    if (inGroup(l)) last = Math.max(last, i);
  });
  return last + 1;
}

/** 다듬은 프레임 적용 */
export function applyPolish(target: PolishTarget, frames: number[], results: Uint8ClampedArray[], name: string): boolean {
  let layerId = '';
  const ok = commitStructure(tr('history.polish'), (p) => {
    const group = findLayer(p, target.groupId);
    if (!group) return false;
    const layer = addLayer(p, afterGroup(p, group.id), name, 'pixel', group.parentId);
    layerId = layer.id;
    frames.forEach((fi, k) => {
      const buf = results[k];
      if (buf && !isBufferEmpty(buf)) p.cels[`${layer.id}|${p.frames[fi].id}`] = buf;
    });
    // 그 프레임에서만 리그 숨기기 (불투명도 0), 나머지는 100
    let fx = group.effects.find((e) => e.type === HIDE_EFFECT);
    if (!fx) {
      fx = { id: uid('fx'), type: HIDE_EFFECT, enabled: true, params: { amount: 100 } } as Effect;
      group.effects = [...group.effects, fx];
    }
    const keys = fx.keys ?? [];
    const setKey = (fi: number, amount: number, onlyIfMissing = false) => {
      if (fi < 0 || fi >= p.frames.length) return;
      const fid = p.frames[fi].id;
      const k = keys.find((x) => x.frameId === fid);
      if (k) {
        if (!onlyIfMissing) k.values.amount = amount;
      } else keys.push({ frameId: fid, values: { amount }, ease: { kind: 'step' } });
    };
    setKey(0, 100, true);
    setKey(frames[0] - 1, 100, true);
    setKey(frames[frames.length - 1] + 1, 100, true);
    for (const fi of frames) setKey(fi, 0);
    fx.keys = keys;
    return { layerId: layer.id, frame: frames[0] };
  });
  if (ok) setState({ currentLayerId: layerId, playing: true });
  return ok;
}
