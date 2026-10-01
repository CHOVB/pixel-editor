/**
 * 자동 중간 프레임 생성 대화상자
 * ------------------------------------------------------------
 * 예) 1프레임 "서 있기", 2프레임 "다리 벌림" → 사이에 6장 자동 생성 → 총 8프레임
 *  - 미리보기: 만들어질 동작이 반복 재생됩니다. (적용 전 확인)
 *  - 방법: 픽셀 이동 추적(추천) / 디더 전환 / Codex AI
 *  - "돌아오는 동작도 만들기": B → A 도 만들어서 걷기처럼 반복되는 동작 완성
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { codexInbetween } from '../../ai/aiTasks';
import { generateInbetweens, type InbetweenMethod } from '../../core/inbetween';
import { compositeFrame } from '../../core/render';
import { addFrame, addLayer, celKey } from '../../core/project';
import type { Ease } from '../../core/types';
import { tr, useT } from '../../i18n';
import { commitStructure, notify } from '../../store/actions';
import { inbetweenAction } from '../../store/animActions';
import { useEditor } from '../../store/editorStore';
import { bufferToCanvas } from '../../platform/canvas';
import { EaseEditor } from '../EaseEditor';
import { NumberField, Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

type Method = InbetweenMethod | 'codex';

export function InbetweenDialog({ from: initFrom = 0, to: initTo = 1 }: { from?: number; to?: number }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const n = project.frames.length;
  const [from, setFrom] = useState(Math.min(initFrom, n - 1) + 1);
  const [to, setTo] = useState(Math.min(Math.max(initTo, 0), n - 1) + 1);
  const [count, setCount] = useState(6);
  const [method, setMethod] = useState<Method>('morph');
  const [ease, setEase] = useState<Ease>({ kind: 'easeInOut' });
  const [smoothing, setSmoothing] = useState(2);
  const [fillHoles, setFillHoles] = useState(true);
  const [roundTrip, setRoundTrip] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const a = Math.max(0, Math.min(n - 1, from - 1));
  const b = Math.max(0, Math.min(n - 1, to - 1));

  // 미리보기용 프레임 (합성 이미지 기준)
  const preview = useMemo(() => {
    if (a === b || method === 'codex') return [];
    const A = compositeFrame(project, a);
    const B = compositeFrame(project, b);
    const mids = generateInbetweens(A, B, project.width, project.height, { count, method, ease, smoothing, fillHoles });
    const seq = [A, ...mids, B];
    if (roundTrip) seq.push(...generateInbetweens(B, A, project.width, project.height, { count, method, ease, smoothing, fillHoles }));
    return seq;
  }, [project, a, b, count, method, ease, smoothing, fillHoles, roundTrip]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || preview.length === 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const scale = Math.max(1, Math.floor(160 / Math.max(project.width, project.height)));
    c.width = project.width * scale;
    c.height = project.height * scale;
    ctx.imageSmoothingEnabled = false;
    const frames = preview.map((buf) => bufferToCanvas(buf, project.width, project.height));
    let i = 0;
    const timer = setInterval(() => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(frames[i % frames.length], 0, 0, c.width, c.height);
      i++;
    }, project.frames[a]?.duration ?? 100);
    return () => clearInterval(timer);
  }, [preview, project, a]);

  const runCodex = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLog('');
    try {
      const A = compositeFrame(project, a);
      const B = compositeFrame(project, b);
      const frames = await codexInbetween(A, B, project.width, project.height, count, extra, { onLog: setLog, signal: controller.signal });
      // AI 결과는 "합쳐진 그림"이므로 새 레이어(AI 중간 프레임)에 넣습니다.
      commitStructure(tr('history.inbetween'), (p) => {
        const start = Math.min(a, b);
        const layer = addLayer(p, undefined, tr('layer.aiInbetween'));
        for (let i = 0; i < frames.length; i++) {
          const f = addFrame(p, start + 1 + i, p.frames[start].duration);
          p.cels[celKey(layer.id, f.id)] = frames[i];
        }
        return { frame: start + 1, layerId: layer.id };
      });
      notify(t('toast.inbetweenDone', { count }), 'success');
      closeDialog();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) notify(t('toast.codexFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const apply = () => {
    if (a === b) {
      notify(t('toast.inbetweenNeedTwo'), 'error');
      return;
    }
    if (method === 'codex') {
      void runCodex();
      return;
    }
    inbetweenAction({ from: a, to: b, count, method, ease, smoothing, fillHoles, roundTrip, scope });
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.inbetween.title')}
      width={640}
      onSubmit={busy ? undefined : apply}
      onClose={() => {
        abortRef.current?.abort();
        closeDialog();
      }}
      footer={
        <>
          <span className="foot-info">{t('dialog.inbetween.result', { total: preview.length || count + 2 })}</span>
          <button type="button" className="btn" onClick={() => (busy ? abortRef.current?.abort() : closeDialog())}>
            {busy ? t('common.stop') : t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply} disabled={busy}>
            {busy ? t('dialog.export.working') : t('dialog.inbetween.apply')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.inbetween.intro')}</p>
      <div className="two-col">
        <div className="col">
          <div className="field-row">
            <div className="field">
              <span className="field-label">{t('dialog.inbetween.from')}</span>
              <NumberField value={from} min={1} max={n} onChange={setFrom} />
            </div>
            <div className="field">
              <span className="field-label">{t('dialog.inbetween.to')}</span>
              <NumberField value={to} min={1} max={n} onChange={setTo} />
            </div>
            <div className="field">
              <span className="field-label">{t('dialog.inbetween.count')}</span>
              <NumberField value={count} min={1} max={30} onChange={setCount} />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('dialog.inbetween.method')}</span>
            <div className="segmented">
              {(['morph', 'dither', 'codex'] as const).map((m) => (
                <button key={m} type="button" className={method === m ? 'active' : ''} onClick={() => setMethod(m)} data-tip={t(`dialog.inbetween.${m}Tip`)}>
                  {t(`dialog.inbetween.${m}`)}
                </button>
              ))}
            </div>
          </div>
          {method === 'morph' && (
            <>
              <label className="opt" data-tip={t('dialog.inbetween.smoothingTip')}>
                {t('dialog.inbetween.smoothing')}
                <input type="range" min={0} max={3} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
                {smoothing}
              </label>
              <Toggle checked={fillHoles} onChange={setFillHoles}>
                {t('dialog.inbetween.fillHoles')}
              </Toggle>
            </>
          )}
          {method === 'codex' && (
            <div className="field">
              <span className="field-label">{t('dialog.inbetween.extra')}</span>
              <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('dialog.inbetween.extraPlaceholder')} />
              <p className="note">{t('dialog.inbetween.codexNote')}</p>
            </div>
          )}
          {method !== 'codex' && (
            <>
              <Toggle checked={roundTrip} onChange={setRoundTrip} tip={t('dialog.inbetween.roundTripTip')}>
                {t('dialog.inbetween.roundTrip')}
              </Toggle>
              <div className="segmented">
                <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
                  {t('dialog.inbetween.allLayers')}
                </button>
                <button type="button" className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')}>
                  {t('dialog.inbetween.currentLayer')}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="col">
          {method !== 'codex' && (
            <>
              <span className="field-label">{t('dialog.inbetween.preview')}</span>
              <canvas ref={canvasRef} className="preview-box checker" />
              <span className="field-label">{t('anim.easeTitle')}</span>
              <EaseEditor value={ease} onChange={setEase} />
            </>
          )}
          {method === 'codex' && (busy || log) && <pre className="log-box">{log || t('dialog.codex.waiting')}</pre>}
        </div>
      </div>
    </Modal>
  );
}
