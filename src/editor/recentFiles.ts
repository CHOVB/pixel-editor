/**
 * 최근 파일 목록
 * ------------------------------------------------------------
 * 열거나 저장한 프로젝트 파일을 최대 8개까지 기억합니다.
 *  - 크롬/엣지 등 "파일 시스템 접근"을 지원하는 브라우저와 데스크톱 앱에서는
 *    파일 위치(핸들)까지 기억해서 클릭 한 번으로 다시 열 수 있습니다.
 *  - 지원하지 않는 브라우저에서는 이름만 보여 주고, 열기 창을 띄워 줍니다.
 * 목록은 IndexedDB 에 저장합니다. (핸들은 localStorage 에 저장할 수 없기 때문)
 */
import { create } from 'zustand';
import { desktopRead, isDesktop, isDesktopHandle } from '../platform/desktop';
import { kvGet, kvSet } from '../platform/storage';

export interface RecentFile {
  /** 목록 구분용 (파일 이름 + 크기) */
  key: string;
  name: string;
  openedAt: number;
  width: number;
  height: number;
  frames: number;
  /** 작은 미리보기 그림 (data URL) */
  thumb?: string;
  /** 다시 열 때 사용하는 파일 핸들 (지원 브라우저만) */
  handle?: FileSystemFileHandle;
  /** 데스크톱 앱에서는 파일 경로를 기억합니다 */
  path?: string;
}

const KEY = 'recent-files';
const MAX = 8;

interface RecentState {
  list: RecentFile[];
  loaded: boolean;
}

export const useRecent = create<RecentState>(() => ({ list: [], loaded: false }));

export async function loadRecentFiles(): Promise<RecentFile[]> {
  try {
    const list = (await kvGet<RecentFile[]>(KEY)) ?? [];
    useRecent.setState({ list, loaded: true });
    return list;
  } catch {
    useRecent.setState({ loaded: true });
    return [];
  }
}

async function save(list: RecentFile[]): Promise<void> {
  useRecent.setState({ list });
  try {
    await kvSet(KEY, list);
  } catch {
    // 핸들을 저장할 수 없는 브라우저면 핸들을 빼고 다시 시도합니다.
    try {
      await kvSet(
        KEY,
        list.map(({ handle: _handle, ...rest }) => rest),
      );
    } catch {
      // 저장소를 쓸 수 없으면 이번 실행 동안만 기억합니다.
    }
  }
}

export async function addRecentFile(input: Omit<RecentFile, 'key' | 'openedAt'>): Promise<void> {
  // 데스크톱 핸들은 함수가 들어 있어 저장할 수 없으므로 경로만 남깁니다.
  const entry = isDesktopHandle(input.handle) ? { ...input, path: input.handle.path, handle: undefined } : input;
  const key = entry.path ?? entry.name;
  const list = useRecent.getState().list.filter((r) => r.key !== key);
  list.unshift({ ...entry, key, openedAt: Date.now() });
  await save(list.slice(0, MAX));
}

export async function removeRecentFile(key: string): Promise<void> {
  await save(useRecent.getState().list.filter((r) => r.key !== key));
}

export async function clearRecentFiles(): Promise<void> {
  await save([]);
}

interface PermissionHandle {
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * 기억해 둔 핸들로 파일 읽기. 브라우저가 권한을 다시 물어볼 수 있습니다.
 * 권한이 없거나 파일이 옮겨졌으면 null.
 */
export async function readRecentFile(entry: RecentFile): Promise<File | null> {
  if (entry.path && isDesktop()) {
    try {
      return (await desktopRead(entry.path)).file;
    } catch {
      return null;
    }
  }
  const handle = entry.handle;
  if (!handle) return null;
  try {
    const h = handle as unknown as PermissionHandle;
    let perm: PermissionState = 'granted';
    if (h.queryPermission) perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && h.requestPermission) perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    return await handle.getFile();
  } catch {
    return null;
  }
}
