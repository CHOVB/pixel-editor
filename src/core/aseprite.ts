/**
 * Aseprite 파일 (.aseprite / .ase) 읽기 · 쓰기
 * ------------------------------------------------------------
 * 도트 작가들이 가장 많이 쓰는 Aseprite 의 파일을 그대로 열고 저장할 수 있게 합니다.
 * (공식 형식 설명: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md)
 *
 * 파일 구조 (모든 숫자는 리틀 엔디언)
 *   [헤더 128바이트] → [프레임 헤더 16바이트 + 조각(chunk) 여러 개] × 프레임 수
 *   조각 종류: 레이어(0x2004), 셀(0x2005), 태그(0x2018), 팔레트(0x2019, 옛 0x0004) ...
 *
 * 읽기: RGBA(32비트) / 흑백(16비트) / 팔레트(8비트) 모두 지원, 그룹·링크 셀·태그·블렌드 모드 포함
 * 쓰기: RGBA(32비트). 움직임/효과/뼈대/파티클은 Aseprite 에 없는 기능이므로 "보이는 그대로" 픽셀로 저장합니다.
 *       같은 그림이 이어지는 프레임은 Aseprite 의 "링크 셀"로 저장해서 파일이 작아집니다.
 */
import { hexToColor } from './color';
import { contentBounds, createBuffer } from './pixels';
import { createFrame, createLayer, celKey, uid } from './project';
import { renderLayer } from './render';
import type { BlendMode, Color, Layer, Project, Tag } from './types';

/* ------------------------------------------------------------------ */
/* 압축 (zlib)                                                          */
/* ------------------------------------------------------------------ */

async function streamBytes(input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([input as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** zlib 압축 (Aseprite 가 쓰는 형식 = CompressionStream 의 'deflate') */
export function zlibCompress(data: Uint8Array): Promise<Uint8Array> {
  return streamBytes(data, new CompressionStream('deflate'));
}

export function zlibDecompress(data: Uint8Array): Promise<Uint8Array> {
  return streamBytes(data, new DecompressionStream('deflate'));
}

/* ------------------------------------------------------------------ */
/* 블렌드 모드 번호                                                      */
/* ------------------------------------------------------------------ */

const ASE_TO_BLEND: Record<number, BlendMode> = {
  0: 'normal',
  1: 'multiply',
  2: 'screen',
  3: 'overlay',
  4: 'darken',
  5: 'lighten',
  8: 'hardLight',
  10: 'difference',
  16: 'add',
  17: 'subtract',
};

const BLEND_TO_ASE: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  hardLight: 8,
  difference: 10,
  add: 16,
  subtract: 17,
};

const LAYER_VISIBLE = 1;
const LAYER_EDITABLE = 2;
const LAYER_BACKGROUND = 8;
const LAYER_REFERENCE = 64;

export class AsepriteError extends Error {}

/* ------------------------------------------------------------------ */
/* 읽기                                                                 */
/* ------------------------------------------------------------------ */

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.bytes.length;
  }
  byte(): number {
    return this.view.getUint8(this.pos++);
  }
  word(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  short(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  dword(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
  bytesAt(n: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  string(): string {
    const n = this.word();
    return new TextDecoder().decode(this.bytesAt(n));
  }
}

interface RawLayer {
  layer: Layer;
  level: number;
  type: number;
  background: boolean;
}

interface PendingCel {
  layerIndex: number;
  frame: number;
  x: number;
  y: number;
  opacity: number;
  w: number;
  h: number;
  /** 압축 전 픽셀 데이터 (색 깊이에 따라 1/2/4 바이트) */
  data: Uint8Array | null;
  compressed: boolean;
  linkTo: number;
}

/** Aseprite 파일 → 프로젝트 */
export async function readAseprite(input: ArrayBuffer | Uint8Array, name = 'aseprite'): Promise<Project> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 128) throw new AsepriteError('too-small');
  const r = new Reader(bytes);
  r.dword(); // 파일 크기
  if (r.word() !== 0xa5e0) throw new AsepriteError('bad-magic');
  const frameCount = r.word();
  const width = r.word();
  const height = r.word();
  const depth = r.word();
  if (depth !== 32 && depth !== 16 && depth !== 8) throw new AsepriteError('bad-depth');
  r.dword(); // flags
  r.word(); // speed (예전 값)
  r.dword();
  r.dword();
  const transparentIndex = r.byte();
  r.pos = 128;
  if (width <= 0 || height <= 0 || frameCount <= 0) throw new AsepriteError('empty');

  const layers: RawLayer[] = [];
  const frames = Array.from({ length: frameCount }, () => createFrame(100));
  const tags: Tag[] = [];
  let palette: Color[] = [];
  const cels: PendingCel[] = [];

  for (let f = 0; f < frameCount; f++) {
    const frameStart = r.pos;
    const frameBytes = r.dword();
    if (r.word() !== 0xf1fa) throw new AsepriteError('bad-frame');
    const oldChunks = r.word();
    frames[f].duration = Math.max(10, r.word() || 100);
    r.skip(2);
    const newChunks = r.dword();
    const chunkCount = newChunks || oldChunks;
    for (let c = 0; c < chunkCount && r.pos < frameStart + frameBytes; c++) {
      const chunkStart = r.pos;
      const size = r.dword();
      const type = r.word();
      const end = chunkStart + size;
      switch (type) {
        case 0x2004: {
          const flags = r.word();
          const layerType = r.word();
          const level = r.word();
          r.word();
          r.word();
          const blend = r.word();
          const opacity = r.byte();
          r.skip(3);
          const layerName = r.string();
          const layer = createLayer(layerName, layerType === 1 ? 'group' : 'pixel');
          layer.visible = (flags & LAYER_VISIBLE) !== 0;
          layer.locked = (flags & LAYER_EDITABLE) === 0;
          layer.blendMode = ASE_TO_BLEND[blend] ?? 'normal';
          layer.opacity = opacity / 255;
          layer.guide = (flags & LAYER_REFERENCE) !== 0;
          layers.push({ layer, level, type: layerType, background: (flags & LAYER_BACKGROUND) !== 0 });
          break;
        }
        case 0x2005: {
          const layerIndex = r.word();
          const x = r.short();
          const y = r.short();
          const opacity = r.byte();
          const celType = r.word();
          r.short(); // z-index
          r.skip(5);
          if (celType === 1) {
            cels.push({ layerIndex, frame: f, x, y, opacity, w: 0, h: 0, data: null, compressed: false, linkTo: r.word() });
          } else if (celType === 0 || celType === 2) {
            const w = r.word();
            const h = r.word();
            cels.push({ layerIndex, frame: f, x, y, opacity, w, h, data: r.bytesAt(end - r.pos), compressed: celType === 2, linkTo: -1 });
          }
          // celType 3(타일맵)은 지원하지 않으므로 건너뜁니다.
          break;
        }
        case 0x2018: {
          const n = r.word();
          r.skip(8);
          for (let i = 0; i < n; i++) {
            const from = r.word();
            const to = r.word();
            r.byte(); // 재생 방향
            r.word(); // 반복 횟수
            r.skip(6);
            const rgb = [r.byte(), r.byte(), r.byte()];
            r.byte();
            const tagName = r.string();
            tags.push({
              id: uid('tag'),
              name: tagName,
              from: Math.min(from, frameCount - 1),
              to: Math.min(to, frameCount - 1),
              color: `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
            });
          }
          break;
        }
        case 0x2019: {
          const size2 = r.dword();
          const first = r.dword();
          const last = r.dword();
          r.skip(8);
          const next = palette.slice(0, size2);
          for (let i = first; i <= last; i++) {
            const flags = r.word();
            const [cr, cg, cb, ca] = [r.byte(), r.byte(), r.byte(), r.byte()];
            next[i] = (((cr << 24) | (cg << 16) | (cb << 8) | ca) >>> 0) as Color;
            if (flags & 1) r.string();
          }
          palette = next;
          break;
        }
        case 0x0004:
        case 0x0011: {
          // 예전 팔레트 (새 팔레트 조각이 있으면 그쪽을 씁니다)
          if (palette.length > 0) break;
          const packets = r.word();
          let idx = 0;
          const old: Color[] = [];
          for (let k = 0; k < packets; k++) {
            idx += r.byte();
            let n = r.byte();
            if (n === 0) n = 256;
            for (let i = 0; i < n; i++) {
              let [cr, cg, cb] = [r.byte(), r.byte(), r.byte()];
              if (type === 0x0011) [cr, cg, cb] = [cr * 4, cg * 4, cb * 4].map((v) => Math.min(255, v));
              old[idx++] = (((cr << 24) | (cg << 16) | (cb << 8) | 255) >>> 0) as Color;
            }
          }
          palette = old;
          break;
        }
        default:
          break;
      }
      r.pos = end;
    }
    r.pos = frameStart + frameBytes;
  }

  // 그룹 구조 연결 (child level 로 부모 찾기)
  const parents: string[] = [];
  for (const raw of layers) {
    raw.layer.parentId = raw.level > 0 ? (parents[raw.level - 1] ?? null) : null;
    if (raw.type === 1) parents[raw.level] = raw.layer.id;
  }

  const project: Project = {
    name: name.replace(/\.(aseprite|ase)$/i, ''),
    width,
    height,
    layers: layers.map((l) => l.layer),
    frames,
    cels: {},
    tags,
    palette: palette.filter((c) => c !== undefined),
    bones: [],
    assets: {},
  };
  if (project.layers.length === 0) project.layers.push(createLayer('Layer 1'));

  // 셀 픽셀 풀기
  const bpp = depth / 8;
  for (const cel of cels) {
    if (cel.linkTo >= 0 || !cel.data) continue;
    const raw = layers[cel.layerIndex];
    if (!raw || raw.type !== 0) continue;
    const pixels = cel.compressed ? await zlibDecompress(cel.data) : cel.data;
    if (pixels.length < cel.w * cel.h * bpp) continue;
    const buf = createBuffer(width, height);
    const alphaScale = cel.opacity / 255;
    for (let y = 0; y < cel.h; y++) {
      const ty = cel.y + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < cel.w; x++) {
        const tx = cel.x + x;
        if (tx < 0 || tx >= width) continue;
        const s = (y * cel.w + x) * bpp;
        let cr: number;
        let cg: number;
        let cb: number;
        let ca: number;
        if (depth === 32) {
          [cr, cg, cb, ca] = [pixels[s], pixels[s + 1], pixels[s + 2], pixels[s + 3]];
        } else if (depth === 16) {
          [cr, cg, cb, ca] = [pixels[s], pixels[s], pixels[s], pixels[s + 1]];
        } else {
          const index = pixels[s];
          if (index === transparentIndex && !raw.background) continue;
          const c = palette[index] ?? 0;
          [cr, cg, cb, ca] = [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
        }
        if (ca === 0) continue;
        const d = (ty * width + tx) * 4;
        buf[d] = cr;
        buf[d + 1] = cg;
        buf[d + 2] = cb;
        buf[d + 3] = Math.round(ca * alphaScale);
      }
    }
    project.cels[celKey(raw.layer.id, frames[cel.frame].id)] = buf;
  }
  // 링크 셀: 같은 픽셀 버퍼를 함께 씁니다. (우리 에디터의 "링크 셀"과 같은 개념)
  for (const cel of cels) {
    if (cel.linkTo < 0) continue;
    const raw = layers[cel.layerIndex];
    const target = frames[cel.linkTo];
    if (!raw || !target) continue;
    const buf = project.cels[celKey(raw.layer.id, target.id)];
    if (buf) project.cels[celKey(raw.layer.id, frames[cel.frame].id)] = buf;
  }
  return project;
}

/* ------------------------------------------------------------------ */
/* 쓰기                                                                 */
/* ------------------------------------------------------------------ */

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  pos = 0;
  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  byte(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos++, v & 255);
  }
  word(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }
  short(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }
  dword(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  zeros(n: number): void {
    this.ensure(n);
    this.buf.fill(0, this.pos, this.pos + n);
    this.pos += n;
  }
  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.pos);
    this.pos += data.length;
  }
  string(s: string): void {
    const data = new TextEncoder().encode(s);
    this.word(data.length);
    this.bytes(data);
  }
  /** 먼저 0 으로 써 둔 자리에 나중에 값을 채워 넣기 */
  patchWord(at: number, v: number): void {
    this.view.setUint16(at, v & 0xffff, true);
  }
  patchDword(at: number, v: number): void {
    this.view.setUint32(at, v >>> 0, true);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** 조각 하나 쓰기: [크기][종류][내용] */
function chunk(w: Writer, type: number, body: (w: Writer) => void): void {
  const start = w.pos;
  w.dword(0);
  w.word(type);
  body(w);
  w.patchDword(start, w.pos - start);
}

function depthOf(p: Project, layer: Layer): number {
  let d = 0;
  let cur = layer.parentId ? p.layers.find((l) => l.id === layer.parentId) : undefined;
  while (cur && d < 32) {
    d++;
    cur = cur.parentId ? p.layers.find((l) => l.id === cur?.parentId) : undefined;
  }
  return d;
}

interface CelOut {
  layerIndex: number;
  frame: number;
  link: number;
  x: number;
  y: number;
  w: number;
  h: number;
  data?: Uint8Array;
}

/** 프로젝트 → Aseprite 파일 (RGBA 32비트) */
export async function writeAseprite(p: Project): Promise<Uint8Array> {
  // 밑그림 이미지(레퍼런스) 레이어는 그림이 아니므로 빼고 저장합니다.
  const layers = p.layers.filter((l) => l.kind !== 'reference');
  const index = new Map(layers.map((l, i) => [l.id, i]));

  // 1) 셀 준비 (프레임마다 "보이는 그대로" 픽셀, 같은 그림이면 링크)
  const celsByFrame: CelOut[][] = p.frames.map(() => []);
  for (const layer of layers) {
    if (layer.kind === 'group') continue;
    const li = index.get(layer.id) as number;
    const seen = new Map<string, number>();
    for (let f = 0; f < p.frames.length; f++) {
      const rendered = renderLayer(p, layer, f, { includeHidden: true, includeGuides: true });
      if (!rendered) continue;
      // 움직임 투명도(키프레임 불투명도)는 픽셀 알파에 굽고, 레이어 불투명도는 레이어 값으로 저장
      const extra = layer.opacity > 0 ? rendered.opacity / layer.opacity : 0;
      const key = `${rendered.key}@${extra.toFixed(4)}`;
      const linked = seen.get(key);
      if (linked !== undefined) {
        celsByFrame[f].push({ layerIndex: li, frame: f, link: linked, x: 0, y: 0, w: 0, h: 0 });
        continue;
      }
      const bounds = contentBounds(rendered.buf, p.width, p.height);
      if (!bounds) continue;
      const data = new Uint8Array(bounds.w * bounds.h * 4);
      for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
          const s = ((bounds.y + y) * p.width + bounds.x + x) * 4;
          const d = (y * bounds.w + x) * 4;
          data[d] = rendered.buf[s];
          data[d + 1] = rendered.buf[s + 1];
          data[d + 2] = rendered.buf[s + 2];
          data[d + 3] = extra < 1 ? Math.round(rendered.buf[s + 3] * extra) : rendered.buf[s + 3];
        }
      }
      seen.set(key, f);
      celsByFrame[f].push({ layerIndex: li, frame: f, link: -1, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, data: await zlibCompress(data) });
    }
  }

  // 2) 파일 쓰기
  const w = new Writer();
  w.dword(0); // 파일 크기 (마지막에 채움)
  w.word(0xa5e0);
  w.word(p.frames.length);
  w.word(p.width);
  w.word(p.height);
  w.word(32);
  w.dword(1); // 레이어 불투명도 사용
  w.word(100);
  w.dword(0);
  w.dword(0);
  w.byte(0); // 투명색 번호 (8비트 전용)
  w.zeros(3);
  w.word(Math.min(256, p.palette.length) % 256);
  w.byte(1); // 픽셀 비율
  w.byte(1);
  w.short(0);
  w.short(0);
  w.word(16); // 격자
  w.word(16);
  w.zeros(84);

  for (let f = 0; f < p.frames.length; f++) {
    const frameStart = w.pos;
    w.dword(0);
    w.word(0xf1fa);
    const countPos = w.pos;
    w.word(0);
    w.word(Math.min(65535, p.frames[f].duration));
    w.zeros(2);
    w.dword(0);
    let chunks = 0;

    if (f === 0) {
      // 팔레트
      if (p.palette.length > 0) {
        chunk(w, 0x2019, (c) => {
          const n = Math.min(256, p.palette.length);
          c.dword(n);
          c.dword(0);
          c.dword(n - 1);
          c.zeros(8);
          for (let i = 0; i < n; i++) {
            const col = p.palette[i];
            c.word(0);
            c.byte((col >>> 24) & 255);
            c.byte((col >>> 16) & 255);
            c.byte((col >>> 8) & 255);
            c.byte(col & 255);
          }
        });
        chunks++;
      }
      // 레이어
      for (const layer of layers) {
        chunk(w, 0x2004, (c) => {
          let flags = 0;
          if (layer.visible) flags |= LAYER_VISIBLE;
          if (!layer.locked) flags |= LAYER_EDITABLE;
          if (layer.guide) flags |= LAYER_REFERENCE;
          c.word(flags);
          c.word(layer.kind === 'group' ? 1 : 0);
          c.word(depthOf(p, layer));
          c.word(0);
          c.word(0);
          c.word(BLEND_TO_ASE[layer.blendMode] ?? 0);
          c.byte(Math.round(layer.opacity * 255));
          c.zeros(3);
          c.string(layer.name);
        });
        chunks++;
      }
      // 태그
      if (p.tags.length > 0) {
        chunk(w, 0x2018, (c) => {
          c.word(p.tags.length);
          c.zeros(8);
          for (const tag of p.tags) {
            c.word(tag.from);
            c.word(tag.to);
            c.byte(0);
            c.word(0);
            c.zeros(6);
            const col = hexToColor(tag.color) ?? 0;
            c.byte((col >>> 24) & 255);
            c.byte((col >>> 16) & 255);
            c.byte((col >>> 8) & 255);
            c.byte(0);
            c.string(tag.name);
          }
        });
        chunks++;
      }
    }

    for (const cel of celsByFrame[f]) {
      chunk(w, 0x2005, (c) => {
        c.word(cel.layerIndex);
        c.short(cel.x);
        c.short(cel.y);
        c.byte(255);
        c.word(cel.link >= 0 ? 1 : 2);
        c.short(0);
        c.zeros(5);
        if (cel.link >= 0) {
          c.word(cel.link);
        } else {
          c.word(cel.w);
          c.word(cel.h);
          c.bytes(cel.data as Uint8Array);
        }
      });
      chunks++;
    }

    w.patchDword(frameStart, w.pos - frameStart);
    // 예전 형식의 조각 수(WORD)와 새 형식의 조각 수(DWORD)
    w.patchWord(countPos, Math.min(0xffff, chunks));
    w.patchDword(countPos + 6, chunks);
  }
  w.patchDword(0, w.pos);
  return w.result();
}
