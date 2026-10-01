/**
 * 프로젝트 조작 함수 모음
 * ------------------------------------------------------------
 * 레이어/프레임 추가·삭제·이동, 캔버스 크기 변경 등
 * 프로젝트 "구조"를 바꾸는 순수 로직입니다. (화면과 무관하므로 테스트하기 쉽습니다)
 *
 * 주의: 이 함수들은 project 객체를 "직접 수정"합니다.
 * 실행 취소는 store 쪽에서 snapshotStructure() 로 변경 전/후를 저장해서 처리합니다.
 */
import { blendOver, cloneBuffer, createBuffer, fillBuffer, flipHorizontal, flipVertical, isBufferEmpty, resizeBuffer, rotate90, scaleNearest } from './pixels';
import type { Color, Frame, Layer, Project, Tag } from './types';

let idCounter = 0;
/** 고유 ID 생성 */
export function uid(prefix = 'id'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const DEFAULT_FRAME_DURATION = 100;
export const MAX_CANVAS_SIZE = 2048;

export function celKey(layerId: string, frameId: string): string {
  return `${layerId}|${frameId}`;
}

export function createLayer(name: string): Layer {
  return { id: uid('layer'), name, visible: true, locked: false, opacity: 1 };
}

export function createFrame(duration = DEFAULT_FRAME_DURATION): Frame {
  return { id: uid('frame'), duration };
}

export interface CreateProjectOptions {
  name?: string;
  /** 배경색. null 이면 투명 배경 */
  background?: Color | null;
  palette?: Color[];
  layerName?: string;
}

export function createProject(width: number, height: number, options: CreateProjectOptions = {}): Project {
  const layer = createLayer(options.layerName ?? 'Layer 1');
  const frame = createFrame();
  const project: Project = {
    name: options.name ?? 'untitled',
    width,
    height,
    layers: [layer],
    frames: [frame],
    cels: {},
    tags: [],
    palette: options.palette ? options.palette.slice() : [],
  };
  if (options.background != null) {
    const buf = createBuffer(width, height);
    fillBuffer(buf, options.background);
    project.cels[celKey(layer.id, frame.id)] = buf;
  }
  return project;
}

export function getCel(p: Project, layerId: string, frameId: string): Uint8ClampedArray | undefined {
  return p.cels[celKey(layerId, frameId)];
}

/** 셀이 없으면 빈 셀을 만들어서 돌려줍니다. */
export function ensureCel(p: Project, layerId: string, frameId: string): Uint8ClampedArray {
  const key = celKey(layerId, frameId);
  let cel = p.cels[key];
  if (!cel) {
    cel = createBuffer(p.width, p.height);
    p.cels[key] = cel;
  }
  return cel;
}

/** 셀에 보이는 픽셀이 하나라도 있는지 */
export function celHasContent(p: Project, layerId: string, frameId: string): boolean {
  const cel = getCel(p, layerId, frameId);
  return !!cel && !isBufferEmpty(cel);
}

export function layerIndex(p: Project, layerId: string): number {
  return p.layers.findIndex((l) => l.id === layerId);
}

export function findLayer(p: Project, layerId: string): Layer | undefined {
  return p.layers.find((l) => l.id === layerId);
}

/* ------------------------------------------------------------------ */
/* 구조 스냅샷 (실행 취소용)                                             */
/* ------------------------------------------------------------------ */

export interface StructureSnapshot {
  width: number;
  height: number;
  layers: Layer[];
  frames: Frame[];
  cels: Record<string, Uint8ClampedArray>;
  tags: Tag[];
  palette: Color[];
  name: string;
}

/**
 * 프로젝트 구조를 저장합니다.
 * 픽셀 버퍼는 "참조"만 저장합니다. (구조 변경 함수들은 버퍼를 새로 만들기 때문에 안전합니다)
 */
export function snapshotStructure(p: Project): StructureSnapshot {
  return {
    width: p.width,
    height: p.height,
    layers: p.layers.map((l) => ({ ...l })),
    frames: p.frames.map((f) => ({ ...f })),
    cels: { ...p.cels },
    tags: p.tags.map((t) => ({ ...t })),
    palette: p.palette.slice(),
    name: p.name,
  };
}

export function restoreStructure(p: Project, s: StructureSnapshot): void {
  p.width = s.width;
  p.height = s.height;
  p.layers = s.layers.map((l) => ({ ...l }));
  p.frames = s.frames.map((f) => ({ ...f }));
  p.cels = { ...s.cels };
  p.tags = s.tags.map((t) => ({ ...t }));
  p.palette = s.palette.slice();
  p.name = s.name;
}

/* ------------------------------------------------------------------ */
/* 레이어                                                               */
/* ------------------------------------------------------------------ */

/** "Layer 3" 처럼 겹치지 않는 다음 이름 */
export function nextLayerName(p: Project, base = 'Layer'): string {
  let n = p.layers.length + 1;
  const names = new Set(p.layers.map((l) => l.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** index 위치에 새 레이어 추가 (index 생략 시 맨 위) */
export function addLayer(p: Project, index?: number, name?: string): Layer {
  const layer = createLayer(name ?? nextLayerName(p));
  const at = index === undefined ? p.layers.length : Math.max(0, Math.min(p.layers.length, index));
  p.layers.splice(at, 0, layer);
  return layer;
}

export function duplicateLayer(p: Project, layerId: string, copySuffix = 'copy'): Layer | null {
  const idx = layerIndex(p, layerId);
  if (idx < 0) return null;
  const src = p.layers[idx];
  const copy: Layer = { ...src, id: uid('layer'), name: `${src.name} ${copySuffix}` };
  p.layers.splice(idx + 1, 0, copy);
  for (const f of p.frames) {
    const cel = getCel(p, src.id, f.id);
    if (cel) p.cels[celKey(copy.id, f.id)] = cloneBuffer(cel);
  }
  return copy;
}

/** 레이어 삭제. 마지막 남은 레이어는 지울 수 없습니다. */
export function removeLayer(p: Project, layerId: string): boolean {
  if (p.layers.length <= 1) return false;
  const idx = layerIndex(p, layerId);
  if (idx < 0) return false;
  p.layers.splice(idx, 1);
  for (const f of p.frames) delete p.cels[celKey(layerId, f.id)];
  return true;
}

export function moveLayer(p: Project, layerId: string, toIndex: number): boolean {
  const from = layerIndex(p, layerId);
  if (from < 0) return false;
  const to = Math.max(0, Math.min(p.layers.length - 1, toIndex));
  if (from === to) return false;
  const [layer] = p.layers.splice(from, 1);
  p.layers.splice(to, 0, layer);
  return true;
}

/** 아래 레이어와 합치기. 합쳐진(아래) 레이어를 돌려줍니다. */
export function mergeDown(p: Project, layerId: string): Layer | null {
  const idx = layerIndex(p, layerId);
  if (idx <= 0) return null;
  const upper = p.layers[idx];
  const lower = p.layers[idx - 1];
  for (const f of p.frames) {
    const upCel = getCel(p, upper.id, f.id);
    if (!upCel || !upper.visible) continue;
    const lowKey = celKey(lower.id, f.id);
    const merged = p.cels[lowKey] ? cloneBuffer(p.cels[lowKey]) : createBuffer(p.width, p.height);
    blendOver(merged, upCel, upper.opacity);
    p.cels[lowKey] = merged;
  }
  removeLayer(p, upper.id);
  return lower;
}

/* ------------------------------------------------------------------ */
/* 프레임                                                               */
/* ------------------------------------------------------------------ */

/** 프레임이 끼워 넣어질 때 태그 범위를 조정 */
function shiftTagsForInsert(p: Project, index: number, count: number): void {
  for (const t of p.tags) {
    if (t.from >= index) {
      t.from += count;
      t.to += count;
    } else if (t.to >= index) {
      t.to += count;
    }
  }
}

/** 프레임이 삭제될 때 태그 범위를 조정 (비어버린 태그는 삭제) */
function shiftTagsForRemove(p: Project, index: number): void {
  for (const t of p.tags) {
    if (t.from > index) {
      t.from--;
      t.to--;
    } else if (t.to >= index) {
      t.to--;
    }
  }
  p.tags = p.tags.filter((t) => t.to >= t.from);
}

/** index 위치에 빈 프레임 추가 */
export function addFrame(p: Project, index: number, duration?: number): Frame {
  const frame = createFrame(duration ?? p.frames[Math.max(0, index - 1)]?.duration ?? DEFAULT_FRAME_DURATION);
  const at = Math.max(0, Math.min(p.frames.length, index));
  p.frames.splice(at, 0, frame);
  shiftTagsForInsert(p, at, 1);
  return frame;
}

/** frameIndex 프레임을 복제해서 바로 뒤에 넣습니다. */
export function duplicateFrame(p: Project, frameIndex: number): Frame | null {
  const src = p.frames[frameIndex];
  if (!src) return null;
  const copy = createFrame(src.duration);
  p.frames.splice(frameIndex + 1, 0, copy);
  for (const l of p.layers) {
    const cel = getCel(p, l.id, src.id);
    if (cel) p.cels[celKey(l.id, copy.id)] = cloneBuffer(cel);
  }
  shiftTagsForInsert(p, frameIndex + 1, 1);
  return copy;
}

/** 프레임 삭제. 마지막 남은 프레임은 지울 수 없습니다. */
export function removeFrame(p: Project, frameIndex: number): boolean {
  if (p.frames.length <= 1) return false;
  const frame = p.frames[frameIndex];
  if (!frame) return false;
  p.frames.splice(frameIndex, 1);
  for (const l of p.layers) delete p.cels[celKey(l.id, frame.id)];
  shiftTagsForRemove(p, frameIndex);
  return true;
}

export function moveFrame(p: Project, from: number, to: number): boolean {
  if (from < 0 || from >= p.frames.length) return false;
  const target = Math.max(0, Math.min(p.frames.length - 1, to));
  if (from === target) return false;
  const [frame] = p.frames.splice(from, 1);
  p.frames.splice(target, 0, frame);
  return true;
}

/** from~to 구간의 프레임 순서를 뒤집습니다. */
export function reverseFrames(p: Project, from: number, to: number): void {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(p.frames.length - 1, Math.max(from, to));
  const part = p.frames.slice(a, b + 1).reverse();
  p.frames.splice(a, part.length, ...part);
}

export function totalDuration(p: Project): number {
  return p.frames.reduce((sum, f) => sum + f.duration, 0);
}

/* ------------------------------------------------------------------ */
/* 캔버스 전체 변형                                                     */
/* ------------------------------------------------------------------ */

/**
 * 캔버스 크기 변경
 * anchorX/anchorY: 0 = 왼쪽/위, 0.5 = 가운데, 1 = 오른쪽/아래 기준
 */
export function resizeCanvas(p: Project, newWidth: number, newHeight: number, anchorX: number, anchorY: number): void {
  const offsetX = Math.round((newWidth - p.width) * anchorX);
  const offsetY = Math.round((newHeight - p.height) * anchorY);
  const cels: Record<string, Uint8ClampedArray> = {};
  for (const key of Object.keys(p.cels)) {
    cels[key] = resizeBuffer(p.cels[key], p.width, p.height, newWidth, newHeight, offsetX, offsetY);
  }
  p.cels = cels;
  p.width = newWidth;
  p.height = newHeight;
}

/** 이미지 전체 크기 조절 (최근접 이웃) */
export function scaleProject(p: Project, newWidth: number, newHeight: number): void {
  const cels: Record<string, Uint8ClampedArray> = {};
  for (const key of Object.keys(p.cels)) {
    cels[key] = scaleNearest(p.cels[key], p.width, p.height, newWidth, newHeight);
  }
  p.cels = cels;
  p.width = newWidth;
  p.height = newHeight;
}

export function flipProject(p: Project, axis: 'horizontal' | 'vertical'): void {
  const cels: Record<string, Uint8ClampedArray> = {};
  for (const key of Object.keys(p.cels)) {
    cels[key] =
      axis === 'horizontal'
        ? flipHorizontal(p.cels[key], p.width, p.height)
        : flipVertical(p.cels[key], p.width, p.height);
  }
  p.cels = cels;
}

export function rotateProject(p: Project, clockwise: boolean): void {
  const cels: Record<string, Uint8ClampedArray> = {};
  for (const key of Object.keys(p.cels)) {
    cels[key] = rotate90(p.cels[key], p.width, p.height, clockwise).buf;
  }
  p.cels = cels;
  // 90도 회전하면 가로/세로가 바뀝니다.
  const oldWidth = p.width;
  p.width = p.height;
  p.height = oldWidth;
}

/* ------------------------------------------------------------------ */
/* 태그                                                                 */
/* ------------------------------------------------------------------ */

export const TAG_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#f78c6b', '#a0e426', '#ff8fab'];

export function addTag(p: Project, name: string, from: number, to: number): Tag {
  const tag: Tag = {
    id: uid('tag'),
    name,
    from: Math.max(0, Math.min(from, to)),
    to: Math.min(p.frames.length - 1, Math.max(from, to)),
    color: TAG_COLORS[p.tags.length % TAG_COLORS.length],
  };
  p.tags.push(tag);
  return tag;
}

export function removeTag(p: Project, tagId: string): void {
  p.tags = p.tags.filter((t) => t.id !== tagId);
}
