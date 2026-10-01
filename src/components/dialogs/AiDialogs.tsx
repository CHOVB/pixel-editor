/**
 * AI(Codex) 관련 대화상자
 * ------------------------------------------------------------
 *  - CodexDialog: Codex 연결 상태 확인 / ChatGPT 로그인 / 설치 안내
 *  - PartFillDialog: 선택 영역을 파츠 레이어로 분리 + 가려졌던 부분 채우기 (자동 또는 Codex)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { codexFillOccluded } from '../../ai/aiTasks';
import { bridgeUrl, getCodexStatus, isDesktopApp, setBridgeUrl, startCodexLogin, type CodexStatus } from '../../ai/codex';
import { mergeMasked } from '../../core/inpaint';
import { useT } from '../../i18n';
import { notify } from '../../store/actions';
import { setState, useEditor } from '../../store/editorStore';
import { applySplit, autoFillHole, planSplit, type SplitPlan } from '../../store/toolActions';
import { ImagePreview, type PreviewTransform } from '../ImagePreview';
import { closeDialog, Modal } from './Modal';

/* ------------------------------------------------------------------ */
/* Codex 연결                                                            */
/* ------------------------------------------------------------------ */

export function CodexDialog() {
  const t = useT();
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState(bridgeUrl());
  const desktop = isDesktopApp();

  const refresh = useCallback(async () => {
    setChecking(true);
    setStatus(await getCodexStatus());
    setChecking(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const step = (ok: boolean, label: string) => (
    <li className={ok ? 'ok' : 'todo'}>
      <span className="step-mark">{ok ? '✓' : '•'}</span>
      {label}
    </li>
  );

  return (
    <Modal
      title={t('dialog.codex.title')}
      width={600}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={checking}>
            {checking ? t('dialog.codex.checking') : t('dialog.codex.refresh')}
          </button>
          <button type="button" className="btn primary" onClick={closeDialog}>
            {t('common.ok')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.codex.intro')}</p>
      <ul className="steps">
        {!desktop && step(!!status?.connected, t('dialog.codex.stepBridge'))}
        {step(!!status?.codexInstalled, t('dialog.codex.stepInstall'))}
        {step(!!status?.loggedIn, t('dialog.codex.stepLogin'))}
      </ul>
      {status?.loggedIn && (
        <p className="success-box">
          ✅ {t('dialog.codex.ready', { version: status.codexVersion ?? '', mode: status.authMode === 'chatgpt' ? 'ChatGPT' : status.authMode ?? '' })}
        </p>
      )}
      {status?.loggedIn && status.authMode === 'apikey' && <p className="warn-box">⚠ {t('dialog.codex.apiKeyWarning')}</p>}

      {!desktop && !status?.connected && (
        <div className="howto">
          <strong>{t('dialog.codex.howBridge')}</strong>
          <pre className="cmd">npm run codex-bridge</pre>
          <p className="note">{t('dialog.codex.howBridgeNote')}</p>
        </div>
      )}
      {status?.connected && !status.codexInstalled && (
        <div className="howto">
          <strong>{t('dialog.codex.howInstall')}</strong>
          <pre className="cmd">npm install -g @openai/codex</pre>
        </div>
      )}
      {status?.codexInstalled && !status.loggedIn && (
        <div className="howto">
          <strong>{t('dialog.codex.howLogin')}</strong>
          <pre className="cmd">codex login</pre>
          <button
            type="button"
            className="btn accent"
            onClick={async () => {
              try {
                const r = await startCodexLogin();
                notify(r.message ?? t('dialog.codex.loginStarted'), 'info');
              } catch (err) {
                notify(String(err), 'error');
              }
            }}
          >
            {t('dialog.codex.loginButton')}
          </button>
        </div>
      )}

      {!desktop && (
        <div className="field">
          <span className="field-label">{t('dialog.codex.bridgeUrl')}</span>
          <div className="btn-row">
            <input className="grow mono" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setBridgeUrl(url);
                void refresh();
              }}
            >
              {t('common.apply')}
            </button>
          </div>
        </div>
      )}
      {status?.connected && status.message && <pre className="log-box small">{status.message}</pre>}
      <p className="note">{t('dialog.codex.privacy')}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 파츠 분리 + 가려진 부분 채우기                                          */
/* ------------------------------------------------------------------ */

type FillMethod = 'auto' | 'codex' | 'none';

export function PartFillDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const [plan] = useState<SplitPlan | null>(() => planSplit());
  const [method, setMethod] = useState<FillMethod>('auto');
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  const [codexResult, setCodexResult] = useState<Uint8ClampedArray | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const w = project.width;
  const h = project.height;

  useEffect(() => {
    if (!plan) closeDialog();
  }, [plan]);
  // 창이 어떤 방법으로 닫혀도(취소 버튼, Codex 설정으로 이동 등) 진행 중인 Codex 작업을 멈춥니다.
  useEffect(() => () => abortRef.current?.abort(), []);

  const autoFilled = useMemo(() => (plan ? autoFillHole(plan) : null), [plan]);
  const filled = method === 'auto' ? autoFilled : method === 'codex' ? (codexResult && plan ? mergeMasked(plan.body, codexResult, plan.hole) : null) : plan?.body ?? null;

  const holeOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: PreviewTransform) => {
      if (!plan || method === 'none') return;
      ctx.fillStyle = 'rgba(255, 0, 255, 0.25)';
      for (let i = 0; i < plan.hole.length; i++) {
        if (!plan.hole[i]) continue;
        ctx.fillRect(tr.ox + (i % w) * tr.scale, tr.oy + Math.floor(i / w) * tr.scale, tr.scale, tr.scale);
      }
    },
    [plan, method, w],
  );

  if (!plan) return null;

  const runCodex = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLog('');
    try {
      setCodexResult(await codexFillOccluded(plan.body, plan.part, plan.hole, w, h, extra, { onLog: setLog, signal: controller.signal }));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        notify(t('toast.codexFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('dialog.part.title')}
      width={760}
      onClose={() => {
        abortRef.current?.abort();
        closeDialog();
      }}
      footer={
        <>
          <span className="foot-info">{t('dialog.part.holeInfo', { count: plan.holeCount })}</span>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || (method === 'codex' && !codexResult)}
            onClick={() => {
              applySplit(plan, filled, name.trim());
              closeDialog();
            }}
          >
            {t('dialog.part.apply')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.part.intro')}</p>
      <div className="field">
        <span className="field-label">{t('dialog.part.name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.part.namePlaceholder')} />
      </div>
      <div className="field">
        <span className="field-label">{t('dialog.part.fill')}</span>
        <div className="segmented">
          {(['auto', 'codex', 'none'] as const).map((m) => (
            <button key={m} type="button" className={method === m ? 'active' : ''} onClick={() => setMethod(m)} data-tip={t(`dialog.part.${m}Tip`)}>
              {t(`dialog.part.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {method === 'codex' && (
        <div className="field">
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('dialog.part.extraPlaceholder')} />
          <div className="btn-row">
            <button type="button" className="btn small accent" onClick={() => void runCodex()} disabled={busy}>
              🤖 {busy ? t('dialog.export.working') : t('dialog.part.runCodex')}
            </button>
            <button type="button" className="link-btn" onClick={() => setState({ dialog: { id: 'codex' } })}>
              {t('dialog.part.codexSettings')}
            </button>
          </div>
          {(busy || log) && <pre className="log-box small">{log || t('dialog.codex.waiting')}</pre>}
        </div>
      )}
      <div className="compare">
        <div>
          <span className="field-label">{t('dialog.part.part')}</span>
          <ImagePreview pixels={plan.part} width={w} height={h} boxW={220} boxH={220} />
        </div>
        <div>
          <span className="field-label">{t('dialog.part.bodyBefore')}</span>
          <ImagePreview pixels={plan.body} width={w} height={h} boxW={220} boxH={220} overlay={holeOverlay} version={method} />
        </div>
        <div>
          <span className="field-label">{t('dialog.part.bodyAfter')}</span>
          <ImagePreview pixels={filled} width={w} height={h} boxW={220} boxH={220} version={`${method}:${codexResult ? 1 : 0}`} />
        </div>
      </div>
    </Modal>
  );
}
