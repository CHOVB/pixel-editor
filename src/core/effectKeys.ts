/**
 * 효과 값 키프레임 (Effect keyframes)
 * ------------------------------------------------------------
 * 효과의 숫자 설정값(밝기, 흔들림 세기, 테두리 두께…)을 프레임마다 다르게 할 수 있습니다.
 * 레이어 움직임 키프레임(keyframes.ts)과 같은 방식입니다.
 *
 *   1번 프레임 ◆ 하얗게 100%   →   4번 프레임 ◆ 하얗게 0%
 *   2·3번 프레임은 이징 곡선에 따라 중간값(예: 66%, 33%)이 자동으로 계산됩니다.
 *
 *  - 키는 프레임 "id" 에 붙어 있어서 프레임 순서를 바꿔도 따라갑니다.
 *  - 숫자가 아닌 설정(색, 선택 상자, 체크박스)은 키프레임 없이 모든 프레임에 같은 값입니다.
 *  - 키가 하나라도 있으면 그 효과는 "움직이는 효과"가 되어 그림 한 장만 있어도 모든 프레임에 이어집니다(hold).
 */
import { effectDef, type EffectParamDesc } from './effects';
import { ease, LINEAR } from './easing';
import type { Ease, Effect, EffectKey, EffectParamValue, Project } from './types';

/** 키프레임으로 움직일 수 있는 설정들 (숫자만) */
export function animatableParams(type: string): EffectParamDesc[] {
  return (effectDef(type)?.params ?? []).filter((d) => d.kind === 'number');
}

export function isAnimatableParam(type: string, key: string): boolean {
  return animatableParams(type).some((d) => d.key === key);
}

export function isEffectAnimated(fx: Effect): boolean {
  return !!fx.keys && fx.keys.length > 0;
}

export function effectKeyAt(fx: Effect, frameId: string): EffectKey | undefined {
  return fx.keys?.find((k) => k.frameId === frameId);
}

/** 프레임 순서대로 정렬된 키 (지워진 프레임의 키는 빼고) */
export function orderedEffectKeys(p: Project, fx: Effect): { index: number; key: EffectKey }[] {
  if (!fx.keys || fx.keys.length === 0) return [];
  const indexOf = new Map(p.frames.map((f, i) => [f.id, i]));
  return fx.keys
    .map((key) => ({ index: indexOf.get(key.frameId) ?? -1, key }))
    .filter((k) => k.index >= 0)
    .sort((a, b) => a.index - b.index);
}

/** 설정값을 슬라이더 칸(step)과 범위(min~max)에 맞춥니다. 예) 두께 1.6 → 2 */
function snap(desc: EffectParamDesc, v: number): number {
  let out = v;
  if (desc.step && desc.step > 0) out = Math.round(out / desc.step) * desc.step;
  if (desc.min !== undefined) out = Math.max(desc.min, out);
  if (desc.max !== undefined) out = Math.min(desc.max, out);
  // 0.1 단계 같은 소수 오차 정리 (0.30000000000000004 → 0.3)
  return Math.round(out * 1000) / 1000;
}

function staticNumber(fx: Effect, desc: EffectParamDesc): number {
  const v = fx.params[desc.key];
  if (typeof v === 'number') return v;
  return typeof desc.default === 'number' ? desc.default : 0;
}

/** 한 설정값을 frameIndex 프레임에서 계산 */
function evaluateParam(keys: { index: number; key: EffectKey }[], fx: Effect, desc: EffectParamDesc, frameIndex: number): number {
  const withValue = keys.filter((k) => typeof k.key.values[desc.key] === 'number');
  if (withValue.length === 0) return staticNumber(fx, desc);
  const first = withValue[0];
  const last = withValue[withValue.length - 1];
  if (frameIndex <= first.index) return snap(desc, first.key.values[desc.key]);
  if (frameIndex >= last.index) return snap(desc, last.key.values[desc.key]);
  let i = 0;
  while (i < withValue.length - 1 && withValue[i + 1].index <= frameIndex) i++;
  const a = withValue[i];
  const b = withValue[i + 1];
  const t = ease(a.key.ease, (frameIndex - a.index) / (b.index - a.index));
  const va = a.key.values[desc.key];
  const vb = b.key.values[desc.key];
  return snap(desc, va + (vb - va) * t);
}

/**
 * frameIndex 프레임에서 실제로 쓰는 설정값 (기본값 + 저장값 + 키프레임 계산값).
 * 키가 없는 효과는 params 를 그대로 돌려줍니다.
 */
export function effectParamsAt(p: Project, fx: Effect, frameIndex: number): Record<string, EffectParamValue> {
  const def = effectDef(fx.type);
  const params: Record<string, EffectParamValue> = {};
  for (const d of def?.params ?? []) params[d.key] = d.default;
  Object.assign(params, fx.params);
  if (!isEffectAnimated(fx)) return params;
  const keys = orderedEffectKeys(p, fx);
  if (keys.length === 0) return params;
  for (const d of animatableParams(fx.type)) params[d.key] = evaluateParam(keys, fx, d, frameIndex);
  return params;
}

/** 지금 프레임에서 보이는 숫자 설정값들 (키를 새로 찍을 때 씀) */
export function numericValuesAt(p: Project, fx: Effect, frameIndex: number): Record<string, number> {
  const all = effectParamsAt(p, fx, frameIndex);
  const out: Record<string, number> = {};
  for (const d of animatableParams(fx.type)) {
    const v = all[d.key];
    out[d.key] = typeof v === 'number' ? v : staticNumber(fx, d);
  }
  return out;
}

/** 키 추가/교체. 이미 있으면 주어진 값만 바꾸고 이징은 유지합니다. */
export function setEffectKey(fx: Effect, frameId: string, values: Record<string, number>, keyEase?: Ease): EffectKey {
  const keys = fx.keys ?? [];
  const existing = keys.find((k) => k.frameId === frameId);
  if (existing) {
    existing.values = { ...existing.values, ...values };
    if (keyEase) existing.ease = keyEase;
    fx.keys = keys;
    return existing;
  }
  const key: EffectKey = { frameId, values: { ...values }, ease: keyEase ?? { ...LINEAR } };
  fx.keys = [...keys, key];
  return key;
}

/**
 * 키 삭제. 마지막 키를 지우면 그 키의 값을 기본 설정(params)에 옮겨서
 * 화면이 갑자기 바뀌지 않게 합니다.
 */
export function removeEffectKey(fx: Effect, frameId: string): boolean {
  const keys = fx.keys ?? [];
  const removed = keys.find((k) => k.frameId === frameId);
  if (!removed) return false;
  fx.keys = keys.filter((k) => k !== removed);
  if (fx.keys.length === 0) {
    fx.params = { ...fx.params, ...removed.values };
    delete fx.keys;
  }
  return true;
}

/** 모든 키 지우기. 지금 프레임의 값이 그대로 남습니다. */
export function clearEffectKeys(p: Project, fx: Effect, frameIndex: number): boolean {
  if (!isEffectAnimated(fx)) return false;
  fx.params = { ...fx.params, ...numericValuesAt(p, fx, frameIndex) };
  delete fx.keys;
  return true;
}

/** 이전/다음 효과 키의 프레임 번호 (없으면 -1) */
export function neighborEffectKeyIndex(p: Project, fx: Effect, frameIndex: number, dir: 1 | -1): number {
  const idx = orderedEffectKeys(p, fx).map((k) => k.index);
  if (dir > 0) return idx.find((i) => i > frameIndex) ?? -1;
  return [...idx].reverse().find((i) => i < frameIndex) ?? -1;
}

/** 레이어의 켜진 효과 중 frameId 에 키가 있는지 (타임라인 ◆ 표시용) */
export function hasEffectKeyAt(effects: Effect[], frameId: string): boolean {
  return effects.some((fx) => fx.enabled && !!fx.keys?.some((k) => k.frameId === frameId));
}

/** 파일에서 읽은 키 목록을 안전한 모양으로 정리합니다. (깨진 값은 버림) */
export function sanitizeEffectKeys(raw: unknown): EffectKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: EffectKey[] = [];
  for (const k of raw as Partial<EffectKey>[]) {
    if (!k || typeof k.frameId !== 'string' || !k.values || typeof k.values !== 'object') continue;
    const values: Record<string, number> = {};
    for (const [name, v] of Object.entries(k.values)) if (typeof v === 'number' && Number.isFinite(v)) values[name] = v;
    out.push({ frameId: k.frameId, values, ease: k.ease && typeof k.ease.kind === 'string' ? k.ease : { ...LINEAR } });
  }
  return out.length > 0 ? out : undefined;
}
