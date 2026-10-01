/**
 * 효과(Effect) 관련 명령
 * ------------------------------------------------------------
 * 레이어에 효과를 추가/삭제/켜기·끄기/순서 변경/값 변경합니다.
 * 슬라이더처럼 연속으로 바뀌는 값은 "미리보기 → 손을 떼면 기록" 방식입니다.
 *
 * 효과 값 키프레임
 *  - ◆ 버튼: 지금 프레임에 효과 키를 찍거나 지웁니다.
 *  - 키가 하나라도 있는 효과는 숫자 값을 바꾸면 "지금 프레임의 키"가 자동으로 생기거나 고쳐집니다.
 *    (애프터 이펙트의 "자동 키" 와 같은 방식이라, 프레임을 옮겨 가며 값만 바꾸면 애니메이션이 됩니다)
 */
import {
  clearEffectKeys,
  effectKeyAt,
  isAnimatableParam,
  isEffectAnimated,
  neighborEffectKeyIndex,
  numericValuesAt,
  removeEffectKey,
  setEffectKey,
} from '../core/effectKeys';
import { defaultParams, EFFECT_PRESETS } from '../core/effects';
import { LINEAR } from '../core/easing';
import { findLayer, uid } from '../core/project';
import type { Ease, Effect, EffectParamValue, Project } from '../core/types';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { beginStructureEdit, commitStructure, endStructureEdit, gotoFrame, notify, type StructureEditToken } from './actions';
import { getState as S } from './editorStore';

function findEffect(p: Project, effectId: string, layerId = S().currentLayerId): Effect | undefined {
  return findLayer(p, layerId)?.effects.find((e) => e.id === effectId);
}

function currentFrameId(p: Project): string | undefined {
  return p.frames[S().currentFrame]?.id;
}

export function addEffectAction(type: string, params?: Record<string, EffectParamValue>, layerId = S().currentLayerId): string | null {
  let id: string | null = null;
  commitStructure(tr('history.addEffect'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer || layer.kind === 'reference') return false;
    id = uid('fx');
    layer.effects = [...layer.effects, { id, type, enabled: true, params: { ...defaultParams(type), ...(params ?? {}) } }];
  });
  return id;
}

export function applyEffectPreset(presetId: string): void {
  const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  if (preset.keys) {
    // 키프레임이 들어 있는 프리셋: 지금 프레임부터 시작해서 키를 찍어 줍니다.
    commitStructure(tr('history.addEffect'), (p) => {
      const layer = findLayer(p, S().currentLayerId);
      if (!layer || layer.kind === 'reference') return false;
      const fx: Effect = { id: uid('fx'), type: preset.type, enabled: true, params: { ...defaultParams(preset.type), ...preset.params } };
      const start = S().currentFrame;
      for (const k of preset.keys!) {
        if (start + k.offset < 0) continue;
        const fi = Math.min(p.frames.length - 1, start + k.offset);
        setEffectKey(fx, p.frames[fi].id, k.values, k.ease ? { kind: k.ease } : { ...LINEAR });
      }
      layer.effects = [...layer.effects, fx];
    });
  } else {
    addEffectAction(preset.type, preset.params);
  }
  notify(tr('toast.effectAdded', { name: tr(`fxPreset.${presetId}` as 'fxPreset.whiteBorder') }), 'success');
}

export function removeEffectAction(effectId: string): void {
  commitStructure(tr('history.removeEffect'), (p) => {
    const layer = findLayer(p, S().currentLayerId);
    if (!layer) return false;
    const before = layer.effects.length;
    layer.effects = layer.effects.filter((e) => e.id !== effectId);
    return layer.effects.length !== before;
  });
}

export function toggleEffectAction(effectId: string): void {
  commitStructure(tr('history.editEffect'), (p) => {
    const fx = findEffect(p, effectId);
    if (!fx) return false;
    fx.enabled = !fx.enabled;
  });
}

export function moveEffectAction(effectId: string, delta: -1 | 1): void {
  commitStructure(tr('history.editEffect'), (p) => {
    const layer = findLayer(p, S().currentLayerId);
    if (!layer) return false;
    const i = layer.effects.findIndex((e) => e.id === effectId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= layer.effects.length) return false;
    const list = layer.effects.slice();
    [list[i], list[j]] = [list[j], list[i]];
    layer.effects = list;
  });
}

/**
 * 값 하나 바꾸기 (기록 없이). 바뀌었으면 true.
 * 키프레임이 있는 효과의 숫자 값이면 → 지금 프레임의 키에 기록 (없으면 새 키)
 */
function writeParam(p: Project, fx: Effect, key: string, value: EffectParamValue): boolean {
  if (isEffectAnimated(fx) && typeof value === 'number' && isAnimatableParam(fx.type, key)) {
    const frameId = currentFrameId(p);
    if (!frameId) return false;
    const existing = effectKeyAt(fx, frameId);
    if (existing && existing.values[key] === value) return false;
    const values = existing ? { [key]: value } : { ...numericValuesAt(p, fx, S().currentFrame), [key]: value };
    setEffectKey(fx, frameId, values);
    return true;
  }
  if (fx.params[key] === value) return false;
  fx.params = { ...fx.params, [key]: value };
  return true;
}

export function setEffectParamAction(effectId: string, key: string, value: EffectParamValue): void {
  commitStructure(tr('history.editEffect'), (p) => {
    const fx = findEffect(p, effectId);
    if (!fx) return false;
    return writeParam(p, fx, key, value);
  });
}

/* ---------------- 슬라이더용: 미리보기 후 기록 ---------------- */

let liveToken: StructureEditToken | null = null;

export function previewEffectParam(effectId: string, key: string, value: EffectParamValue): void {
  if (!liveToken) liveToken = beginStructureEdit();
  const p = S().project;
  const fx = findEffect(p, effectId);
  if (!fx) return;
  writeParam(p, fx, key, value);
  requestRender();
}

export function commitEffectPreview(): void {
  if (liveToken) endStructureEdit(tr('history.editEffect'), liveToken);
  liveToken = null;
}

/* ---------------- 효과 값 키프레임 ---------------- */

/** 지금 프레임에 효과 키 찍기 / 이미 있으면 지우기 */
export function toggleEffectKeyAction(effectId: string): void {
  const p = S().project;
  const fx = findEffect(p, effectId);
  const frameId = currentFrameId(p);
  if (!fx || !frameId) return;
  const has = !!effectKeyAt(fx, frameId);
  const first = !has && !isEffectAnimated(fx);
  commitStructure(tr(has ? 'history.removeEffectKey' : 'history.addEffectKey'), (proj) => {
    const target = findEffect(proj, effectId);
    if (!target) return false;
    if (has) return removeEffectKey(target, frameId);
    setEffectKey(target, frameId, numericValuesAt(proj, target, S().currentFrame));
  });
  if (first) notify(tr('toast.effectKeyFirst'), 'info');
}

export function setEffectKeyEaseAction(effectId: string, frameId: string, keyEase: Ease): void {
  commitStructure(tr('history.editEffect'), (p) => {
    const key = findEffect(p, effectId) && effectKeyAt(findEffect(p, effectId)!, frameId);
    if (!key) return false;
    key.ease = keyEase;
  });
}

/** 모든 효과 키 지우기 (지금 프레임의 값이 그대로 남아요) */
export function clearEffectKeysAction(effectId: string): void {
  commitStructure(tr('history.clearEffectKeys'), (p) => {
    const fx = findEffect(p, effectId);
    if (!fx) return false;
    return clearEffectKeys(p, fx, S().currentFrame);
  });
}

/** 이전/다음 효과 키 프레임으로 이동 */
export function gotoEffectKey(effectId: string, dir: 1 | -1): void {
  const p = S().project;
  const fx = findEffect(p, effectId);
  if (!fx) return;
  const i = neighborEffectKeyIndex(p, fx, S().currentFrame, dir);
  if (i >= 0) gotoFrame(i);
}
