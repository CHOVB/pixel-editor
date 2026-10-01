/**
 * 프로젝트 파일(.pxe) 저장 형식
 * ------------------------------------------------------------
 * JSON 텍스트 파일입니다. 사람이 열어볼 수 있고, 버전 관리가 쉽습니다.
 * 픽셀 데이터는 RGBA 바이트를 gzip 으로 압축한 뒤 base64 문자열로 저장합니다.
 * (PNG 로 저장하면 반투명 픽셀 색이 미세하게 바뀔 수 있어서, 원본 그대로 보존하는 방식을 택했습니다)
 *
 * v2: 링크된 셀(같은 그림 공유)은 버퍼를 한 번만 저장하고 번호로 참조합니다.
 *     레이어 종류/효과/키프레임/뼈대/자료(밑그림 이미지)도 저장합니다.
 * v1 파일도 그대로 열 수 있습니다. (빠진 값은 기본값으로 채움)
 */
import { colorToHex, hexToColor } from './color';
import { celKey, normalizeLayer } from './project';
import type { Asset, Bone, Frame, Layer, Project, Tag } from './types';

export const PROJECT_FORMAT = 'pixel-editor-project';
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = '.pxe';

type Encoding = 'rgba-gzip-base64' | 'rgba-base64';

interface BufferRecord {
  encoding: Encoding;
  data: string;
}

interface CelRecordV1 {
  layer: string;
  frame: string;
  encoding: Encoding;
  data: string;
}

interface CelRecordV2 {
  layer: string;
  frame: string;
  /** buffers 배열의 번호 */
  buffer: number;
}

interface AssetRecord {
  id: string;
  name: string;
  mime: string;
  data: string;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  width: number;
  height: number;
  layers: Partial<Layer>[];
  frames: Frame[];
  tags: Tag[];
  palette: string[];
  bones?: Bone[];
  assets?: AssetRecord[];
  buffers?: BufferRecord[];
  cels: (CelRecordV1 | CelRecordV2)[];
}

/* ---------------- base64 & 압축 도우미 ---------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return streamToBytes(stream as ReadableStream<Uint8Array>);
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return streamToBytes(stream as ReadableStream<Uint8Array>);
}

async function encodeBuffer(buf: Uint8ClampedArray): Promise<BufferRecord> {
  const raw = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (canCompress) return { encoding: 'rgba-gzip-base64', data: bytesToBase64(await gzip(raw)) };
  return { encoding: 'rgba-base64', data: bytesToBase64(raw) };
}

async function decodeBuffer(rec: { encoding: Encoding; data: string }): Promise<Uint8Array> {
  let bytes = base64ToBytes(rec.data);
  if (rec.encoding === 'rgba-gzip-base64') bytes = await gunzip(bytes);
  return bytes;
}

/* ---------------- 저장 / 불러오기 ---------------- */

export async function serializeProject(p: Project): Promise<string> {
  const buffers: BufferRecord[] = [];
  const bufferIndex = new Map<Uint8ClampedArray, number>();
  const cels: CelRecordV2[] = [];
  for (const layer of p.layers) {
    for (const frame of p.frames) {
      const buf = p.cels[celKey(layer.id, frame.id)];
      if (!buf) continue;
      let idx = bufferIndex.get(buf);
      if (idx === undefined) {
        idx = buffers.length;
        buffers.push(await encodeBuffer(buf));
        bufferIndex.set(buf, idx);
      }
      cels.push({ layer: layer.id, frame: frame.id, buffer: idx });
    }
  }
  const assets: AssetRecord[] = Object.values(p.assets).map((a) => ({ id: a.id, name: a.name, mime: a.mime, data: bytesToBase64(a.data) }));
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: p.name,
    width: p.width,
    height: p.height,
    layers: p.layers,
    frames: p.frames,
    tags: p.tags,
    palette: p.palette.map((c) => colorToHex(c, true)),
    bones: p.bones,
    assets,
    buffers,
    cels,
  };
  return JSON.stringify(file);
}

export class ProjectFileError extends Error {}

export async function deserializeProject(text: string): Promise<Project> {
  let data: ProjectFile;
  try {
    data = JSON.parse(text) as ProjectFile;
  } catch {
    throw new ProjectFileError('invalid-json');
  }
  if (data.format !== PROJECT_FORMAT) throw new ProjectFileError('not-a-project');
  if (data.version > PROJECT_VERSION) throw new ProjectFileError('newer-version');
  const width = Number(data.width);
  const height = Number(data.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ProjectFileError('bad-size');
  }
  const assets: Record<string, Asset> = {};
  for (const a of data.assets ?? []) assets[a.id] = { id: a.id, name: a.name, mime: a.mime, data: base64ToBytes(a.data) };
  const project: Project = {
    name: String(data.name ?? 'untitled'),
    width,
    height,
    layers: (data.layers ?? []).map((l) => normalizeLayer({ ...l, id: String(l.id), name: String(l.name ?? 'Layer') })),
    frames: (data.frames ?? []).map((f) => ({ id: String(f.id), duration: Math.max(10, Number(f.duration) || 100) })),
    tags: (data.tags ?? []).map((t) => ({ ...t })),
    palette: (data.palette ?? []).map((h) => hexToColor(h)).filter((c): c is number => c !== null),
    bones: (data.bones ?? []).map((b) => ({ ...b, keys: b.keys ?? [] })),
    assets,
    cels: {},
  };
  if (project.layers.length === 0 || project.frames.length === 0) throw new ProjectFileError('empty');
  const expected = width * height * 4;

  // v2: 공유 버퍼를 한 번만 풀어서 같은 객체를 여러 셀에 연결
  const decoded: (Uint8ClampedArray | null)[] = [];
  for (const rec of data.buffers ?? []) {
    const bytes = await decodeBuffer(rec);
    decoded.push(bytes.length === expected ? new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null);
  }
  for (const cel of data.cels ?? []) {
    if ('buffer' in cel) {
      const buf = decoded[cel.buffer];
      if (buf) project.cels[celKey(cel.layer, cel.frame)] = buf;
    } else {
      // v1: 셀마다 데이터가 따로 들어 있음
      const bytes = await decodeBuffer(cel);
      if (bytes.length !== expected) continue; // 손상된 셀은 건너뜁니다.
      project.cels[celKey(cel.layer, cel.frame)] = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
  }
  return project;
}
