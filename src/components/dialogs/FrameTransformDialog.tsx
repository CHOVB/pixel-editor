/**
 * 프레임 일괄 변형 대화상자
 * ------------------------------------------------------------
 * 고른 프레임(또는 전체)의 그림을 한 번에 옮기기 · 뒤집기 · 돌리기.
 * 예) 걷기 애니메이션 전체를 2픽셀 아래로, 오른쪽을 보던 캐릭터를 왼쪽 보게 뒤집기
 */
import { useMemo, useState } from 'react';
import { transformCelBuffer, type CelTransform } from '../../core/frameTools';
import { compositeFrame } from '../../core/render';
import { getCel, sourceFrameId } from '../../core/project';
import { useT } from '../../i18n';
import { selectedFrames } from '../../store/actions';
import { useEditor } from '../../store/editorStore';
import { transformFramesAction } from '../../store/frameActions';
import { ImagePreview } from '../ImagePreview';
import { NumberField, Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

const ROTATIONS = [0, 90, 180, 270] as const;

export function FrameTransformDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const currentFrame = useEditor((s) => s.currentFrame);
  const currentLayerId = useEditor((s) => s.currentLayerId);
  const [ra, rb] = selectedFrames();
  const [frames, setFrames] = useState<'range' | 'all'>(rb > ra ? 'range' : 'all');
  const [layers, setLayers] = useState<'current' | 'all'>('current');
  const [tf, setTf] = useState<CelTransform>({ dx: 0, dy: 0, wrap: false, flipH: false, flipV: false, rotate: 0 });
  const square = project.width === project.height;
  const set = (patch: Partial<CelTransform>) => setTf({ ...tf, ...patch });

  // 미리보기: 지금 프레임 (현재 레이어만 또는 전체 합성)
  const before = useMemo(() => {
    if (layers === 'all') return compositeFrame(project, currentFrame);
    const layer = project.layers.find((l) => l.id === currentLayerId);
    const fid = layer ? sourceFrameId(project, layer, currentFrame) : null;
    return (fid && getCel(project, currentLayerId, fid)) || compositeFrame(project, currentFrame);
  }, [project, currentFrame, currentLayerId, layers]);
  const after = useMemo(() => transformCelBuffer(before, project.width, project.height, tf), [before, project, tf]);
  const count = frames === 'all' ? project.frames.length : rb - ra + 1;

  const apply = () => {
    transformFramesAction({ ...tf, frames, layers });
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.frameTf.title')}
      width={680}
      onSubmit={apply}
      footer={
        <>
          <span className="foot-info">{t('dialog.frameTf.info', { count })}</span>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            {t('common.apply')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.frameTf.intro')}</p>
      <div className="two-col">
        <div className="col">
          <div className="field">
            <span className="field-label">{t('dialog.frameTf.frames')}</span>
            <div className="segmented">
              <button type="button" className={frames === 'range' ? 'active' : ''} onClick={() => setFrames('range')}>
                {t('dialog.frameTf.range', { from: ra + 1, to: rb + 1 })}
              </button>
              <button type="button" className={frames === 'all' ? 'active' : ''} onClick={() => setFrames('all')}>
                {t('dialog.cleanup.scope.all')}
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('dialog.frameTf.layers')}</span>
            <div className="segmented">
              <button type="button" className={layers === 'current' ? 'active' : ''} onClick={() => setLayers('current')}>
                {t('dialog.inbetween.currentLayer')}
              </button>
              <button type="button" className={layers === 'all' ? 'active' : ''} onClick={() => setLayers('all')}>
                {t('dialog.inbetween.allLayers')}
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('dialog.frameTf.move')}</span>
            <div className="btn-row">
              <label className="opt">
                X <NumberField value={tf.dx} min={-4096} max={4096} width={56} suffix="px" onChange={(dx) => set({ dx })} />
              </label>
              <label className="opt">
                Y <NumberField value={tf.dy} min={-4096} max={4096} width={56} suffix="px" onChange={(dy) => set({ dy })} />
              </label>
              <Toggle checked={tf.wrap} onChange={(wrap) => set({ wrap })} tip={t('dialog.frameTf.wrapTip')}>
                {t('dialog.frameTf.wrap')}
              </Toggle>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('dialog.frameTf.flip')}</span>
            <div className="btn-row">
              <Toggle checked={tf.flipH} onChange={(flipH) => set({ flipH })}>
                {t('dialog.frameTf.flipH')}
              </Toggle>
              <Toggle checked={tf.flipV} onChange={(flipV) => set({ flipV })}>
                {t('dialog.frameTf.flipV')}
              </Toggle>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('dialog.frameTf.rotate')}</span>
            <div className="segmented">
              {ROTATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={tf.rotate === r ? 'active' : ''}
                  disabled={!square && (r === 90 || r === 270)}
                  onClick={() => set({ rotate: r })}
                  data-tip={!square && (r === 90 || r === 270) ? t('dialog.frameTf.squareOnly') : undefined}
                >
                  {r}°
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="col">
          <div className="compare">
            <div>
              <span className="field-label">{t('dialog.cleanup.before')}</span>
              <ImagePreview pixels={before} width={project.width} height={project.height} boxW={140} boxH={140} />
            </div>
            <div>
              <span className="field-label">{t('dialog.cleanup.after')}</span>
              <ImagePreview pixels={after} width={project.width} height={project.height} boxW={140} boxH={140} version={JSON.stringify(tf)} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
