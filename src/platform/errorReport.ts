/**
 * 오류 보고 (사용자 동의가 있을 때만)
 * ------------------------------------------------------------
 * 원칙
 *  1) 기본은 꺼짐. 사용자가 설정에서 켜거나, 오류 화면에서 "보내기"를 직접 눌렀을 때만 보냅니다.
 *  2) 그림, 프로젝트 내용, 파일 이름은 보내지 않습니다. 보내는 것: 오류 메시지/위치(stack),
 *     앱 버전, 운영체제·브라우저 종류, 언어, 지금 쓰던 도구.
 *  3) 메시지 안의 개인 정보처럼 보이는 것(이메일, 컴퓨터 사용자 폴더 경로)은 지우고 보냅니다.
 *  4) 보내는 주소는 빌드할 때 정해집니다. (웹: VITE_ERROR_REPORT_URL, 데스크톱: PIXEL_EDITOR_ERROR_REPORT_URL)
 *     주소가 없는 빌드에서는 이 기능 자체가 보이지 않습니다.
 *  5) 같은 오류는 한 번만, 한 번 실행에 최대 5개까지만 보냅니다.
 */
import { loadPrefs } from '../store/prefs';
import { isDesktop } from './desktop';

export interface ErrorReport {
  app: 'pixel-editor';
  version: string;
  platform: 'web' | 'desktop';
  userAgent: string;
  language: string;
  time: string;
  message: string;
  stack: string;
  /** 지금 쓰던 도구 같은 짧은 상황 정보 */
  context: Record<string, string | number | boolean>;
}

export interface ErrorLike {
  message: string;
  stack?: string;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_PER_SESSION = 5;

/**
 * 개인 정보처럼 보이는 부분 지우기
 *  - 이메일 주소 → <email>
 *  - /Users/이름/, /home/이름/, C:\Users\이름\ → <user>
 *  - file:// 로 시작하는 로컬 경로 → file://<path>
 *  - 주소의 ?쿼리 부분 → ?<q>
 */
export function scrub(text: string, max = MAX_MESSAGE): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/file:\/\/[^\s)'"]+/gi, 'file://<path>')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1<user>')
    .replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1<user>')
    .replace(/(https?:\/\/[^\s?#)]+)\?[^\s#)]*/g, '$1?<q>');
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

export function buildReport(err: ErrorLike, context: ErrorReport['context'] = {}): ErrorReport {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    app: 'pixel-editor',
    version: __APP_VERSION__,
    platform: isDesktop() ? 'desktop' : 'web',
    userAgent: nav?.userAgent ?? 'unknown',
    language: nav?.language ?? 'unknown',
    time: new Date().toISOString(),
    message: scrub(err.message || 'Unknown error'),
    stack: scrub(err.stack ?? '', MAX_STACK),
    context,
  };
}

function webUrl(): string | null {
  const url = (import.meta.env.VITE_ERROR_REPORT_URL ?? '').trim();
  return /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) ? url : null;
}

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!t) return Promise.reject(new Error('not in desktop app'));
  return t.invoke(cmd, args) as Promise<T>;
}

let availableCache: Promise<boolean> | null = null;

/** 이 빌드에 오류 보고 주소가 설정되어 있는지 */
export function reportingAvailable(): Promise<boolean> {
  if (!availableCache) {
    availableCache = isDesktop() ? tauriInvoke<boolean>('error_report_available').catch(() => false) : Promise.resolve(!!webUrl());
  }
  return availableCache;
}

const sent = new Set<string>();

/** 같은 오류인지 구분하는 지문 (메시지 + stack 첫 줄) */
function fingerprint(r: ErrorReport): string {
  return `${r.message}|${r.stack.split('\n').find((l) => l.trim().startsWith('at ')) ?? ''}`;
}

/** 이번 실행에서 더 보내도 되는지 (같은 오류 반복 · 너무 많은 전송 방지) */
export function shouldSend(r: ErrorReport): boolean {
  if (sent.size >= MAX_PER_SESSION) return false;
  return !sent.has(fingerprint(r));
}

/** 테스트용: 전송 기록 지우기 */
export function resetReportLimits(): void {
  sent.clear();
  availableCache = null;
}

/** 보고서 보내기. 성공하면 true (실패해도 앱 사용에는 영향 없음) */
export async function sendReport(r: ErrorReport): Promise<boolean> {
  if (!shouldSend(r)) return false;
  if (!(await reportingAvailable())) return false;
  sent.add(fingerprint(r));
  try {
    if (isDesktop()) {
      await tauriInvoke('error_report_send', { report: r });
      return true;
    }
    const url = webUrl();
    if (!url) return false;
    // text/plain 으로 보내면 브라우저가 사전 확인(CORS preflight) 없이 바로 보냅니다. 내용은 JSON 입니다.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(r),
      credentials: 'omit',
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 사용자가 "자동으로 보내기"를 켰을 때만 보냅니다. */
export function autoReport(err: ErrorLike, context?: ErrorReport['context']): Promise<boolean> {
  if (loadPrefs().errorReports !== true) return Promise.resolve(false);
  return sendReport(buildReport(err, context));
}
