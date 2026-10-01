/**
 * 효과 패널 (비파괴 효과 스택)
 * ------------------------------------------------------------
 *  - 위쪽 "원클릭" 버튼: 흰 테두리, 머리카락 흔들림, 숨쉬기 같은 자주 쓰는 효과를 바로 추가
 *  - 아래 목록: 레이어에 쌓인 효과들 (위에서부터 차례로 적용)
 *     체크박스 = 켜기/끄기, ◆ = 효과 값 키프레임, ↑↓ = 순서, 휴지통 = 삭제
 *  - 각 효과의 설정 UI 는 core/effects.ts 의 설명(params)을 보고 자동으로 만들어집니다.
 *
 * 효과 값 키프레임
 *  - ◆ 를 누르면 지금 프레임에 키가 찍히고, 그 효과는 "움직이는 효과"가 됩니다.
 *  - 다른 프레임으로 가서 숫자 값을 바꾸면 그 프레임에 키가 자동으로 생겨요.
 *  - 키가 있는 숫자 설정은 이름 옆에 ◆ 가 붙고, 슬라이더는 "지금 프레임에서 계산된 값"을 보여줍니다.
 */
import { colorToHex, hexToColor } from '../core/color';
import { effectKeyAt, effectParamsAt, isEffectAnimated, orderedEffectKeys } from '../core/effectKeys';
import { EFFECT_PRESETS, EFFECTS, effectDef, type EffectGroup, type EffectParamDesc } from '../core/effects';
import type { EaseKind, Effect, EffectParamValue } from '../core/types';
import { useT, type TKey } from '../i18n';
import {
  addEffectAction,
  applyEffectPreset,
  clearEffectKeysAction,
  commitEffectPreview,
  gotoEffectKey,
  moveEffectAction,
  previewEffectParam,
  removeEffectAction,
  setEffectKeyEaseAction,
  setEffectParamAction,
  toggleEffectAction,
  toggleEffectKeyAction,
} from '../store/effectActions';
import { getState, useEditor } from '../store/editorStore';
import { IconButton, NumberField, Toggle } from './ui';

const GROUPS: EffectGroup[] = ['outline', 'motion', 'color', 'pixel'];
const EASES: EaseKind[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'back', 'bounce', 'elastic', 'step'];

interface ParamControlProps {
  fx: Effect;
  desc: EffectParamDesc;
  /** 지금 프레임에서 실제로 쓰는 값 (키프레임 계산 결과 포함) */
  value: EffectParamValue;
  /** 키프레임으로 움직이는 설정인지 */
  keyed: boolean;
}

function ParamControl({ fx, desc, value, keyed }: ParamControlProps) {
  const t = useT();
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
          width={52}
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
    <label className={`fx-param ${keyed ? 'keyed' : ''}`}>
      <span>
        {label}
        {keyed && (
          <span className="fx-key-mark" data-tip={t('fx.keyedTip')}>
            ◆
          </span>
        )}
      </span>
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
      <NumberField value={num} min={desc.min ?? -9999} max={desc.max ?? 9999} step={desc.step} width={56} onChange={(v) => setEffectParamAction(fx.id, desc.key, v as EffectParamValue)} />
    </label>
  );
}

/** 키프레임이 있는 효과의 키 막대: ◀ 이전 키 / 키 목록 / 다음 키 ▶ / 느낌(이징) / 모두 지우기 */
function EffectKeyBar({ fx }: { fx: Effect }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const currentFrame = useEditor((s) => s.currentFrame);
  const frame = project.frames[currentFrame];
  const keys = orderedEffectKeys(project, fx);
  const here = frame ? effectKeyAt(fx, frame.id) : undefined;
  const isLast = keys.length > 0 && keys[keys.length - 1].index <= currentFrame;
  return (
    <div className="fx-keys">
      <div className="fx-keys-row">
        <IconButton icon="prevKey" label={t('fx.prevKey')} onClick={() => gotoEffectKey(fx.id, -1)} size={14} className="tiny" />
        <span className="fx-key-list" data-tip={t('fx.keyListTip')}>
          {keys.map((k) => (
            <span key={k.key.frameId} className={k.index === currentFrame ? 'here' : ''}>
              ◆{k.index + 1}
            </span>
          ))}
        </span>
        <IconButton icon="nextKey" label={t('fx.nextKey')} onClick={() => gotoEffectKey(fx.id, 1)} size={14} className="tiny" />
        <span className="spacer" />
        <button type="button" className="chip" onClick={() => clearEffectKeysAction(fx.id)} data-tip={t('fx.clearKeysTip')}>
          {t('fx.clearKeys')}
        </button>
      </div>
      {here && frame && !isLast && (
        <label className="fx-param">
          <span>{t('fx.keyEase')}</span>
          <select value={here.ease.kind} onChange={(e) => setEffectKeyEaseAction(fx.id, frame.id, { kind: e.target.value as EaseKind })}>
            {EASES.map((k) => (
              <option key={k} value={k}>
                {t(`ease.${k}` as TKey)}
              </option>
            ))}
            {here.ease.kind === 'bezier' && <option value="bezier">{t('ease.bezier')}</option>}
          </select>
        </label>
      )}
      {!here && <p className="note tiny">{t('fx.autoKeyHint')}</p>}
    </div>
  );
}

export function EffectsPanel() {
  const t = useT();
  useEditor((s) => s.docVersion);
  const project = useEditor((s) => s.project);
  const currentFrame = useEditor((s) => s.currentFrame);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId));
  if (!layer || layer.kind === 'reference') return <p className="note">{t('fx.noLayer')}</p>;
  const frameId = project.frames[currentFrame]?.id;

  return (
    <div className="effects-panel">
      <p className="note">💡 {t('fx.intro')}</p>
      {GROUPS.map((g) => (
        <div key={g} className="fx-presets">
          <span className="fx-group-label">{t(`fxGroup.${g}`)}</span>
          {EFFECT_PRESETS.filter((p) => p.group === g).map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => applyEffectPreset(p.id)} data-tip={t(`fxPresetTip.${p.id}` as TKey)}>
              {t(`fxPreset.${p.id}` as TKey)}
              {p.keys && <span className="fx-key-mark">◆</span>}
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
        const animated = isEffectAnimated(fx);
        const keyHere = !!frameId && !!effectKeyAt(fx, frameId);
        const hasNumbers = !!def?.params.some((d) => d.kind === 'number');
        const values = effectParamsAt(project, fx, currentFrame);
        return (
          <div key={fx.id} className={`fx-card ${fx.enabled ? '' : 'disabled'} ${animated ? 'animated' : ''}`}>
            <div className="fx-head">
              <input type="checkbox" checked={fx.enabled} onChange={() => toggleEffectAction(fx.id)} aria-label={t('fx.toggle')} />
              <strong>{t(`effect.${fx.type}` as TKey)}</strong>
              <span className="spacer" />
              {hasNumbers && (
                <IconButton
                  icon="diamond"
                  label={keyHere ? t('fx.removeKey') : t('fx.addKey')}
                  onClick={() => toggleEffectKeyAction(fx.id)}
                  active={keyHere}
                  size={14}
                  className="tiny fx-key-btn"
                />
              )}
              <IconButton icon="up" label={t('fx.moveUp')} onClick={() => moveEffectAction(fx.id, -1)} disabled={i === 0} size={14} className="tiny" />
              <IconButton icon="down" label={t('fx.moveDown')} onClick={() => moveEffectAction(fx.id, 1)} disabled={i === layer.effects.length - 1} size={14} className="tiny" />
              <IconButton icon="trash" label={t('common.delete')} onClick={() => removeEffectAction(fx.id)} size={14} className="tiny" />
            </div>
            {fx.enabled && animated && <EffectKeyBar fx={fx} />}
            {fx.enabled && def && (
              <div className="fx-params">
                {def.params.map((d) => (
                  <ParamControl key={d.key} fx={fx} desc={d} value={values[d.key]} keyed={animated && d.kind === 'number' && !!fx.keys?.some((k) => typeof k.values[d.key] === 'number')} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
