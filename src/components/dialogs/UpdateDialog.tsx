/**
 * 업데이트 확인 대화상자 (데스크톱 앱)
 * ------------------------------------------------------------
 * 확인 중 → (최신 버전 / 새 버전 있음) → 받는 중(진행 막대) → 다시 시작
 * 받은 파일은 앱에 들어 있는 공개 키로 서명을 확인한 뒤에만 설치됩니다.
 */
import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { notify } from '../../store/actions';
import { useEditor } from '../../store/editorStore';
import { checkForUpdate, installUpdate, restartApp, type UpdateInfo } from '../../platform/updates';
import { closeDialog, Modal } from './Modal';

type Phase =
  | { kind: 'checking' }
  | { kind: 'result'; info: UpdateInfo }
  | { kind: 'installing'; ratio: number | null; bytes: number }
  | { kind: 'installed' }
  | { kind: 'error'; message: string };

export function UpdateDialog() {
  const t = useT();
  const payload = useEditor((s) => s.dialog?.payload);
  const preset = payload?.info as UpdateInfo | undefined;
  const [phase, setPhase] = useState<Phase>(preset ? { kind: 'result', info: preset } : { kind: 'checking' });

  const check = () => {
    setPhase({ kind: 'checking' });
    checkForUpdate()
      .then((info) => setPhase({ kind: 'result', info }))
      .catch((e: unknown) => setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  useEffect(() => {
    // 처음 열 때 한 번만 확인합니다. (자동 확인으로 이미 결과가 있으면 그대로 보여줌)
    if (!preset) check();
  }, []);

  const install = () => {
    setPhase({ kind: 'installing', ratio: null, bytes: 0 });
    installUpdate((ratio, bytes) => setPhase((p) => (p.kind === 'installing' ? { kind: 'installing', ratio, bytes } : p)))
      .then((ok) => {
        if (ok) setPhase({ kind: 'installed' });
        else {
          notify(t('update.upToDate'), 'info');
          closeDialog();
        }
      })
      .catch((e: unknown) => setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  const busy = phase.kind === 'checking' || phase.kind === 'installing';
  return (
    <Modal
      title={t('update.title')}
      width={460}
      onClose={busy ? () => {} : closeDialog}
      footer={
        <>
          {phase.kind === 'result' && phase.info.available && (
            <>
              <button type="button" className="btn" onClick={closeDialog}>
                {t('update.later')}
              </button>
              <button type="button" className="btn primary" onClick={install}>
                {t('update.install')}
              </button>
            </>
          )}
          {phase.kind === 'installed' && (
            <>
              <button type="button" className="btn" onClick={closeDialog}>
                {t('update.later')}
              </button>
              <button type="button" className="btn primary" onClick={() => void restartApp()}>
                {t('update.restart')}
              </button>
            </>
          )}
          {phase.kind === 'error' && (
            <button type="button" className="btn" onClick={check}>
              {t('update.retry')}
            </button>
          )}
          {(phase.kind === 'error' || (phase.kind === 'result' && !phase.info.available)) && (
            <button type="button" className="btn primary" onClick={closeDialog}>
              {t('common.ok')}
            </button>
          )}
        </>
      }
    >
      <div className="update-dialog">
        {phase.kind === 'checking' && <p className="note">⏳ {t('update.checking')}</p>}
        {phase.kind === 'result' && !phase.info.configured && <p className="note">{t('update.notConfigured')}</p>}
        {phase.kind === 'result' && phase.info.configured && !phase.info.available && (
          <p className="success-box">✅ {t('update.latest', { version: phase.info.current })}</p>
        )}
        {phase.kind === 'result' && phase.info.available && (
          <>
            <p>
              🎉 {t('update.available', { version: phase.info.version ?? '?', current: phase.info.current })}
            </p>
            {phase.info.notes && <pre className="update-notes">{phase.info.notes}</pre>}
            <p className="note">💡 {t('update.saveFirst')}</p>
          </>
        )}
        {phase.kind === 'installing' && (
          <>
            <p>⬇ {t('update.downloading')}</p>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${Math.round((phase.ratio ?? 0) * 100)}%` }} />
            </div>
            <p className="note">
              {phase.ratio !== null ? `${Math.round(phase.ratio * 100)}%` : `${(phase.bytes / 1024 / 1024).toFixed(1)} MB`}
            </p>
          </>
        )}
        {phase.kind === 'installed' && <p className="success-box">✅ {t('update.installed')}</p>}
        {phase.kind === 'error' && (
          <>
            <p className="error-box">{t('update.failed')}</p>
            <details>
              <summary>{t('crash.details')}</summary>
              <pre className="update-notes">{phase.message}</pre>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}
