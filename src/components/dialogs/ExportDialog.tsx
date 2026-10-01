/**
 * 내보내기 대화상자
 * ------------------------------------------------------------
 *  - PNG: 현재 프레임 한 장
 *  - 스프라이트시트: 모든 프레임을 한 장에 나열 (+ 게임 엔진용 JSON)
 *  - GIF: 움직이는 이미지 (SNS 공유용)
 * 픽셀아트는 작게 그리므로 "배율"로 키워서 내보내는 것이 보통입니다. (흐려지지 않게 정수 배율)
 */
import { useMemo, useState } from 'react';
import type { SheetLayout } from '../../core/exporters';
import { exportAseprite, exportGif, exportPngFrame, exportSpriteSheet } from '../../editor/fileActions';
import { useT } from '../../i18n';
import { notify, selectedFrames } from '../../store/actions';
import { getState, useEditor } from '../../store/editorStore';
import { NumberField, Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

type ExportKind = 'png' | 'sheet' | 'gif' | 'aseprite';
type RangeKind = 'all' | 'selection' | `tag:${string}`;

export function ExportDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const currentFrame = useEditor((s) => s.currentFrame);
  const activeTagId = useEditor((s) => s.activeTagId);
  const [kind, setKind] = useState<ExportKind>(project.frames.length > 1 ? 'gif' : 'png');
  const [scale, setScale] = useState(project.width <= 64 ? 8 : project.width <= 128 ? 4 : 1);
  const [range, setRange] = useState<RangeKind>(activeTagId ? `tag:${activeTagId}` : 'all');
  const [layout, setLayout] = useState<SheetLayout>('horizontal');
  const [columns, setColumns] = useState(4);
  const [padding, setPadding] = useState(0);
  const [withJson, setWithJson] = useState(true);
  const [loop, setLoop] = useState(true);
  const [busy, setBusy] = useState(false);

  const frames = useMemo(() => {
    if (range === 'selection') {
      const [a, b] = selectedFrames();
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    }
    if (range.startsWith('tag:')) {
      const tag = project.tags.find((tg) => `tag:${tg.id}` === range);
      if (tag) return Array.from({ length: tag.to - tag.from + 1 }, (_, i) => tag.from + i);
    }
    return project.frames.map((_, i) => i);
  }, [range, project]);

  const outW = project.width * scale;
  const outH = project.height * scale;
  let sizeText = `${outW} × ${outH}px`;
  if (kind === 'sheet') {
    const n = frames.length;
    const cols = layout === 'horizontal' ? n : layout === 'vertical' ? 1 : Math.min(columns, n);
    const rows = Math.ceil(n / cols);
    sizeText = `${cols * outW + (cols - 1) * padding} × ${rows * outH + (rows - 1) * padding}px`;
  }
  if (kind === 'aseprite') sizeText = `${project.width} × ${project.height}px · ${project.frames.length}f · ${project.layers.length}L`;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === 'png') await exportPngFrame(getState().currentFrame, scale);
      else if (kind === 'sheet') await exportSpriteSheet({ layout, columns, padding, scale, frames }, withJson);
      else if (kind === 'aseprite') await exportAseprite();
      else await exportGif({ frames, scale, loop, background: null });
      closeDialog();
    } catch (err) {
      console.error(err);
      notify(t('toast.exportFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('dialog.export.title')}
      width={480}
      onSubmit={() => void run()}
      footer={
        <>
          <span className="foot-info">{sizeText}</span>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => void run()} disabled={busy}>
            {busy ? t('dialog.export.working') : t('dialog.export.run')}
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(['png', 'sheet', 'gif', 'aseprite'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {t(`dialog.export.${k}`)}
          </button>
        ))}
      </div>
      <p className="note">{t(`dialog.export.${kind}Desc`)}</p>

      {kind !== 'aseprite' && (
        <div className="field">
          <span className="field-label">{t('dialog.export.scale')}</span>
          <div className="scale-row">
            {[1, 2, 4, 8, 16].map((s) => (
              <button key={s} type="button" className={`chip ${scale === s ? 'active' : ''}`} onClick={() => setScale(s)}>
                {s}x
              </button>
            ))}
            <NumberField value={scale} min={1} max={64} width={52} onChange={setScale} suffix="x" />
          </div>
        </div>
      )}

      {(kind === 'sheet' || kind === 'gif') && (
        <div className="field">
          <label htmlFor="export-range">{t('dialog.export.range')}</label>
          <select id="export-range" value={range} onChange={(e) => setRange(e.target.value as RangeKind)}>
            <option value="all">{t('dialog.export.rangeAll', { count: project.frames.length })}</option>
            <option value="selection">{t('dialog.export.rangeSelection')}</option>
            {project.tags.map((tag) => (
              <option key={tag.id} value={`tag:${tag.id}`}>
                {t('dialog.export.rangeTag', { name: tag.name, from: tag.from + 1, to: tag.to + 1 })}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind === 'png' && <p className="note">{t('dialog.export.pngFrame', { n: currentFrame + 1 })}</p>}

      {kind === 'sheet' && (
        <>
          <div className="field">
            <span className="field-label">{t('dialog.export.layout')}</span>
            <div className="segmented">
              {(['horizontal', 'vertical', 'grid'] as const).map((l) => (
                <button key={l} type="button" className={layout === l ? 'active' : ''} onClick={() => setLayout(l)}>
                  {t(`dialog.export.layout.${l}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            {layout === 'grid' && (
              <div className="field">
                <span className="field-label">{t('dialog.export.columns')}</span>
                <NumberField value={columns} min={1} max={64} onChange={setColumns} />
              </div>
            )}
            <div className="field">
              <span className="field-label">{t('dialog.export.padding')}</span>
              <NumberField value={padding} min={0} max={64} onChange={setPadding} suffix="px" />
            </div>
          </div>
          <Toggle checked={withJson} onChange={setWithJson} tip={t('dialog.export.jsonTip')}>
            {t('dialog.export.json')}
          </Toggle>
        </>
      )}

      {kind === 'gif' && (
        <>
          <Toggle checked={loop} onChange={setLoop}>
            {t('dialog.export.loop')}
          </Toggle>
          <p className="note">⚠ {t('dialog.export.gifNote')}</p>
        </>
      )}
    </Modal>
  );
}
