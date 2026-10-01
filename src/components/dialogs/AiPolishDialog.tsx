/**
 * AI 다듬기 대화상자 (Codex – ChatGPT 로그인, API 키 없음)
 * ------------------------------------------------------------
 * 자동 애니메이션으로 만든 동작을 골라 "손으로 그린 도트"처럼 다시 그리게 합니다.
 *  1) 다듬을 동작(태그) 고르기 → 원래 프레임 미리보기
 *  2) AI 로 다듬기 (몇 분 걸릴 수 있어요) → 원래/다듬은 결과를 나란히 재생해서 비교
 *  3) 마음에 들면 적용 (새 레이어로 들어가고, 그 프레임에서만 원래 리그를 숨김)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { codexPolishFrames } from '../../ai/aiTasks';
import { getCodexStatus, type CodexStatus } from '../../ai/codex';
import { unionBounds } from '../../core/aiPolish';
import { useT } from '../../i18n';
import { notify } from '../../store/actions';
import { applyPolish, defaultPolishRange, polishRanges, polishTarget, renderGuides, renderReference } from '../../store/aiPolishActions';
import { getState, setState } from '../../store/editorStore';
import { AnimPreview, type AnimFrames } from '../AnimPreview';
import { Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

export function AiPolishDialog() {
  const t = useT();
  const [target] = useState(() => polishTarget());
  const [ranges] = useState(() => polishRanges());
  const [rangeId, setRangeId] = useState(() => defaultPolishRange(ranges).id);
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [extra, setExtra] = useState('');
  const [stable, setStable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [result, setResult] = useState<Uint8ClampedArray[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void getCodexStatus().then(setStatus);
  }, []);

  const range = ranges.find((r) => r.id === rangeId) ?? ranges[0];
  const frames = useMemo(() => Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i), [range]);
  const p = getState().project;
  const guides = useMemo(() => (target ? renderGuides(target, frames) : []), [target, frames]);
  useEffect(() => setResult(null), [rangeId]);

  const anim = (list: Uint8ClampedArray[] | null): AnimFrames | null =>
    list && list.length > 0
      ? { frames: list, durations: frames.map((f) => p.frames[f]?.duration ?? 100), width: p.width, height: p.height, bounds: unionBounds(list, p.width, p.height) }
      : null;

  if (!target) {
    return (
      <Modal title={t('polish.title')} width={520}>
        <p className="note">{t('polish.noRig')}</p>
        <button type="button" className="btn accent" onClick={() => setState({ dialog: { id: 'autoAnimate' } })}>
          {t('menu.autoAnimate')}
        </button>
      </Modal>
    );
  }

  const ready = !!status?.connected && status.loggedIn;
  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLog('');
    setResult(null);
    try {
      const reference = renderReference(target);
      setResult(await codexPolishFrames(guides, reference, p.width, p.height, { extra, stabilize: stable }, { onLog: setLog, signal: controller.signal }));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        notify(t('toast.codexFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    const name = `${t('polish.layerName')} · ${range.label.replace(/\s*\(.*\)$/, '')}`;
    if (applyPolish(target, frames, result, name)) {
      notify(t('polish.applied'), 'success');
      closeDialog();
    }
  };

  return (
    <Modal
      title={t('polish.title')}
      width={720}
      onClose={() => {
        abortRef.current?.abort();
        closeDialog();
      }}
      footer={
        <>
          <span className="foot-info">{t('polish.info', { count: frames.length })}</span>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={!result || busy} onClick={apply}>
            {t('polish.apply')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('polish.intro')}</p>
      {status && !ready && (
        <div className="warn-box polish-codex">
          <span>{status.connected ? t('polish.needLogin') : t('polish.needBridge')}</span>
          <button type="button" className="btn small" onClick={() => setState({ dialog: { id: 'codex' } })}>
            🤖 {t('polish.openCodex')}
          </button>
        </div>
      )}
      <div className="field">
        <span className="field-label">{t('polish.range')}</span>
        <select value={rangeId} onChange={(e) => setRangeId(e.target.value)} disabled={busy}>
          {ranges.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('polish.extraPlaceholder')} disabled={busy} />
      </div>
      <div className="btn-row">
        <Toggle checked={stable} onChange={setStable} tip={t('polish.stabilizeTip')}>
          {t('polish.stabilize')}
        </Toggle>
        <span className="grow" />
        {busy ? (
          <button type="button" className="btn small" onClick={() => abortRef.current?.abort()}>
            {t('common.cancel')}
          </button>
        ) : (
          <button type="button" className="btn accent" onClick={() => void run()} disabled={!ready || guides.length === 0}>
            🤖 {result ? t('polish.retry') : t('polish.run')}
          </button>
        )}
      </div>
      {(busy || log) && <pre className="log-box small">{log || t('dialog.codex.waiting')}</pre>}
      <div className="compare polish-compare">
        <div>
          <span className="field-label">{t('polish.before')}</span>
          <AnimPreview preview={anim(guides)} box={220} />
        </div>
        <div>
          <span className="field-label">{t('polish.after')}</span>
          {result ? <AnimPreview preview={anim(result)} box={220} /> : <div className="anim-preview loading polish-wait">{busy ? '⏳' : '—'}</div>}
        </div>
      </div>
      <p className="note tiny">{t('polish.quotaNote')}</p>
    </Modal>
  );
}
