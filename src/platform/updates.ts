/**
 * 자동 업데이트 (데스크톱 앱 전용)
 * ------------------------------------------------------------
 * Rust 쪽 명령(src-tauri/src/main.rs 의 update_*)을 부릅니다.
 *  - 새 버전 정보는 GitHub 릴리스의 latest.json 에서 받아 옵니다.
 *  - 받은 파일은 앱에 들어 있는 "공개 키"로 서명을 확인한 뒤에만 설치합니다. (가짜 업데이트 차단)
 *  - 공개 키가 설정되지 않은 빌드에서는 configured=false 로 아무 일도 하지 않습니다.
 *
 * 웹 버전(PWA)은 서비스 워커가 알아서 최신 파일을 받으므로 이 기능이 필요 없습니다.
 */
import { loadPrefs, savePrefs } from '../store/prefs';
import { isDesktop } from './desktop';

export interface UpdateInfo {
  configured: boolean;
  current: string;
  available: boolean;
  version: string | null;
  notes: string | null;
  date: string | null;
}

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!t) return Promise.reject(new Error('not in desktop app'));
  return t.invoke(cmd, args) as Promise<T>;
}

const NOT_CONFIGURED: UpdateInfo = { configured: false, current: __APP_VERSION__, available: false, version: null, notes: null, date: null };

/** 업데이트 기능이 켜진 빌드인지 (네트워크 사용 없음) */
export async function updateStatus(): Promise<UpdateInfo> {
  if (!isDesktop()) return NOT_CONFIGURED;
  try {
    return await invoke<UpdateInfo>('update_status');
  } catch {
    return NOT_CONFIGURED;
  }
}

/** 새 버전 확인 (인터넷 필요) */
export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!isDesktop()) return NOT_CONFIGURED;
  const info = await invoke<UpdateInfo>('update_check');
  savePrefs({ lastUpdateCheck: Date.now() });
  return info;
}

/**
 * 새 버전을 받아서 설치. onProgress(받은 비율 0~1, 전체 크기를 모르면 null)
 * 끝나면 true. (Windows 는 설치 프로그램이 앱을 닫고 설치합니다)
 */
export async function installUpdate(onProgress: (ratio: number | null, bytes: number) => void): Promise<boolean> {
  let done = false;
  const poll = async () => {
    while (!done) {
      try {
        const [got, total] = await invoke<[number, number | null]>('update_progress');
        onProgress(total ? Math.min(1, got / total) : null, got);
      } catch {
        // 무시하고 계속
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  void poll();
  try {
    return await invoke<boolean>('update_install');
  } finally {
    done = true;
  }
}

export function restartApp(): Promise<void> {
  return invoke<void>('update_restart');
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * 앱을 켤 때 하루에 한 번 조용히 새 버전 확인.
 * 설정에서 끌 수 있고, 업데이트 기능이 없는 빌드에서는 아무 일도 하지 않습니다.
 */
export async function backgroundUpdateCheck(now = Date.now()): Promise<UpdateInfo | null> {
  const prefs = loadPrefs();
  if (prefs.autoUpdateCheck === false) return null;
  if (prefs.lastUpdateCheck && now - prefs.lastUpdateCheck < DAY) return null;
  const status = await updateStatus();
  if (!status.configured) return null;
  try {
    const info = await checkForUpdate();
    return info.available ? info : null;
  } catch {
    return null; // 인터넷이 없을 때 등은 조용히 넘어갑니다
  }
}
