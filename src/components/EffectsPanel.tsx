/**
 * 효과 패널 (비파괴 효과 스택)
 * ------------------------------------------------------------
 *  - 위쪽 "원클릭" 버튼: 흰 테두리, 머리카락 흔들림, 숨쉬기 같은 자주 쓰는 효과를 바로 추가
 *  - 아래 목록: 레이어에 쌓인 효과들 (위에서부터 차례로 적용)
 *     체크박스 = 켜기/끄기, ↑↓ = 순서, 휴지통 = 삭제
 *  - 각 효과의 설정 UI 는 core/effects.ts 의 설명(params)을 보고 자동으로 만들어집니다.
 */
import { colorToHex, hexToColor } from '../core/color';
import { EFFECT_PRESETS, EFFECTS, effectDef, type EffectGroup, type EffectParamDesc } from '../core/effects';
import type { Effect, EffectParamValue } from '../core/types';
import { useT, type TKey } from '../i18n';
import {
  addEffectAction,
  applyEffectPreset,
  commitEffectPreview,
  moveEffectAction,
  previewEffectParam,
  removeEffectAction,
  setEffectParamAction,
  toggleEffectAction,
} from '../store/effectActions';
import { getState, useEditor } from '../store/editorStore';
import { IconButton, NumberField, Toggle } from './ui';

const GROUPS: EffectGroup[] = ['outline', 'motion', 'color', 'pixel'];

function ParamControl({ fx, desc }: { fx: Effect; desc: EffectParamDesc }) {
  const t = useT();
  const value = fx.params[desc.key] ?? desc.default;
  const label = t(`fxParam.${desc.key}` as TKey);
  if (desc.kind === 'boolean') {
    return (
      <Toggle checked={!!value} onChange={(v) => setEffectParamAction(fx.id, desc.key, v)}>
        {label}
      </Toggle>
    );
  }
  if (desc.kind === 'select') {
    return (
      <label className="fx-param">
        <span>{label}</span>
        <select value={String(value)} onChange={(e) => setEffectParamAction(fx.id, desc.key, e.target.value)}>
          {(desc.options ?? []).map((o) => (
            <option key={o} value={o}>
              {t(`fxOpt.${o}` as TKey)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (desc.kind === 'color') {
    const hex = typeof value === 'string' ? value : '#000000ff';
    const c = hexToColor(hex) ?? 0x000000ff;
    const alpha = c & 255;
    return (
      <label className="fx-param">
        <span>{label}</span>
        <input
          type="color"
          value={colorToHex(c | 255).slice(0, 7)}
          onChange={(e) => {
            const rgb = hexToColor(e.target.value) ?? 0;
            setEffectParamAction(fx.id, desc.key, colorToHex(((rgb & 0xffffff00) | alpha) >>> 0, true));
          }}
        />
        <NumberField
          value={Math.round((alpha / 255) * 100)}
          min={0}
          max={100}
          width={40}
          suffix="%"
          onChange={(v) => setEffectParamAction(fx.id, desc.key, colorToHex(((c & 0xffffff00) | Math.round((v / 100) * 255)) >>> 0, true))}
        />
        <button
          type="button"
          className="chip"
          data-tip={t('fx.usePrimary')}
          onClick={() => setEffectParamAction(fx.id, desc.key, colorToHex(getState().primary, true))}
        >
          ●
        </button>
      </label>
    );
  }
  const num = typeof value === 'number' ? value : Number(desc.default);
  return (
    <label className="fx-param">
      <span>{label}</span>
      <input
        type="range"
        min={desc.min}
        max={desc.max}
        step={desc.step}
        value={num}
        onChange={(e) => previewEffectParam(fx.id, desc.key, Number(e.target.value))}
        onPointerUp={commitEffectPreview}
        onKeyUp={commitEffectPreview}
      />
      <NumberField value={num} min={desc.min ?? -9999} max={desc.max ?? 9999} step={desc.step} width={46} onChange={(v) => setEffectParamAction(fx.id, desc.key, v as EffectParamValue)} />
    </label>
  );
}

export function EffectsPanel() {
  const t = useT();
  useEditor((s) => s.docVersion);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId));
  if (!layer || layer.kind === 'reference') return <p className="note">{t('fx.noLayer')}</p>;

  return (
    <div className="effects-panel">
      <p className="note">💡 {t('fx.intro')}</p>
      {GROUPS.map((g) => (
        <div key={g} className="fx-presets">
          <span className="fx-group-label">{t(`fxGroup.${g}`)}</span>
          {EFFECT_PRESETS.filter((p) => p.group === g).map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => applyEffectPreset(p.id)} data-tip={t(`fxPresetTip.${p.id}` as TKey)}>
              {t(`fxPreset.${p.id}` as TKey)}
            </button>
          ))}
        </div>
      ))}

      <div className="prop-row">
        <select
          className="grow"
          value=""
          onChange={(e) => {
            if (e.target.value) addEffectAction(e.target.value);
          }}
          aria-label={t('fx.add')}
        >
          <option value="">＋ {t('fx.add')}</option>
          {EFFECTS.map((d) => (
            <option key={d.type} value={d.type}>
              {t(`effect.${d.type}` as TKey)}
            </option>
          ))}
        </select>
      </div>

      {layer.effects.length === 0 && <p className="note">{t('fx.empty')}</p>}
      {layer.effects.map((fx, i) => {
        const def = effectDef(fx.type);
        return (
          <div key={fx.id} className={`fx-card ${fx.enabled ? '' : 'disabled'}`}>
            <div className="fx-head">
              <input type="checkbox" checked={fx.enabled} onChange={() => toggleEffectAction(fx.id)} aria-label={t('fx.toggle')} />
              <strong>{t(`effect.${fx.type}` as TKey)}</strong>
              <span className="spacer" />
              <IconButton icon="up" label={t('fx.moveUp')} onClick={() => moveEffectAction(fx.id, -1)} disabled={i === 0} size={12} className="tiny" />
              <IconButton icon="down" label={t('fx.moveDown')} onClick={() => moveEffectAction(fx.id, 1)} disabled={i === layer.effects.length - 1} size={12} className="tiny" />
              <IconButton icon="trash" label={t('common.delete')} onClick={() => removeEffectAction(fx.id)} size={12} className="tiny" />
            </div>
            {fx.enabled && def && (
              <div className="fx-params">
                {def.params.map((d) => (
                  <ParamControl key={d.key} fx={fx} desc={d} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
