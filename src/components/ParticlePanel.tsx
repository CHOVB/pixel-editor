/**
 * 파티클 레이어 설정 (비/눈/불꽃/연기/반짝임/낙엽/먼지/마법)
 * ------------------------------------------------------------
 * 프리셋을 고르고 위치/양/속도만 조절하면 자연 효과가 완성됩니다.
 */
import { PARTICLE_PRESET_IDS, PARTICLE_PRESETS } from '../core/particles';
import type { Layer, ParticleSettings } from '../core/types';
import { tr, useT } from '../i18n';
import { commitStructure } from '../store/actions';
import { NumberField, Toggle } from './ui';

function update(layerId: string, patch: Partial<ParticleSettings>): void {
  commitStructure(tr('history.particles'), (p) => {
    const l = p.layers.find((x) => x.id === layerId);
    if (!l?.particles) return false;
    Object.assign(l.particles, patch);
  });
}

export function ParticlePanel({ layer }: { layer: Layer }) {
  const t = useT();
  const s = layer.particles;
  if (!s) return null;
  const num = (key: keyof ParticleSettings, min: number, max: number, scale = 1, suffix?: string) => (
    <label>
      {t(`particle.${key}` as 'particle.rate')}
      <NumberField
        value={Math.round((s[key] as number) * scale * 100) / 100}
        min={min}
        max={max}
        step={1 / scale}
        width={52}
        suffix={suffix}
        onChange={(v) => update(layer.id, { [key]: v / scale } as Partial<ParticleSettings>)}
      />
    </label>
  );
  return (
    <div className="particle-panel">
      <div className="prop-row">
        <span className="prop-label">{t('particle.preset')}</span>
        <select
          className="grow"
          value={s.preset}
          onChange={(e) => {
            const preset = e.target.value;
            update(layer.id, { preset, ...structuredClone(PARTICLE_PRESETS[preset]) });
          }}
        >
          {PARTICLE_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`particlePreset.${id}` as 'particlePreset.rain')}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-grid">
        {num('x', -512, 4096)}
        {num('y', -512, 4096)}
        {num('areaW', 0, 4096)}
        {num('areaH', 0, 4096)}
        {num('rate', 0, 50, 10)}
        {num('burst', 0, 500)}
        {num('lifetime', 1, 600)}
        {num('speed', 0, 20, 10)}
        {num('angle', -360, 360, 1, '°')}
        {num('spread', 0, 180, 1, '°')}
        {num('gravityY', -2, 2, 100)}
        {num('size', 1, 8)}
        {num('seed', 0, 99999)}
      </div>
      <div className="prop-row">
        <span className="prop-label">{t('particle.colors')}</span>
        <input
          className="grow mono"
          defaultValue={s.colors.join(', ')}
          key={s.colors.join(',')}
          onBlur={(e) => update(layer.id, { colors: e.target.value.split(/[,\s]+/).filter(Boolean) })}
        />
      </div>
      <Toggle checked={s.fade} onChange={(fade) => update(layer.id, { fade })}>
        {t('particle.fade')}
      </Toggle>
      <Toggle checked={s.prewarm} onChange={(prewarm) => update(layer.id, { prewarm })} tip={t('particle.prewarmTip')}>
        {t('particle.prewarm')}
      </Toggle>
    </div>
  );
}
