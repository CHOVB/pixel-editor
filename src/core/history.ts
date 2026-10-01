/**
 * 실행 취소 / 다시 실행 (Undo / Redo)
 * ------------------------------------------------------------
 * "명령(Command) 패턴"을 사용합니다.
 * 모든 변경 작업은 undo() 와 redo() 함수를 가진 기록(HistoryEntry)으로 저장됩니다.
 *
 * 픽셀을 그린 경우에는 캔버스 전체를 저장하지 않고,
 * "바뀐 부분(사각형 영역)"의 변경 전/후 픽셀만 저장해서 메모리를 아낍니다. (PixelPatch)
 */

export interface HistoryEntry {
  /** 메뉴에 "실행 취소: 연필" 처럼 표시될 이름 */
  label: string;
  undo: () => void;
  redo: () => void;
}

export class History {
  private entries: HistoryEntry[] = [];
  /** 지금까지 "적용된" 기록의 개수. entries[index-1] 이 가장 최근 작업입니다. */
  private index = 0;

  constructor(private readonly limit = 300) {}

  push(entry: HistoryEntry): void {
    // 실행 취소한 뒤 새 작업을 하면, 다시 실행할 수 있던 기록은 버립니다.
    this.entries.splice(this.index);
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.shift();
    }
    this.index = this.entries.length;
  }

  undo(): HistoryEntry | null {
    if (!this.canUndo()) return null;
    this.index--;
    const entry = this.entries[this.index];
    entry.undo();
    return entry;
  }

  redo(): HistoryEntry | null {
    if (!this.canRedo()) return null;
    const entry = this.entries[this.index];
    entry.redo();
    this.index++;
    return entry;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.entries.length;
  }

  undoLabel(): string | null {
    return this.canUndo() ? this.entries[this.index - 1].label : null;
  }

  redoLabel(): string | null {
    return this.canRedo() ? this.entries[this.index].label : null;
  }

  clear(): void {
    this.entries = [];
    this.index = 0;
  }

  get size(): number {
    return this.entries.length;
  }
}

/** 픽셀 변경 기록: 바뀐 사각형 영역의 변경 전/후 픽셀 */
export interface PixelPatch {
  x: number;
  y: number;
  w: number;
  h: number;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

/**
 * 두 버퍼를 비교해서 달라진 영역만 잘라낸 패치를 만듭니다.
 * 바뀐 것이 없으면 null 을 돌려줍니다.
 */
export function diffBuffers(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
): PixelPatch | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        before[i] !== after[i] ||
        before[i + 1] !== after[i + 1] ||
        before[i + 2] !== after[i + 2] ||
        before[i + 3] !== after[i + 3]
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return {
    x: minX,
    y: minY,
    w,
    h,
    before: extractRect(before, width, minX, minY, w, h),
    after: extractRect(after, width, minX, minY, w, h),
  };
}

function extractRect(
  buf: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * width + x) * 4;
    out.set(buf.subarray(start, start + w * 4), row * w * 4);
  }
  return out;
}

/** 패치를 대상 버퍼에 적용합니다. which='before' 면 실행 취소, 'after' 면 다시 실행 */
export function applyPatch(
  target: Uint8ClampedArray,
  width: number,
  patch: PixelPatch,
  which: 'before' | 'after',
): void {
  const src = which === 'before' ? patch.before : patch.after;
  for (let row = 0; row < patch.h; row++) {
    const start = ((patch.y + row) * width + patch.x) * 4;
    target.set(src.subarray(row * patch.w * 4, (row + 1) * patch.w * 4), start);
  }
}
