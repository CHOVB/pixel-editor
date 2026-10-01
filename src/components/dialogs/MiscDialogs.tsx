/**
 * 작은 대화상자 모음
 * ------------------------------------------------------------
 *  - ShortcutsDialog: 단축키 전체 목록
 *  - AboutDialog: 프로그램 정보
 *  - FrameDurationDialog: 프레임 재생 시간
 *  - LayerPropsDialog: 레이어 이름/불투명도
 *  - TagDialog: 애니메이션 태그 만들기/수정
 *  - ConfirmDialog: "정말 할까요?" 확인
 */
import { useState } from 'react';
import { SHORTCUTS, type ShortcutGroup } from '../../editor/shortcuts';
import { tr, useT } from '../../i18n';
import {
  addTagAction,
  commitStructure,
  deleteTagAction,
  selectedFrames,
  setFrameDurations,
  updateTagAction,
} from '../../store/actions';
import { getState, useEditor } from '../../store/editorStore';
import { TAG_COLORS } from '../../core/project';
import { NumberField } from '../ui';
import { closeDialog, Modal } from './Modal';

/* ------------------------------------------------------------------ */

const GROUPS: ShortcutGroup[] = ['tools', 'edit', 'animation', 'view', 'file'];

export function ShortcutsDialog() {
  const t = useT();
  return (
    <Modal title={t('dialog.shortcuts.title')} width={760} className="shortcuts">
      <div className="shortcut-columns">
        {GROUPS.map((g) => (
          <div key={g} className="shortcut-group">
            <h3>{t(`shortcutGroup.${g}`)}</h3>
            <table>
              <tbody>
                {SHORTCUTS.filter((s) => s.group === g).map((s, i) => (
                  <tr key={`${s.label}-${i}`}>
                    <td>
                      <kbd>{s.label}</kbd>
                    </td>
                    <td>{t(s.desc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="note">💡 {t('dialog.shortcuts.tip')}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export function AboutDialog() {
  const t = useT();
  return (
    <Modal title={t('dialog.about.title')} width={420}>
      <div className="about">
        <div className="about-logo" />
        <h3>Pixel Editor</h3>
        <p>v0.1.0</p>
        <p>{t('dialog.about.body')}</p>
        <p className="note">{t('dialog.about.credits')}</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export function FrameDurationDialog({ index }: { index?: number }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const [a, b] = index !== undefined ? [index, index] : selectedFrames();
  const [ms, setMs] = useState(project.frames[a]?.duration ?? 100);
  const [applyAll, setApplyAll] = useState(false);

  const apply = () => {
    const indices = applyAll ? project.frames.map((_, i) => i) : Array.from({ length: b - a + 1 }, (_, i) => a + i);
    setFrameDurations(indices, ms);
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.duration.title')}
      onSubmit={apply}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            {t('common.apply')}
          </button>
        </>
      }
    >
      <p className="note">{a === b ? t('dialog.duration.single', { n: a + 1 }) : t('dialog.duration.range', { from: a + 1, to: b + 1 })}</p>
      <div className="field-row">
        <div className="field">
          <span className="field-label">{t('dialog.duration.ms')}</span>
          <NumberField value={ms} min={10} max={60000} step={10} onChange={setMs} width={90} suffix="ms" />
        </div>
        <div className="field">
          <span className="field-label">≈ FPS</span>
          <span className="readonly">{(1000 / ms).toFixed(1)}</span>
        </div>
      </div>
      <div className="scale-row">
        {[50, 83, 100, 150, 200, 500].map((v) => (
          <button key={v} type="button" className={`chip ${ms === v ? 'active' : ''}`} onClick={() => setMs(v)}>
            {v}ms
          </button>
        ))}
      </div>
      <label className="toggle-inline">
        <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
        {t('dialog.duration.applyAll')}
      </label>
      <p className="note">💡 {t('dialog.duration.tip')}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export function LayerPropsDialog() {
  const t = useT();
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId));
  const [name, setName] = useState(layer?.name ?? '');
  const [opacity, setOpacity] = useState(Math.round((layer?.opacity ?? 1) * 100));

  if (!layer) return null;
  const apply = () => {
    commitStructure(tr('history.layerProps'), (p) => {
      const l = p.layers.find((x) => x.id === layer.id);
      if (!l) return false;
      const nextName = name.trim() || l.name;
      const nextOpacity = opacity / 100;
      if (l.name === nextName && l.opacity === nextOpacity) return false;
      l.name = nextName;
      l.opacity = nextOpacity;
    });
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.layerProps.title')}
      onSubmit={apply}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            {t('common.apply')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="layer-name">{t('dialog.layerProps.name')}</label>
        <input id="layer-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">{t('layer.opacity')}</span>
        <div className="scale-row">
          <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          <NumberField value={opacity} min={0} max={100} onChange={setOpacity} suffix="%" />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export function TagDialog({ tagId, from, to }: { tagId?: string; from?: number; to?: number }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const existing = tagId ? project.tags.find((tg) => tg.id === tagId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [start, setStart] = useState((existing?.from ?? from ?? 0) + 1);
  const [end, setEnd] = useState((existing?.to ?? to ?? getState().currentFrame) + 1);
  const [color, setColor] = useState(existing?.color ?? TAG_COLORS[project.tags.length % TAG_COLORS.length]);
  const max = project.frames.length;

  const apply = () => {
    if (existing) updateTagAction(existing.id, { name: name.trim() || existing.name, from: start - 1, to: end - 1, color });
    else addTagAction(name, start - 1, end - 1);
    closeDialog();
  };

  return (
    <Modal
      title={existing ? t('dialog.tag.editTitle') : t('dialog.tag.newTitle')}
      onSubmit={apply}
      footer={
        <>
          {existing && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                deleteTagAction(existing.id);
                closeDialog();
              }}
            >
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            {existing ? t('common.apply') : t('dialog.tag.create')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="tag-name">{t('dialog.tag.name')}</label>
        <input id="tag-name" value={name} placeholder={t('dialog.tag.placeholder')} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label">{t('dialog.tag.from')}</span>
          <NumberField value={start} min={1} max={max} onChange={setStart} />
        </div>
        <div className="field">
          <span className="field-label">{t('dialog.tag.to')}</span>
          <NumberField value={end} min={1} max={max} onChange={setEnd} />
        </div>
      </div>
      {existing && (
        <div className="field">
          <span className="field-label">{t('dialog.tag.color')}</span>
          <div className="scale-row">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-dot ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      )}
      <p className="note">💡 {t('dialog.tag.tip')}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
}: {
  message: string;
  confirmLabel?: string;
  onConfirm?: () => void;
}) {
  const t = useT();
  const ok = () => {
    closeDialog();
    onConfirm?.();
  };
  return (
    <Modal
      title={t('confirm.title')}
      onSubmit={ok}
      width={380}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary danger" onClick={ok}>
            {confirmLabel ?? t('common.ok')}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
