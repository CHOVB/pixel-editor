/**
 * 데스크톱 앱(Tauri) 전용 기능
 * ------------------------------------------------------------
 * 데스크톱 앱 안에서는 브라우저의 파일 대화상자 대신 운영체제의 대화상자를 씁니다.
 * (Rust 쪽 명령: src-tauri/src/main.rs 의 desktop_* )
 * 웹 브라우저에서는 이 파일의 함수들이 쓰이지 않습니다.
 */
import { base64ToBytes, bytesToBase64 } from '../core/fileFormat';
import type { FileTypeOption, WritableHandle } from './fileio';

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauri(): TauriInternals | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ : undefined;
}

export function isDesktop(): boolean {
  return !!tauri();
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) return Promise.reject(new Error('not in desktop app'));
  return t.invoke(cmd, args) as Promise<T>;
}

interface DesktopFilter {
  name: string;
  extensions: string[];
}

/** 브라우저용 형식 목록 → 운영체제 대화상자용 확장자 목록 */
function toFilters(types?: FileTypeOption[], accept: string[] = []): DesktopFilter[] {
  const filters: DesktopFilter[] = (types ?? []).map((t) => ({
    name: t.description,
    extensions: Object.values(t.accept)
      .flat()
      .map((e) => e.replace(/^\./, '')),
  }));
  const loose = accept.filter((a) => a.startsWith('.')).map((a) => a.slice(1));
  if (filters.length === 0 && loose.length > 0) filters.push({ name: 'Files', extensions: loose });
  return filters;
}

/** 데스크톱 파일 핸들: 브라우저의 파일 핸들과 같은 모양이라 저장 코드를 그대로 쓸 수 있습니다. */
export interface DesktopHandle extends WritableHandle {
  path: string;
}

export function desktopHandle(path: string, name: string): DesktopHandle {
  return {
    name,
    path,
    async createWritable() {
      const parts: Blob[] = [];
      return {
        async write(data: Blob | string) {
          parts.push(typeof data === 'string' ? new Blob([data]) : data);
        },
        async close() {
          const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
          await invoke('desktop_write', { path, data: bytesToBase64(bytes) });
        },
      };
    },
  };
}

export function isDesktopHandle(h: unknown): h is DesktopHandle {
  return !!h && typeof (h as DesktopHandle).path === 'string';
}

/** 저장 대화상자 → 고른 파일에 바로 저장. 취소하면 null */
export async function desktopSave(blob: Blob, suggestedName: string, types: FileTypeOption[]): Promise<DesktopHandle | null> {
  const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  const r = await invoke<{ name: string; path: string } | null>('desktop_save', { suggestedName, data, filters: toFilters(types) });
  return r ? desktopHandle(r.path, r.name) : null;
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    bmp: 'image/bmp',
    pxe: 'application/json',
    json: 'application/json',
  };
  return map[ext] ?? 'application/octet-stream';
}

function toFile(r: { name: string; data: string }): File {
  return new File([base64ToBytes(r.data) as BlobPart], r.name, { type: guessMime(r.name) });
}

/** 열기 대화상자. 취소하면 null */
export async function desktopOpen(accept: string[], types?: FileTypeOption[]): Promise<{ file: File; handle: DesktopHandle } | null> {
  const r = await invoke<{ name: string; path: string; data: string } | null>('desktop_open', { filters: toFilters(types, accept) });
  return r ? { file: toFile(r), handle: desktopHandle(r.path, r.name) } : null;
}

/** 경로로 파일 읽기 (최근 파일 다시 열기) */
export async function desktopRead(path: string): Promise<{ file: File; handle: DesktopHandle }> {
  const r = await invoke<{ name: string; path: string; data: string }>('desktop_read', { path });
  return { file: toFile(r), handle: desktopHandle(r.path, r.name) };
}

/** 앱을 파일 더블클릭으로 실행했을 때 그 파일 */
export async function desktopLaunchFile(): Promise<{ file: File; handle: DesktopHandle } | null> {
  if (!isDesktop()) return null;
  const path = await invoke<string | null>('desktop_launch_file');
  return path ? desktopRead(path) : null;
}
