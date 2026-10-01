/**
 * 내보내기 로직 (스프라이트시트, GIF)
 * ------------------------------------------------------------
 * 여기서는 "픽셀 데이터"만 만듭니다.
 * 실제 PNG 파일로 바꾸거나 다운로드하는 일은 platform 폴더가 담당합니다.
 */
import { applyPalette, GIFEncoder, quantize, type GifPalette } from 'gifenc';
import { blitBuffer, createBuffer, fillBuffer, upscaleInteger } from './pixels';
import { compositeFrame } from './render';
import type { Color, Project, Rect } from './types';

export type SheetLayout = 'horizontal' | 'vertical' | 'grid';

export interface SpriteSheetOptions {
  layout: SheetLayout;
  /** grid 일 때 한 줄에 놓을 프레임 수 */
  columns: number;
  /** 프레임 사이 간격 (확대 후 픽셀 기준) */
  padding: number;
  /** 정수 배율 */
  scale: number;
  /** 내보낼 프레임 인덱스 목록 */
  frames: number[];
  background?: Color | null;
}

export interface SpriteSheetResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** 각 프레임이 시트의 어디에 놓였는지 */
  rects: Rect[];
}

export function buildSpriteSheet(p: Project, opts: SpriteSheetOptions): SpriteSheetResult {
  const count = opts.frames.length;
  const fw = p.width * opts.scale;
  const fh = p.height * opts.scale;
  const cols =
    opts.layout === 'horizontal' ? count : opts.layout === 'vertical' ? 1 : Math.max(1, Math.min(count, opts.columns));
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * fw + (cols - 1) * opts.padding;
  const height = rows * fh + (rows - 1) * opts.padding;
  const pixels = createBuffer(width, height);
  if (opts.background != null) fillBuffer(pixels, opts.background);
  const rects: Rect[] = [];
  opts.frames.forEach((frameIndex, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (fw + opts.padding);
    const y = row * (fh + opts.padding);
    const frame = upscaleInteger(compositeFrame(p, frameIndex, { background: opts.background }), p.width, p.height, opts.scale);
    blitBuffer(frame, fw, fh, pixels, width, height, x, y);
    rects.push({ x, y, w: fw, h: fh });
  });
  return { pixels, width, height, rects };
}

/**
 * 게임 엔진에서 쓰기 좋은 JSON 메타데이터 (Aseprite JSON "array" 형식과 호환)
 * Unity, Godot, Phaser 등에서 프레임 위치/시간/태그를 읽을 수 있습니다.
 */
export function buildSpriteSheetJson(p: Project, opts: SpriteSheetOptions, sheet: SpriteSheetResult, imageName: string): string {
  const frames = opts.frames.map((frameIndex, i) => ({
    filename: `${p.name} ${frameIndex}`,
    frame: sheet.rects[i],
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: sheet.rects[i].w, h: sheet.rects[i].h },
    sourceSize: { w: sheet.rects[i].w, h: sheet.rects[i].h },
    duration: p.frames[frameIndex].duration,
  }));
  const tags = p.tags
    .map((t) => {
      const from = opts.frames.indexOf(t.from);
      const to = opts.frames.indexOf(t.to);
      return { name: t.name, from, to, direction: 'forward', color: t.color };
    })
    .filter((t) => t.from >= 0 && t.to >= 0);
  const data = {
    frames,
    meta: {
      app: 'pixel-editor',
      version: '0.1.0',
      image: imageName,
      format: 'RGBA8888',
      size: { w: sheet.width, h: sheet.height },
      scale: String(opts.scale),
      frameTags: tags,
    },
  };
  return JSON.stringify(data, null, 2);
}

export interface GifOptions {
  frames: number[];
  scale: number;
  /** true 면 무한 반복 */
  loop: boolean;
  /** null 이면 투명 배경 (GIF 투명은 켜짐/꺼짐 두 단계뿐입니다) */
  background: Color | null;
}

/** 애니메이션 GIF 파일 바이트를 만듭니다. */
export function encodeGif(p: Project, opts: GifOptions): Uint8Array {
  const w = p.width * opts.scale;
  const h = p.height * opts.scale;
  const frames = opts.frames.map((fi) =>
    upscaleInteger(compositeFrame(p, fi, { background: opts.background }), p.width, p.height, opts.scale),
  );

  // 1) 모든 프레임에서 쓰인 색을 모읍니다. (반투명은 GIF에서 표현 불가 → 128 기준으로 자름)
  const colorIndex = new Map<number, number>();
  const palette: GifPalette = [[0, 0, 0]]; // 0번은 투명 전용
  let tooMany = false;
  for (const buf of frames) {
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] < 128) continue;
      const key = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      if (!colorIndex.has(key)) {
        if (palette.length >= 256) {
          tooMany = true;
          break;
        }
        colorIndex.set(key, palette.length);
        palette.push([buf[i], buf[i + 1], buf[i + 2]]);
      }
    }
    if (tooMany) break;
  }

  const gif = GIFEncoder();
  frames.forEach((buf, n) => {
    const delay = p.frames[opts.frames[n]].duration;
    const repeat = opts.loop ? 0 : -1;
    if (!tooMany) {
      // 2-a) 색이 256개 이하: 정확한 색 그대로 저장 (픽셀아트에 최적)
      const index = new Uint8Array(w * h);
      for (let i = 0, px = 0; i < buf.length; i += 4, px++) {
        if (buf[i + 3] < 128) index[px] = 0;
        else index[px] = colorIndex.get((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]) ?? 0;
      }
      gif.writeFrame(index, w, h, {
        palette: n === 0 ? palette : undefined,
        delay,
        repeat,
        transparent: true,
        transparentIndex: 0,
        dispose: 2,
      });
    } else {
      // 2-b) 색이 너무 많으면 프레임마다 256색으로 줄여서 저장
      const framePalette = quantize(buf, 256, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(buf, framePalette, 'rgba4444');
      const tIndex = framePalette.findIndex((c) => c.length > 3 && c[3] === 0);
      gif.writeFrame(index, w, h, {
        palette: framePalette,
        delay,
        repeat,
        transparent: tIndex >= 0,
        transparentIndex: Math.max(0, tIndex),
        dispose: 2,
      });
    }
  });
  gif.finish();
  return gif.bytes();
}
