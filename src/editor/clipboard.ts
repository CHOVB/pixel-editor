/**
 * 복사 / 잘라내기 / 붙여넣기
 * ------------------------------------------------------------
 *  - 프로그램 안 복사: 선택 영역(없으면 레이어 전체)의 픽셀을 기억합니다.
 *  - 다른 프로그램과의 복사: 가능하면 시스템 클립보드에 PNG 로도 넣어 둡니다.
 *  - 붙여넣기 후에는 자동으로 "이동 도구"로 바뀌어서 바로 위치를 옮길 수 있습니다.
 */
import { cloneBuffer, createBuffer, blitBuffer } from '../core/pixels';
import { ensureCel } from '../core/project';
import { fullMask, selectionFromMask } from '../core/selection';
import { tr } from '../i18n';
import { bufferToPngBlob, decodeImageFile } from '../platform/canvas';
import { canEditCurrentLayer, clearSelectionPixels, commitPixels, currentFrameObj, notify } from '../store/actions';
import { getState, setState } from '../store/editorStore';
import { moveTool } from '../tools';
import { requestRender } from './renderBus';

interface ClipboardData {
  width: number;
  height: number;
  /** 캔버스 크기 픽셀 (원래 위치 그대로) */
  pixels: Uint8ClampedArray;
  mask: Uint8Array;
}

let clip: ClipboardData | null = null;

export function hasClipboard(): boolean {
  return clip !== null;
}

export function copySelection(): boolean {
  const s = getState();
  const p = s.project;
  const frame = currentFrameObj();
  const cel = ensureCel(p, s.currentLayerId, frame.id);
  const mask = s.selection?.mask ?? fullMask(p.width * p.height);
  const pixels = createBuffer(p.width, p.height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    pixels[i * 4] = cel[i * 4];
    pixels[i * 4 + 1] = cel[i * 4 + 1];
    pixels[i * 4 + 2] = cel[i * 4 + 2];
    pixels[i * 4 + 3] = cel[i * 4 + 3];
  }
  clip = { width: p.width, height: p.height, pixels, mask: new Uint8Array(mask) };
  void writeSystemClipboard(pixels, mask, p.width, p.height);
  notify(tr('toast.copied'));
  return true;
}

export function cutSelection(): void {
  if (!canEditCurrentLayer()) return;
  if (copySelection()) clearSelectionPixels(tr('history.cut'));
}

/** 시스템 클립보드에 선택 영역 크기의 PNG 를 넣습니다. (지원하지 않으면 조용히 무시) */
async function writeSystemClipboard(pixels: Uint8ClampedArray, mask: Uint8Array, width: number, height: number) {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
    const sel = selectionFromMask(mask, width, height);
    if (!sel) return;
    const { x, y, w, h } = sel.bounds;
    const out = createBuffer(w, h);
    for (let row = 0; row < h; row++) {
      out.set(pixels.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
    }
    const blob = await bufferToPngBlob(out, w, h);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    // 권한이 없거나 지원하지 않는 브라우저 → 프로그램 안 복사만 사용
  }
}

/** 픽셀(캔버스 크기, mask 위치)을 현재 셀 위에 "떠 있는 상태"로 붙여넣습니다. */
function pasteFloating(pixels: Uint8ClampedArray, mask: Uint8Array): void {
  if (!canEditCurrentLayer()) return;
  const s = getState();
  const p = s.project;
  const frame = currentFrameObj();
  const cel = ensureCel(p, s.currentLayerId, frame.id);
  const before = cloneBuffer(cel);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || pixels[i * 4 + 3] === 0) continue;
    cel[i * 4] = pixels[i * 4];
    cel[i * 4 + 1] = pixels[i * 4 + 1];
    cel[i * 4 + 2] = pixels[i * 4 + 2];
    cel[i * 4 + 3] = pixels[i * 4 + 3];
  }
  const selBefore = s.selection;
  const selAfter = selectionFromMask(mask, p.width, p.height);
  setState({ selection: selAfter, tool: 'move' });
  commitPixels(tr('history.paste'), s.currentLayerId, frame.id, before, { before: selBefore, after: selAfter });
  // 이동 도구가 "붙여넣은 픽셀만" 들고 있도록 설정 → 옮겨도 아래 그림이 지워지지 않습니다.
  moveTool.setLift({
    layerId: s.currentLayerId,
    frameId: frame.id,
    base: before,
    floating: pixels,
    mask,
    dx: 0,
    dy: 0,
  });
  requestRender();
  notify(tr('toast.pasted'));
}

export function pasteInternal(): boolean {
  const p = getState().project;
  if (!clip) return false;
  if (clip.width === p.width && clip.height === p.height) {
    pasteFloating(cloneBuffer(clip.pixels), new Uint8Array(clip.mask));
    return true;
  }
  // 캔버스 크기가 바뀐 경우: 왼쪽 위에 맞춰 붙여넣기
  const pixels = createBuffer(p.width, p.height);
  blitBuffer(clip.pixels, clip.width, clip.height, pixels, p.width, p.height, 0, 0);
  const mask = new Uint8Array(p.width * p.height);
  for (let y = 0; y < Math.min(clip.height, p.height); y++) {
    for (let x = 0; x < Math.min(clip.width, p.width); x++) mask[y * p.width + x] = clip.mask[y * clip.width + x];
  }
  pasteFloating(pixels, mask);
  return true;
}

/** 외부 이미지(시스템 클립보드/드래그)를 붙여넣기: 화면 왼쪽 위에 놓습니다. */
export async function pasteImageBlob(blob: Blob): Promise<void> {
  try {
    const image = await decodeImageFile(blob);
    const p = getState().project;
    const pixels = createBuffer(p.width, p.height);
    blitBuffer(image.pixels, image.width, image.height, pixels, p.width, p.height, 0, 0);
    const mask = new Uint8Array(p.width * p.height);
    for (let y = 0; y < Math.min(image.height, p.height); y++) {
      for (let x = 0; x < Math.min(image.width, p.width); x++) mask[y * p.width + x] = 1;
    }
    pasteFloating(pixels, mask);
    if (image.width > p.width || image.height > p.height) notify(tr('toast.imageCropped'));
  } catch (err) {
    console.error(err);
    notify(tr('toast.openFailed'), 'error');
  }
}

/** 메뉴의 "붙여넣기": 프로그램 안 클립보드 → 없으면 시스템 클립보드 이미지 */
export async function pasteFromMenu(): Promise<void> {
  if (pasteInternal()) return;
  try {
    if (!navigator.clipboard?.read) throw new Error('unsupported');
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        await pasteImageBlob(await item.getType(type));
        return;
      }
    }
  } catch {
    // 무시하고 아래 안내
  }
  notify(tr('toast.clipboardEmpty'), 'error');
}
