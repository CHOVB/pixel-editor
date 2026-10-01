/**
 * 화면 오류 보호막 (Error Boundary)
 * ------------------------------------------------------------
 * 화면을 그리다가 오류가 나면 React 는 화면 전체를 지워 버립니다.
 * 이 컴포넌트가 그 오류를 잡아서
 *  1) 작업을 비상 자동 저장하고
 *  2) "문제가 생겼어요" 안내 화면과 복구 버튼을 보여줍니다.
 *  3) 오류 보고 주소가 설정된 빌드라면 "개발자에게 보내기" 버튼을 보여줍니다. (누를 때만 전송)
 *
 * (React 의 오류 보호막은 아직 클래스 컴포넌트로만 만들 수 있습니다)
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { emergencySave, errorReport, recordError, reportContext, type ErrorRecord } from '../editor/crashGuard';
import { tr } from '../i18n';
import { autoReport, buildReport, reportingAvailable, sendReport } from '../platform/errorReport';
import { savePrefs } from '../store/prefs';

interface Props {
  children: ReactNode;
}

interface State {
  error: ErrorRecord | null;
  saved: boolean | null;
  copied: boolean;
  /** 이 빌드에서 오류 보고를 보낼 수 있는지 */
  canReport: boolean;
  report: 'idle' | 'sending' | 'sent' | 'failed';
  alwaysSend: boolean;
}

/** 번역이 실패해도 안내 화면은 나와야 하므로 안전하게 감쌉니다. */
function safeTr(key: Parameters<typeof tr>[0], fallback: string): string {
  try {
    return tr(key);
  } catch {
    return fallback;
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, saved: null, copied: false, canReport: false, report: 'idle', alwaysSend: false };

  /**
   * 오류가 난 "바로 그 순간" 불립니다. 여기서 error 를 채워야 다음 그리기에서 안내 화면이 나옵니다.
   * (비워 두면 망가진 화면을 다시 그리다가 또 오류가 나서 화면 전체가 하얗게 사라집니다)
   */
  static getDerivedStateFromError(error: unknown): Partial<State> {
    const e = error instanceof Error ? error : new Error(String(error));
    return { error: { at: Date.now(), message: e.message || String(error), stack: e.stack }, saved: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const rec = recordError(error);
    rec.stack = `${rec.stack ?? ''}\n${info.componentStack ?? ''}`;
    this.setState({ error: rec });
    void emergencySave().then((saved) => this.setState({ saved }));
    void reportingAvailable().then((canReport) => this.setState({ canReport }));
    // "자동으로 보내기"를 켜 둔 사용자라면 바로 보냅니다.
    void autoReport(rec, { ...reportContext(), where: 'render' }).then((ok) => ok && this.setState({ report: 'sent' }));
  }

  private send = async () => {
    const { error, alwaysSend } = this.state;
    if (!error) return;
    if (alwaysSend) savePrefs({ errorReports: true });
    this.setState({ report: 'sending' });
    const ok = await sendReport(buildReport(error, { ...reportContext(), where: 'render' }));
    this.setState({ report: ok ? 'sent' : 'failed' });
  };

  private retry = () => {
    this.setState({ error: null, saved: null, copied: false, report: 'idle' });
  };

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(errorReport(this.state.error ?? undefined));
      this.setState({ copied: true });
    } catch {
      // 클립보드를 쓸 수 없으면 아무것도 하지 않습니다.
    }
  };

  render(): ReactNode {
    const { error, saved, copied, canReport, report, alwaysSend } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <div className="crash-emoji">😵</div>
          <h1>{safeTr('crash.title', 'Something went wrong')}</h1>
          <p>{safeTr('crash.body', 'The editor hit an unexpected error.')}</p>
          <p className={saved ? 'crash-saved' : 'crash-unsaved'}>
            {saved === null
              ? safeTr('crash.saving', 'Saving your work…')
              : saved
                ? safeTr('crash.saved', 'Your work was auto-saved.')
                : safeTr('crash.notSaved', 'Auto-save failed.')}
          </p>
          <div className="crash-actions">
            <button type="button" className="btn" onClick={this.retry}>
              {safeTr('crash.retry', 'Try again')}
            </button>
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              {safeTr('crash.reload', 'Reload & restore')}
            </button>
            <button type="button" className="btn ghost" onClick={() => void this.copy()}>
              {copied ? safeTr('crash.copied', 'Copied!') : safeTr('crash.copy', 'Copy error details')}
            </button>
          </div>
          {canReport && (
            <div className="crash-report">
              {report === 'sent' ? (
                <p className="crash-saved">{safeTr('crash.reportSent', 'Sent. Thank you!')}</p>
              ) : (
                <>
                  <p>{safeTr('crash.reportAsk', 'Send this error to the developer? (No drawings or file names are sent.)')}</p>
                  <label className="crash-always">
                    <input type="checkbox" checked={alwaysSend} onChange={(e) => this.setState({ alwaysSend: e.target.checked })} />{' '}
                    {safeTr('crash.reportAlways', 'Always send errors automatically')}
                  </label>
                  <button type="button" className="btn" disabled={report === 'sending'} onClick={() => void this.send()}>
                    {report === 'failed' ? safeTr('crash.reportRetry', 'Failed – try again') : safeTr('crash.reportSend', 'Send to developer')}
                  </button>
                </>
              )}
            </div>
          )}
          <details className="crash-details">
            <summary>{safeTr('crash.details', 'Details')}</summary>
            <pre>{`${error.message}\n${error.stack ?? ''}`}</pre>
          </details>
        </div>
      </div>
    );
  }
}
