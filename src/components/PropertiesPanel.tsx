/**
 * 레이어 속성 패널
 * ------------------------------------------------------------
 * 선택한 레이어의 이름, 블렌드 모드, 불투명도, 밑그림 설정 등을 바꿉니다.
 * 레이어 종류(그림/그룹/밑그림 이미지/파티클)에 따라 보이는 항목이 달라집니다.
 */
import { useReducer } from 'react';
import { BLEND_MODES } from '../core/blend';
import type { BlendMode } from '../core/types';
import { tr, useT } from '../i18n';
import {
  beginStructureEdit,
  bakeLayerAction,
  commitStructure,
  endStructureEdit,
  previewLayerOpacity,
  renameLayer,
  setLayerBlendMode,
  toggleGuide,
  type StructureEditToken,
} from '../store/actions';
import { useEditor } from '../store/editorStore';
import { ParticlePanel } from './ParticlePanel';
import { NumberField, Toggle } from './ui';

let opacityToken: StructureEditToken | null = null;

export function PropertiesPanel() {
  const t = useT();
  useEditor((s) => s.docVersion);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId));
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  if (!layer) return null;

  const updateRef = (patch: Partial<NonNullable<typeof layer.reference>>) =>
    commitStructure(tr('history.layerProps'), (p) => {
      const l = p.layers.find((x) => x.id === layer.id);
      if (!l?.reference) return false;
      Object.assign(l.reference, patch);
    });

  return (
    <div className="props-panel">
      <div className="prop-row">
        <span className="prop-label">{t('props.name')}</span>
        <input key={layer.id + layer.name} className="grow" defaultValue={layer.name} onBlur={(e) => renameLayer(layer.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="prop-row">
        <span className="prop-label">{t('props.kind')}</span>
        <span className="prop-value">
          {t(`kind.${layer.kind}`)}
          {layer.guide ? ` · ${t('kind.sketch')}` : ''}
        </span>
      </div>
      {layer.kind !== 'reference' && (
        <div className="prop-row">
          <span className="prop-label">{t('props.blend')}</span>
          <select className="grow" value={layer.blendMode} onChange={(e) => setLayerBlendMode(layer.id, e.target.value as BlendMode)}>
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`blend.${m}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      <label className="prop-row">
        <span className="prop-label">{t('layer.opacity')}</span>
        <input
          type="range"
          className="grow"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onPointerDown={() => {
            opacityToken = beginStructureEdit();
          }}
          onChange={(e) => {
            if (!opacityToken) opacityToken = beginStructureEdit();
            previewLayerOpacity(layer.id, Number(e.target.value) / 100);
            forceRender();
          }}
          onPointerUp={() => {
            if (opacityToken) endStructureEdit(tr('history.layerOpacity'), opacityToken);
            opacityToken = null;
          }}
          onKeyUp={() => {
            if (opacityToken) endStructureEdit(tr('history.layerOpacity'), opacityToken);
            opacityToken = null;
          }}
        />
        <span className="value">{Math.round(layer.opacity * 100)}%</span>
      </label>
      {layer.kind === 'pixel' && (
        <Toggle checked={layer.guide} onChange={() => toggleGuide(layer.id)} tip={t('props.sketchTip')}>
          {t('props.sketch')}
        </Toggle>
      )}

      {layer.kind === 'reference' && layer.reference && (
        <>
          <p className="note">💡 {t('props.referenceTip')}</p>
          <div className="prop-grid">
            <label>
              X <NumberField value={layer.reference.x} min={-4096} max={4096} width={56} onChange={(v) => updateRef({ x: v })} />
            </label>
            <label>
              Y <NumberField value={layer.reference.y} min={-4096} max={4096} width={56} onChange={(v) => updateRef({ y: v })} />
            </label>
            <label>
              {t('props.scale')}
              <NumberField value={Math.round(layer.reference.scale * 100)} min={1} max={2000} width={56} suffix="%" onChange={(v) => updateRef({ scale: v / 100 })} />
            </label>
          </div>
          <Toggle checked={layer.reference.front} onChange={(v) => updateRef({ front: v })}>
            {t('props.referenceFront')}
          </Toggle>
        </>
      )}

      {layer.kind === 'particles' && <ParticlePanel layer={layer} />}

      {(layer.kind === 'group' || layer.kind === 'particles' || layer.effects.length > 0 || layer.anim || layer.bind) && (
        <button type="button" className="btn small" onClick={() => bakeLayerAction(layer.id)} data-tip={t('props.bakeTip')}>
          {t('menu.bakeLayer')}
        </button>
      )}
    </div>
  );
}
