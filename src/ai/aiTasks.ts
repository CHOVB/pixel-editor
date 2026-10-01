/**
 * Codex 로 하는 작업들 (이미지 준비 → Codex 실행 → 도트로 되돌리기)
 * ------------------------------------------------------------
 *  - 가려진 부분 채우기 (파츠 분리 후 몸통 빈 곳)
 *  - 중간 프레임 생성 (AI 방식)
 *  - 새 스프라이트 생성 (설명 → 이미지 → 도트 정리)
 *  - 애니메이션 다듬기 (뼈대로 만든 프레임 → 손으로 그린 도트처럼)
 *
 * AI 는 큰 해상도의 그림을 돌려주므로, 항상 "원래 도트 크기로 축소 + 기존 색으로 맞추기" 를 거칩니다.
 * 그래서 결과가 기존 그림의 팔레트와 도트 크기에 딱 맞게 들어갑니다.
 */
import { downscale, mapToPalette } from '../core/effects';
import { upscaleInteger, uniqueColors } from '../core/pixels';
import { cropBuffer } from '../core/pixelfix';
import type { Color } from '../core/types';
import { bufferToPngBlob, decodeImageFile } from '../platform/canvas';
import { planLayout, postProcess, buildSheet, sheetSize } from '../core/aiPolish';
import { contentBounds } from '../core/pixels';
import { generatePrompt, inbetweenPrompt, inpaintPrompt, polishPrompt, runCodexJob } from './codex';

/** AI 가 보기 좋은 크기(약 512px)가 되도록 정수 배율 결정 */
export function chooseScale(w: number, h: number, target = 512): number {
  return Math.max(2, Math.min(32, Math.floor(target / Math.max(w, h))));
}

async function png(buf: Uint8ClampedArray, w: number, h: number, scale: number): Promise<Blob> {
  return bufferToPngBlob(upscaleInteger(buf, w, h, scale), w * scale, h * scale);
}

/** AI 결과 이미지를 원래 도트 크기로 줄이고, 주어진 색들로만 칠합니다. */
export async function toPixelArt(blob: Blob, w: number, h: number, palette: Color[]): Promise<Uint8ClampedArray> {
  const img = await decodeImageFile(blob);
  let small = downscale(img.pixels, img.width, img.height, w, h, 'mode');
  for (let i = 3; i < small.length; i += 4) small[i] = small[i] >= 128 ? 255 : 0;
  if (palette.length > 0) small = mapToPalette(small, w, h, palette, 'none', 0, 'perceptual');
  return small;
}

export interface AiProgress {
  onLog?: (log: string) => void;
  signal?: AbortSignal;
}

/**
 * 가려진 부분을 Codex 로 채웁니다.
 * body: 파츠를 잘라낸 뒤의 몸통 레이어, part: 잘라낸 파츠, mask: 채울 곳
 * 돌려주는 값: body 크기의 그림 (mask 부분만 합쳐서 쓰세요)
 */
export async function codexFillOccluded(
  body: Uint8ClampedArray,
  part: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  extra: string,
  progress: AiProgress = {},
): Promise<Uint8ClampedArray> {
  const scale = chooseScale(w, h);
  const marked = new Uint8ClampedArray(body);
  const maskImg = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < mask.length; i++) {
    const k = i * 4;
    if (mask[i]) {
      marked[k] = 255;
      marked[k + 1] = 0;
      marked[k + 2] = 255;
      marked[k + 3] = 255;
    }
    const v = mask[i] ? 255 : 0;
    maskImg[k] = v;
    maskImg[k + 1] = v;
    maskImg[k + 2] = v;
    maskImg[k + 3] = 255;
  }
  const palette = uniqueColors(body, 256).concat(uniqueColors(part, 256));
  const blob = await runCodexJob(
    {
      task: 'inpaint',
      prompt: inpaintPrompt(scale, w * scale, h * scale, extra),
      images: [
        { name: 'body.png', png: await png(marked, w, h, scale) },
        { name: 'mask.png', png: await png(maskImg, w, h, scale) },
        { name: 'part.png', png: await png(part, w, h, scale) },
      ],
    },
    progress.onLog,
    progress.signal,
  );
  return toPixelArt(blob, w, h, Array.from(new Set(palette)));
}

/** A → B 사이 중간 프레임을 Codex 로 그립니다. */
export async function codexInbetween(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  w: number,
  h: number,
  count: number,
  extra: string,
  progress: AiProgress = {},
): Promise<Uint8ClampedArray[]> {
  const scale = chooseScale(w, h);
  const blob = await runCodexJob(
    {
      task: 'inbetween',
      prompt: inbetweenPrompt(scale, w * scale, h * scale, count, extra),
      images: [
        { name: 'start.png', png: await png(a, w, h, scale) },
        { name: 'end.png', png: await png(b, w, h, scale) },
      ],
    },
    progress.onLog,
    progress.signal,
  );
  const palette = Array.from(new Set([...uniqueColors(a, 256), ...uniqueColors(b, 256)]));
  const strip = await toPixelArt(blob, w * count, h, palette);
  return Array.from({ length: count }, (_, i) => cropBuffer(strip, w * count, { x: i * w, y: 0, w, h }));
}

/** 설명으로 새 스프라이트 이미지를 만듭니다. (결과는 큰 이미지 → 도트 정리 기능으로 이어서 사용) */
export async function codexGenerateSprite(description: string, sizeHint: number, progress: AiProgress = {}): Promise<Blob> {
  return runCodexJob({ task: 'generate', prompt: generatePrompt(description, sizeHint), images: [] }, progress.onLog, progress.signal);
}

export interface PolishOptions {
  extra: string;
  /** 움직이지 않는 곳을 프레임마다 똑같이 (깜빡임 줄이기) */
  stabilize: boolean;
}

/**
 * 뼈대로 만든 프레임들을 Codex 로 손그림처럼 다듬습니다.
 * guides: 다듬을 프레임들 (캔버스 크기), reference: 원래 캐릭터 그림 (기본 자세, 캔버스 크기)
 * 돌려주는 값: 다듬은 프레임들 (캔버스 크기, 원래 그림의 색으로만)
 */
export async function codexPolishFrames(
  guides: Uint8ClampedArray[],
  reference: Uint8ClampedArray,
  w: number,
  h: number,
  opts: PolishOptions,
  progress: AiProgress = {},
): Promise<Uint8ClampedArray[]> {
  const layout = planLayout(guides, w, h);
  if (!layout) throw new Error('nothing to polish');
  const size = sheetSize(layout);
  const sheet = buildSheet(guides, w, layout);
  // 기준 그림: 그림이 있는 곳만 잘라서 같은 배율로
  const rb = contentBounds(reference, w, h) ?? { x: 0, y: 0, w, h };
  const ref = cropBuffer(reference, w, rb);
  // 쓸 수 있는 색: 원래 그림 + 프레임들에 실제로 쓰인 색 (뒤쪽 팔다리의 어두운 색, 번쩍임 등)
  const palette = Array.from(new Set([...uniqueColors(reference, 256), ...guides.flatMap((g) => uniqueColors(g, 64))])).slice(0, 256);
  const blob = await runCodexJob(
    {
      task: 'polish',
      prompt: polishPrompt({ count: guides.length, cols: layout.cols, rows: layout.rows, cellW: layout.crop.w, cellH: layout.crop.h, scale: layout.scale, extra: opts.extra }),
      images: [
        { name: 'frames.png', png: await png(sheet, size.w, size.h, layout.scale) },
        { name: 'character.png', png: await png(ref, rb.w, rb.h, layout.scale) },
      ],
    },
    progress.onLog,
    progress.signal,
  );
  const img = await decodeImageFile(blob);
  return postProcess(img.pixels, img.width, img.height, layout, guides, w, h, palette, { stabilize: opts.stabilize });
}
