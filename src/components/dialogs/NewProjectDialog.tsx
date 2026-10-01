/**
 * 새 그림 만들기 대화상자
 * ------------------------------------------------------------
 * 자주 쓰는 크기(16, 32, 64...)를 버튼으로 바로 고를 수 있고, 직접 입력도 가능합니다.
 */
import { useState } from 'react';
import { packColor } from '../../core/color';
import { MAX_CANVAS_SIZE } from '../../core/project';
import { newProject } from '../../editor/fileActions';
import { useT } from '../../i18n';
import { NumberField } from '../ui';
import { closeDialog, Modal } from './Modal';

export const SIZE_PRESETS: { w: number; h: number; key: 'preset.icon' | 'preset.character' | 'preset.sprite' | 'preset.large' | 'preset.tile' | 'preset.screen' }[] = [
  { w: 16, h: 16, key: 'preset.icon' },
  { w: 32, h: 32, key: 'preset.character' },
  { w: 64, h: 64, key: 'preset.sprite' },
  { w: 128, h: 128, key: 'preset.large' },
  { w: 16, h: 32, key: 'preset.tile' },
  { w: 320, h: 180, key: 'preset.screen' },
];

export function NewProjectDialog() {
  const t = useT();
  const [width, setWidth] = useState(32);
  const [height, setHeight] = useState(32);
  const [name, setName] = useState('');
  const [background, setBackground] = useState<'transparent' | 'white' | 'black'>('transparent');

  const create = () => {
    const bg = background === 'white' ? packColor(255, 255, 255) : background === 'black' ? packColor(0, 0, 0) : null;
    newProject(width, height, bg, name.trim() || undefined);
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.new.title')}
      onSubmit={create}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={create}>
            {t('dialog.new.create')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-name">{t('dialog.new.name')}</label>
        <input id="new-name" value={name} placeholder={t('project.untitled')} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <span className="field-label">{t('dialog.new.presets')}</span>
        <div className="preset-grid">
          {SIZE_PRESETS.map((p) => (
            <button
              key={`${p.w}x${p.h}`}
              type="button"
              className={`preset ${width === p.w && height === p.h ? 'active' : ''}`}
              onClick={() => {
                setWidth(p.w);
                setHeight(p.h);
              }}
            >
              <strong>
                {p.w}×{p.h}
              </strong>
              <small>{t(p.key)}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <span className="field-label">{t('dialog.width')}</span>
          <NumberField value={width} min={1} max={MAX_CANVAS_SIZE} onChange={setWidth} width={80} suffix="px" />
        </div>
        <div className="field">
          <span className="field-label">{t('dialog.height')}</span>
          <NumberField value={height} min={1} max={MAX_CANVAS_SIZE} onChange={setHeight} width={80} suffix="px" />
        </div>
      </div>

      <div className="field">
        <span className="field-label">{t('dialog.new.background')}</span>
        <div className="segmented">
          {(['transparent', 'white', 'black'] as const).map((bg) => (
            <button key={bg} type="button" className={background === bg ? 'active' : ''} onClick={() => setBackground(bg)}>
              {t(`dialog.new.bg.${bg}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="note">💡 {t('dialog.new.tip')}</p>
    </Modal>
  );
}
