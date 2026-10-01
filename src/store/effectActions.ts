/**
 * 효과(Effect) 관련 명령
 * ------------------------------------------------------------
 * 레이어에 효과를 추가/삭제/켜기·끄기/순서 변경/값 변경합니다.
 * 슬라이더처럼 연속으로 바뀌는 값은 "미리보기 → 손을 떼면 기록" 방식입니다.
 */
import { defaultParams, EFFECT_PRESETS } from '../core/effects';
import { findLayer, uid } from '../core/project';
import type { EffectParamValue } from '../core/types';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { beginStructureEdit, commitStructure, endStructureEdit, notify, type StructureEditToken } from './actions';
import { getState as S } from './editorStore';

export function addEffectAction(type: string, params?: Record<string, EffectParamValue>, layerId = S().currentLayerId): void {
  commitStructure(tr('history.addEffect'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer || layer.kind === 'reference') return false;
    layer.effects = [...layer.effects, { id: uid('fx'), type, enabled: true, params: { ...defaultParams(type), ...(params ?? {}) } }];
  });
}

export function applyEffectPreset(presetId: string): void {
  const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  addEffectAction(preset.type, preset.params);
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
    const fx = findLayer(p, S().currentLayerId)?.effects.find((e) => e.id === effectId);
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

export function setEffectParamAction(effectId: string, key: string, value: EffectParamValue): void {
  commitStructure(tr('history.editEffect'), (p) => {
    const fx = findLayer(p, S().currentLayerId)?.effects.find((e) => e.id === effectId);
    if (!fx || fx.params[key] === value) return false;
    fx.params = { ...fx.params, [key]: value };
  });
}

/* ---------------- 슬라이더용: 미리보기 후 기록 ---------------- */

let liveToken: StructureEditToken | null = null;

export function previewEffectParam(effectId: string, key: string, value: EffectParamValue): void {
  if (!liveToken) liveToken = beginStructureEdit();
  const fx = findLayer(S().project, S().currentLayerId)?.effects.find((e) => e.id === effectId);
  if (!fx) return;
  fx.params = { ...fx.params, [key]: value };
  requestRender();
}

export function commitEffectPreview(): void {
  if (liveToken) endStructureEdit(tr('history.editEffect'), liveToken);
  liveToken = null;
}
