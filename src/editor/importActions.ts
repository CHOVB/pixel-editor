/**
 * 가져오기 기능
 * ------------------------------------------------------------
 *  - GIF 애니메이션 → 프레임별로 나눠서 프로젝트로
 *  - 스프라이트시트(한 장에 여러 프레임) → 칸을 잘라서 프레임으로
 *  - 밑그림(레퍼런스) 이미지 → 그림 뒤/앞에 반투명하게 깔기
 *  - 여러 장의 그림(배열) → 프레임으로 (AI 도트 정리 결과 등)
 */
import { decompressFrames, parseGIF } from 'gifuct-js';
import { blitBuffer, createBuffer, isBufferEmpty } from '../core/pixels';
import { addAsset, addLayerAbove, celKey, createFrame, createProject, MAX_CANVAS_SIZE } from '../core/project';
import type { Project } from '../core/types';
import { tr } from '../i18n';
import { decodeImageFile } from '../platform/canvas';
import { openFileDialog } from '../platform/fileio';
import { commitStructure, notify, replaceProject } from '../store/actions';
import { getState } from '../store/editorStore';

export interface DecodedFrame {
  pixels: Uint8ClampedArray;
  /** ms */
  delay: number;
}

/** GIF 파일 → 완성된 프레임 이미지들 (부분 갱신/지우기 방식까지 처리) */
export async function decodeGif(file: Blob): Promise<{ width: number; height: number; frames: DecodedFrame[] }> {
  const gif = parseGIF(await file.arrayBuffer());
  const parts = decompressFrames(gif, true);
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const canvas = createBuffer(width, height);
  const frames: DecodedFrame[] = [];
  let restore: Uint8ClampedArray | null = null;
  for (const part of parts) {
    const { left, top, width: pw, height: ph } = part.dims;
    if (part.disposalType === 3) restore = new Uint8ClampedArray(canvas);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const s = (y * pw + x) * 4;
        if (part.patch[s + 3] === 0) continue;
        const tx = left + x;
        const ty = top + y;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const d = (ty * width + tx) * 4;
        canvas[d] = part.patch[s];
        canvas[d + 1] = part.patch[s + 1];
        canvas[d + 2] = part.patch[s + 2];
        canvas[d + 3] = part.patch[s + 3];
      }
    }
    // gifuct-js 의 delay 는 이미 밀리초 단위입니다.
    frames.push({ pixels: new Uint8ClampedArray(canvas), delay: Math.max(20, part.delay || 100) });
    if (part.disposalType === 2) {
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const tx = left + x;
          const ty = top + y;
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const d = (ty * width + tx) * 4;
          canvas[d] = 0;
          canvas[d + 1] = 0;
          canvas[d + 2] = 0;
          canvas[d + 3] = 0;
        }
      }
    } else if (part.disposalType === 3 && restore) {
      canvas.set(restore);
    }
  }
  return { width, height, frames };
}

/** 그림 여러 장으로 새 프로젝트 만들기 */
export function projectFromFrames(frames: DecodedFrame[], width: number, height: number, name: string): Project {
  const s = getState();
  const project = createProject(width, height, { name, palette: s.project.palette, layerName: `${tr('layer.defaultName')} 1` });
  project.frames = frames.map((f) => createFrame(f.delay));
  const layerId = project.layers[0].id;
  frames.forEach((f, i) => {
    if (!isBufferEmpty(f.pixels)) project.cels[celKey(layerId, project.frames[i].id)] = f.pixels;
  });
  return project;
}

export interface SheetSlice {
  frameW: number;
  frameH: number;
  offsetX: number;
  offsetY: number;
  gapX: number;
  gapY: number;
  skipEmpty: boolean;
}

/** 스프라이트시트를 칸 단위로 잘라 프레임 목록 만들기 (왼쪽 위 → 오른쪽 → 다음 줄) */
export function sliceSheet(pixels: Uint8ClampedArray, width: number, height: number, s: SheetSlice): Uint8ClampedArray[] {
  const out: Uint8ClampedArray[] = [];
  const fw = Math.max(1, Math.round(s.frameW));
  const fh = Math.max(1, Math.round(s.frameH));
  for (let y = s.offsetY; y + fh <= height; y += fh + s.gapY) {
    for (let x = s.offsetX; x + fw <= width; x += fw + s.gapX) {
      const buf = createBuffer(fw, fh);
      for (let row = 0; row < fh; row++) {
        const start = ((y + row) * width + x) * 4;
        buf.set(pixels.subarray(start, start + fw * 4), row * fw * 4);
      }
      if (s.skipEmpty && isBufferEmpty(buf)) continue;
      out.push(buf);
    }
  }
  return out;
}

/** 프레임 그림들을 새 프로젝트로 열기 */
export function openFramesAsProject(frames: Uint8ClampedArray[], width: number, height: number, name: string, duration = 100): void {
  if (frames.length === 0) {
    notify(tr('toast.noFramesFound'), 'error');
    return;
  }
  replaceProject(
    projectFromFrames(
      frames.map((pixels) => ({ pixels, delay: duration })),
      width,
      height,
      name,
    ),
    null,
  );
  notify(tr('toast.framesImported', { count: frames.length }), 'success');
}

/** 프레임 그림들을 현재 프로젝트의 새 레이어로 (현재 프레임부터 차례로, 모자라면 프레임 추가) */
export function addFramesAsLayer(frames: Uint8ClampedArray[], width: number, height: number, name: string): void {
  commitStructure(tr('history.importImage'), (p) => {
    const layer = addLayerAbove(p, getState().currentLayerId, name);
    const start = getState().currentFrame;
    frames.forEach((f, i) => {
      while (start + i >= p.frames.length) p.frames.push(createFrame(p.frames[p.frames.length - 1].duration));
      const buf = createBuffer(p.width, p.height);
      blitBuffer(f, width, height, buf, p.width, p.height, 0, 0);
      if (!isBufferEmpty(buf)) p.cels[celKey(layer.id, p.frames[start + i].id)] = buf;
    });
    return { layerId: layer.id };
  });
  notify(tr('toast.framesImported', { count: frames.length }), 'success');
}

/** 밑그림(레퍼런스) 이미지 가져오기 */
export async function importReferenceImage(file?: File): Promise<void> {
  let f = file;
  if (!f) {
    const result = await openFileDialog(['image/*'], [{ description: 'Image', accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/gif': ['.gif'] } }]);
    if (!result) return;
    f = result.file;
  }
  try {
    const img = await decodeImageFile(f);
    const data = new Uint8Array(await f.arrayBuffer());
    const p = getState().project;
    // 캔버스에 꽉 차게 기본 배율 계산
    const scale = Math.min(p.width / img.width, p.height / img.height);
    commitStructure(tr('history.addReference'), (proj) => {
      const asset = addAsset(proj, f.name, f.type || 'image/png', data);
      const layer = addLayerAbove(proj, null, `${tr('layer.referenceName')}: ${f.name}`, 'reference');
      // 밑그림은 맨 아래에 두는 것이 자연스럽습니다.
      proj.layers.splice(proj.layers.indexOf(layer), 1);
      proj.layers.unshift(layer);
      layer.opacity = 0.5;
      layer.locked = true;
      layer.reference = {
        assetId: asset.id,
        x: Math.round((p.width - img.width * scale) / 2),
        y: Math.round((p.height - img.height * scale) / 2),
        scale,
        front: false,
      };
      return { layerId: getState().currentLayerId };
    });
    notify(tr('toast.referenceAdded'), 'success');
  } catch (err) {
    console.error(err);
    notify(tr('toast.openFailed'), 'error');
  }
}

/** GIF 파일을 새 프로젝트로 열기 */
export async function openGifAsProject(file: File): Promise<boolean> {
  const gif = await decodeGif(file);
  if (gif.width > MAX_CANVAS_SIZE || gif.height > MAX_CANVAS_SIZE) {
    notify(tr('toast.imageTooLarge', { max: MAX_CANVAS_SIZE }), 'error');
    return true;
  }
  if (gif.frames.length <= 1) return false;
  replaceProject(projectFromFrames(gif.frames, gif.width, gif.height, file.name.replace(/\.[^.]+$/, '')), null);
  notify(tr('toast.framesImported', { count: gif.frames.length }), 'success');
  return true;
}
