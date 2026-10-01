/**
 * 화면 오류 보호막 (Error Boundary)
 * ------------------------------------------------------------
 * 화면을 그리다가 오류가 나면 React 는 화면 전체를 지워 버립니다.
 * 이 컴포넌트가 그 오류를 잡아서
 *  1) 작업을 비상 자동 저장하고
 *  2) "문제가 생겼어요" 안내 화면과 복구 버튼을 보여줍니다.
 *
 * (React 의 오류 보호막은 아직 클래스 컴포넌트로만 만들 수 있습니다)
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { emergencySave, errorReport, recordError, type ErrorRecord } from '../editor/crashGuard';
import { tr } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: ErrorRecord | null;
  saved: boolean | null;
  copied: boolean;
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
  state: State = { error: null, saved: null, copied: false };

  static getDerivedStateFromError(): Partial<State> {
    return { saved: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const rec = recordError(error);
    rec.stack = `${rec.stack ?? ''}\n${info.componentStack ?? ''}`;
    this.setState({ error: rec });
    void emergencySave().then((saved) => this.setState({ saved }));
  }

  private retry = () => {
    this.setState({ error: null, saved: null, copied: false });
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
    const { error, saved, copied } = this.state;
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
          <details className="crash-details">
            <summary>{safeTr('crash.details', 'Details')}</summary>
            <pre>{`${error.message}\n${error.stack ?? ''}`}</pre>
          </details>
        </div>
      </div>
    );
  }
}
