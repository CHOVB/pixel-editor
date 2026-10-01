/**
 * 파일 열기 / 저장
 * ------------------------------------------------------------
 * 크롬/엣지처럼 "파일 시스템 접근 API"를 지원하는 브라우저에서는
 * 진짜 프로그램처럼 같은 파일에 덮어쓰기 저장(Ctrl+S)이 가능합니다.
 * 지원하지 않는 브라우저(파이어폭스, 사파리)에서는 다운로드 방식으로 저장합니다.
 */

export interface FileTypeOption {
  description: string;
  /** 예: { 'image/png': ['.png'] } */
  accept: Record<string, string[]>;
}

/** 브라우저 파일 핸들 (지원하는 브라우저에서만 존재) */
export interface WritableHandle {
  name: string;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

interface FilePickerWindow {
  showSaveFilePicker?: (options: { suggestedName?: string; types?: FileTypeOption[] }) => Promise<WritableHandle>;
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: FileTypeOption[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<{ getFile(): Promise<File>; name: string }[]>;
}

const fsWindow = (typeof window !== 'undefined' ? window : {}) as unknown as FilePickerWindow;

export function supportsFileSystemAccess(): boolean {
  return typeof fsWindow.showSaveFilePicker === 'function';
}

/** 사용자가 대화상자를 취소했는지 확인 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** 다운로드 방식 저장 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SaveResult {
  /** 실제 저장된 파일 이름 */
  name: string;
  /** 다음에 같은 파일에 덮어쓸 때 쓸 핸들 (다운로드 방식이면 null) */
  handle: WritableHandle | null;
}

/**
 * 파일 저장. handle 이 있으면 그 파일에 바로 덮어쓰고,
 * 없으면 "다른 이름으로 저장" 대화상자를 띄웁니다. (미지원 브라우저는 다운로드)
 * 사용자가 취소하면 null 을 돌려줍니다.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  types: FileTypeOption[],
  handle: WritableHandle | null = null,
): Promise<SaveResult | null> {
  try {
    let target = handle;
    if (!target && fsWindow.showSaveFilePicker) {
      target = await fsWindow.showSaveFilePicker({ suggestedName, types });
    }
    if (target) {
      const writable = await target.createWritable();
      await writable.write(blob);
      await writable.close();
      return { name: target.name, handle: target };
    }
  } catch (err) {
    if (isAbortError(err)) return null;
    // 권한 문제 등으로 실패하면 다운로드 방식으로 대신 저장합니다.
    console.warn('File System Access 저장 실패, 다운로드로 대체합니다.', err);
  }
  downloadBlob(blob, suggestedName);
  return { name: suggestedName, handle: null };
}

export interface OpenResult {
  file: File;
  handle: WritableHandle | null;
}

/** 파일 열기 대화상자. accept 예: ['.pxe', '.png', 'image/*'] */
export async function openFileDialog(accept: string[], types?: FileTypeOption[]): Promise<OpenResult | null> {
  if (fsWindow.showOpenFilePicker && types) {
    try {
      const [handle] = await fsWindow.showOpenFilePicker({ multiple: false, types });
      const file = await handle.getFile();
      const writable = handle as unknown as Partial<WritableHandle>;
      return { file, handle: typeof writable.createWritable === 'function' ? (handle as unknown as WritableHandle) : null };
    } catch (err) {
      if (isAbortError(err)) return null;
      console.warn('File System Access 열기 실패, 기본 방식으로 대체합니다.', err);
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { file, handle: null } : null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
