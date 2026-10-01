/**
 * 캔버스 크기 / 이미지 크기 조절 대화상자
 * ------------------------------------------------------------
 *  - 캔버스 크기: 그림은 그대로 두고 "도화지"만 늘리거나 줄입니다. (기준 위치 선택)
 *  - 이미지 크기: 그림 자체를 확대/축소합니다. (최근접 이웃 방식 → 픽셀이 흐려지지 않음)
 */
import { useState } from 'react';
import { MAX_CANVAS_SIZE } from '../../core/project';
import { useT } from '../../i18n';
import { resizeCanvasAction, scaleSpriteAction } from '../../store/actions';
import { useEditor } from '../../store/editorStore';
import { NumberField, Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

const ANCHORS: [number, number][] = [
  [0, 0], [0.5, 0], [1, 0],
  [0, 0.5], [0.5, 0.5], [1, 0.5],
  [0, 1], [0.5, 1], [1, 1],
];
const ARROWS = ['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘'];

export function CanvasSizeDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const [width, setWidth] = useState(project.width);
  const [height, setHeight] = useState(project.height);
  const [anchor, setAnchor] = useState(4);

  const apply = () => {
    const [ax, ay] = ANCHORS[anchor];
    resizeCanvasAction(width, height, ax, ay);
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.canvasSize.title')}
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
      <p className="note">
        {t('dialog.current')}: {project.width} × {project.height}px
      </p>
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
        <span className="field-label">{t('dialog.canvasSize.anchor')}</span>
        <div className="anchor-grid">
          {ARROWS.map((a, i) => (
            <button key={i} type="button" className={anchor === i ? 'active' : ''} onClick={() => setAnchor(i)} aria-label={`anchor ${i}`}>
              {anchor === i ? '■' : a}
            </button>
          ))}
        </div>
      </div>
      <p className="note">💡 {t('dialog.canvasSize.tip')}</p>
    </Modal>
  );
}

export function ScaleDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const [width, setWidth] = useState(project.width);
  const [height, setHeight] = useState(project.height);
  const [keepRatio, setKeepRatio] = useState(true);
  const ratio = project.width / project.height;

  const apply = () => {
    scaleSpriteAction(width, height);
    closeDialog();
  };

  const setW = (w: number) => {
    setWidth(w);
    if (keepRatio) setHeight(Math.max(1, Math.min(MAX_CANVAS_SIZE, Math.round(w / ratio))));
  };
  const setH = (h: number) => {
    setHeight(h);
    if (keepRatio) setWidth(Math.max(1, Math.min(MAX_CANVAS_SIZE, Math.round(h * ratio))));
  };

  return (
    <Modal
      title={t('dialog.scale.title')}
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
      <p className="note">
        {t('dialog.current')}: {project.width} × {project.height}px
      </p>
      <div className="scale-row">
        {[50, 200, 300, 400].map((pct) => (
          <button
            key={pct}
            type="button"
            className="chip"
            onClick={() => {
              setWidth(Math.max(1, Math.round((project.width * pct) / 100)));
              setHeight(Math.max(1, Math.round((project.height * pct) / 100)));
            }}
          >
            {pct}%
          </button>
        ))}
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label">{t('dialog.width')}</span>
          <NumberField value={width} min={1} max={MAX_CANVAS_SIZE} onChange={setW} width={80} suffix="px" />
        </div>
        <div className="field">
          <span className="field-label">{t('dialog.height')}</span>
          <NumberField value={height} min={1} max={MAX_CANVAS_SIZE} onChange={setH} width={80} suffix="px" />
        </div>
      </div>
      <Toggle checked={keepRatio} onChange={setKeepRatio}>
        {t('dialog.scale.keepRatio')}
      </Toggle>
      <p className="note">💡 {t('dialog.scale.tip')}</p>
    </Modal>
  );
}
