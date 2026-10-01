/**
 * 프로젝트 파일(.pxe) 저장 형식
 * ------------------------------------------------------------
 * JSON 텍스트 파일입니다. 사람이 열어볼 수 있고, 버전 관리가 쉽습니다.
 * 픽셀 데이터는 RGBA 바이트를 gzip 으로 압축한 뒤 base64 문자열로 저장합니다.
 * (PNG 로 저장하면 반투명 픽셀 색이 미세하게 바뀔 수 있어서, 원본 그대로 보존하는 방식을 택했습니다)
 */
import { colorToHex, hexToColor } from './color';
import { celKey } from './project';
import type { Frame, Layer, Project, Tag } from './types';

export const PROJECT_FORMAT = 'pixel-editor-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.pxe';

interface CelRecord {
  layer: string;
  frame: string;
  encoding: 'rgba-gzip-base64' | 'rgba-base64';
  data: string;
}

export interface ProjectFileV1 {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  frames: Frame[];
  tags: Tag[];
  palette: string[];
  cels: CelRecord[];
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

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return streamToBytes(stream as ReadableStream<Uint8Array>);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return streamToBytes(stream as ReadableStream<Uint8Array>);
}

/* ---------------- 저장 / 불러오기 ---------------- */

export async function serializeProject(p: Project): Promise<string> {
  const cels: CelRecord[] = [];
  for (const layer of p.layers) {
    for (const frame of p.frames) {
      const buf = p.cels[celKey(layer.id, frame.id)];
      if (!buf) continue;
      const raw = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      if (canCompress) {
        cels.push({ layer: layer.id, frame: frame.id, encoding: 'rgba-gzip-base64', data: bytesToBase64(await gzip(raw)) });
      } else {
        cels.push({ layer: layer.id, frame: frame.id, encoding: 'rgba-base64', data: bytesToBase64(raw) });
      }
    }
  }
  const file: ProjectFileV1 = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: p.name,
    width: p.width,
    height: p.height,
    layers: p.layers,
    frames: p.frames,
    tags: p.tags,
    palette: p.palette.map((c) => colorToHex(c, true)),
    cels,
  };
  return JSON.stringify(file);
}

export class ProjectFileError extends Error {}

export async function deserializeProject(text: string): Promise<Project> {
  let data: ProjectFileV1;
  try {
    data = JSON.parse(text) as ProjectFileV1;
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
  const project: Project = {
    name: String(data.name ?? 'untitled'),
    width,
    height,
    layers: (data.layers ?? []).map((l) => ({
      id: String(l.id),
      name: String(l.name),
      visible: l.visible !== false,
      locked: !!l.locked,
      opacity: typeof l.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1,
    })),
    frames: (data.frames ?? []).map((f) => ({ id: String(f.id), duration: Math.max(10, Number(f.duration) || 100) })),
    tags: (data.tags ?? []).map((t) => ({ ...t })),
    palette: (data.palette ?? []).map((h) => hexToColor(h)).filter((c): c is number => c !== null),
    cels: {},
  };
  if (project.layers.length === 0 || project.frames.length === 0) throw new ProjectFileError('empty');
  const expected = width * height * 4;
  for (const cel of data.cels ?? []) {
    let bytes = base64ToBytes(cel.data);
    if (cel.encoding === 'rgba-gzip-base64') bytes = await gunzip(bytes);
    if (bytes.length !== expected) continue; // 손상된 셀은 건너뜁니다.
    project.cels[celKey(cel.layer, cel.frame)] = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return project;
}
