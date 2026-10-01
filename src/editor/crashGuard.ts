/**
 * 오류 대비 (Crash Guard)
 * ------------------------------------------------------------
 * 상용 프로그램은 "오류가 나도 작업을 잃지 않는 것"이 가장 중요합니다.
 *  - 예상하지 못한 오류가 생기면 즉시 비상 자동 저장을 합니다.
 *  - 최근 오류 몇 개를 기억해 두었다가 "오류 내용 복사"로 개발자에게 보낼 수 있게 합니다.
 *  - 사용자가 "오류 자동 보내기"를 켰다면 개인 정보를 지운 보고서를 보냅니다. (platform/errorReport.ts)
 *  - 화면이 통째로 멈추지 않는 오류(버튼 동작 중 오류 등)는 알림으로만 알려 줍니다.
 */
import { tr } from '../i18n';
import { autoReport } from '../platform/errorReport';
import { notify } from '../store/actions';
import { getState } from '../store/editorStore';
import { autosaveNow } from './fileActions';

export interface ErrorRecord {
  at: number;
  message: string;
  stack?: string;
}

const MAX_RECORDS = 20;
const records: ErrorRecord[] = [];
let lastNotifyAt = 0;

export function recordError(err: unknown): ErrorRecord {
  const e = err instanceof Error ? err : new Error(String(err));
  const rec: ErrorRecord = { at: Date.now(), message: e.message || String(err), stack: e.stack };
  records.push(rec);
  if (records.length > MAX_RECORDS) records.shift();
  return rec;
}

export function recentErrors(): ErrorRecord[] {
  return [...records];
}

/** 오류 보고서 (사용자가 복사해서 보낼 수 있는 글) */
export function errorReport(extra?: ErrorRecord): string {
  const list = extra && !records.includes(extra) ? [...records, extra] : records;
  const lines = [
    `Pixel Editor ${__APP_VERSION__}`,
    `${navigator.userAgent}`,
    `${new Date().toISOString()}`,
    '',
    ...list.map((r) => `[${new Date(r.at).toISOString()}] ${r.message}\n${r.stack ?? ''}`),
  ];
  return lines.join('\n');
}

/** 오류 보고에 함께 보낼 짧은 상황 정보 (그림 내용·파일 이름은 넣지 않음) */
export function reportContext(): Record<string, string | number | boolean> {
  try {
    const s = getState();
    return {
      tool: s.tool,
      layers: s.project.layers.length,
      frames: s.project.frames.length,
      size: `${s.project.width}x${s.project.height}`,
      renderer: s.activeRenderer ?? 'unknown',
      playing: s.playing,
    };
  } catch {
    return {};
  }
}

/** 저장 안 된 변경이 있으면 바로 자동 저장합니다. (오류가 났을 때) */
export async function emergencySave(): Promise<boolean> {
  try {
    await autosaveNow(true);
    return true;
  } catch {
    return false;
  }
}

/** 전역 오류 감시 시작 (App 에서 한 번 호출) */
export function installCrashGuard(): () => void {
  const handle = (err: unknown) => {
    const rec = recordError(err);
    void emergencySave();
    void autoReport(rec, reportContext());
    // 같은 오류가 연달아 나도 알림은 3초에 한 번만
    const now = Date.now();
    if (now - lastNotifyAt > 3000) {
      lastNotifyAt = now;
      notify(tr('crash.toast'), 'error');
    }
  };
  const onError = (e: ErrorEvent) => {
    // 이미지/스크립트 불러오기 실패 같은 "리소스 오류"는 무시합니다.
    if (!e.error && !e.message) return;
    handle(e.error ?? e.message);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    // 사용자가 파일 창을 닫은 경우 등은 오류가 아닙니다.
    if (reason instanceof DOMException && reason.name === 'AbortError') return;
    handle(reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
