/**
 * 프로젝트 조작 함수 모음
 * ------------------------------------------------------------
 * 레이어/그룹/프레임 추가·삭제·이동, 링크된 셀, 캔버스 크기 변경 등
 * 프로젝트 "구조"를 바꾸는 순수 로직입니다. (화면과 무관하므로 테스트하기 쉽습니다)
 *
 * 주의: 이 함수들은 project 객체를 "직접 수정"합니다.
 * 실행 취소는 store 쪽에서 snapshotStructure() 로 변경 전/후를 저장해서 처리합니다.
 * 픽셀 버퍼를 바꿔야 하는 구조 변경은 항상 "새 버퍼"를 만듭니다. (기존 버퍼는 실행 취소용으로 보존)
 */
import { celKey } from './celKey';
import { effectDef } from './effects';
import {
  cloneBuffer,
  createBuffer,
  fillBuffer,
  flipHorizontal,
  flipVertical,
  isBufferEmpty,
  resizeBuffer,
  rotate90,
  scaleNearest,
} from './pixels';
import type { Asset, Bone, Color, Frame, Layer, LayerKind, Project, Tag } from './types';

export { celKey };

let idCounter = 0;
/** 고유 ID 생성 */
export function uid(prefix = 'id'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const DEFAULT_FRAME_DURATION = 100;
export const MAX_CANVAS_SIZE = 2048;

/* ------------------------------------------------------------------ */
/* 만들기                                                               */
/* ------------------------------------------------------------------ */

export function createLayer(name: string, kind: LayerKind = 'pixel'): Layer {
  return {
    id: uid('layer'),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    kind,
    blendMode: 'normal',
    parentId: null,
    expanded: true,
    guide: false,
    anim: null,
    effects: [],
    bind: null,
    reference: null,
    particles: null,
  };
}

/** 예전 파일(v1)처럼 일부 값이 없는 레이어를 기본값으로 채웁니다. */
export function normalizeLayer(raw: Partial<Layer> & { id: string; name: string }): Layer {
  const base = createLayer(raw.name, raw.kind ?? 'pixel');
  return {
    ...base,
    ...raw,
    id: raw.id,
    visible: raw.visible !== false,
    locked: !!raw.locked,
    opacity: typeof raw.opacity === 'number' ? Math.max(0, Math.min(1, raw.opacity)) : 1,
    kind: raw.kind ?? 'pixel',
    blendMode: raw.blendMode ?? 'normal',
    parentId: raw.parentId ?? null,
    expanded: raw.expanded !== false,
    guide: !!raw.guide,
    anim: raw.anim ?? null,
    effects: raw.effects ?? [],
    bind: raw.bind ?? null,
    reference: raw.reference ?? null,
    particles: raw.particles ?? null,
  };
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
    bones: [],
    assets: {},
  };
  if (options.background != null) {
    const buf = createBuffer(width, height);
    fillBuffer(buf, options.background);
    project.cels[celKey(layer.id, frame.id)] = buf;
  }
  return project;
}

/* ------------------------------------------------------------------ */
/* 셀                                                                   */
/* ------------------------------------------------------------------ */

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

/**
 * 레이어가 빈 프레임에서 앞 그림을 계속 쓰는지(hold):
 * 키프레임 움직임, 뼈대 연결, 또는 프레임마다 달라지는 효과(흔들림·숨쉬기 등)가 있으면 그렇습니다.
 */
export function layerHolds(layer: Layer): boolean {
  if (layer.anim && layer.anim.keys.length > 0) return true;
  if (layer.bind) return true;
  return layer.effects.some((e) => e.enabled && !!effectDef(e.type)?.frameDependent);
}

/**
 * 이 프레임에서 실제로 사용되는 셀의 프레임 id.
 * 움직이는 레이어(layerHolds)는 빈 프레임에서 "앞 프레임의 그림을 계속 사용(hold)" 합니다.
 * → 그림 한 장을 그려 두고 키프레임이나 흔들림 효과만 넣으면 모든 프레임에 나타납니다.
 */
export function sourceFrameId(p: Project, layer: Layer, frameIndex: number): string | null {
  const frame = p.frames[frameIndex];
  if (!frame) return null;
  if (p.cels[celKey(layer.id, frame.id)]) return frame.id;
  if (!layerHolds(layer)) return null;
  for (let i = frameIndex - 1; i >= 0; i--) {
    if (p.cels[celKey(layer.id, p.frames[i].id)]) return p.frames[i].id;
  }
  for (let i = frameIndex + 1; i < p.frames.length; i++) {
    if (p.cels[celKey(layer.id, p.frames[i].id)]) return p.frames[i].id;
  }
  return null;
}

/** 그리기 도구가 편집할 셀의 프레임 id (hold 중이면 원본 셀) */
export function editableFrameId(p: Project, layer: Layer, frameIndex: number): string {
  return sourceFrameId(p, layer, frameIndex) ?? p.frames[frameIndex].id;
}

/** 앞 프레임과 같은 버퍼를 공유(링크)하는지 */
export function isLinkedToPrev(p: Project, layerId: string, frameIndex: number): boolean {
  if (frameIndex <= 0) return false;
  const a = getCel(p, layerId, p.frames[frameIndex - 1].id);
  const b = getCel(p, layerId, p.frames[frameIndex].id);
  return !!a && a === b;
}

/** 이 셀을 다른 프레임과 공유하고 있는지 */
export function isSharedCel(p: Project, layerId: string, frameId: string): boolean {
  const cel = getCel(p, layerId, frameId);
  if (!cel) return false;
  return p.frames.some((f) => f.id !== frameId && getCel(p, layerId, f.id) === cel);
}

/** source 프레임의 셀을 targets 프레임들에 링크합니다. (셀이 없으면 빈 셀을 만들어 공유) */
export function linkCels(p: Project, layerId: string, sourceIndex: number, targets: number[]): void {
  const src = ensureCel(p, layerId, p.frames[sourceIndex].id);
  for (const i of targets) {
    const f = p.frames[i];
    if (f) p.cels[celKey(layerId, f.id)] = src;
  }
}

/** 링크를 끊고 독립된 복사본으로 만듭니다. */
export function unlinkCel(p: Project, layerId: string, frameIndex: number): boolean {
  const f = p.frames[frameIndex];
  if (!f) return false;
  const key = celKey(layerId, f.id);
  const cel = p.cels[key];
  if (!cel || !isSharedCel(p, layerId, f.id)) return false;
  p.cels[key] = cloneBuffer(cel);
  return true;
}

/* ------------------------------------------------------------------ */
/* 레이어 트리 (그룹)                                                    */
/* ------------------------------------------------------------------ */

export function layerIndex(p: Project, layerId: string): number {
  return p.layers.findIndex((l) => l.id === layerId);
}

export function findLayer(p: Project, layerId: string | null | undefined): Layer | undefined {
  if (!layerId) return undefined;
  return p.layers.find((l) => l.id === layerId);
}

/** 같은 부모를 가진 레이어들 (아래 → 위 순서) */
export function childrenOf(p: Project, parentId: string | null): Layer[] {
  return p.layers.filter((l) => l.parentId === parentId);
}

export function descendantIds(p: Project, layerId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const child of p.layers) {
      if (child.parentId === id) {
        out.push(child.id);
        walk(child.id);
      }
    }
  };
  walk(layerId);
  return out;
}

export function ancestors(p: Project, layer: Layer): Layer[] {
  const out: Layer[] = [];
  let cur = findLayer(p, layer.parentId);
  let guard = 0;
  while (cur && guard++ < 100) {
    out.push(cur);
    cur = findLayer(p, cur.parentId);
  }
  return out;
}

/** 자신과 모든 상위 그룹이 보이는지 */
export function isEffectivelyVisible(p: Project, layer: Layer): boolean {
  return layer.visible && ancestors(p, layer).every((a) => a.visible);
}

/** 자신이나 상위 그룹이 잠겨 있는지 */
export function isEffectivelyLocked(p: Project, layer: Layer): boolean {
  return layer.locked || ancestors(p, layer).some((a) => a.locked);
}

export interface TreeRow {
  layer: Layer;
  depth: number;
}

/** 화면 표시용: 위 레이어부터, 그룹 안은 들여쓰기. 접힌 그룹의 자식은 제외할 수 있습니다. */
export function flattenTree(p: Project, includeCollapsed = false): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = childrenOf(p, parentId).slice().reverse();
    for (const layer of kids) {
      rows.push({ layer, depth });
      if (layer.kind === 'group' && (layer.expanded || includeCollapsed)) walk(layer.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
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
  bones: Bone[];
  assets: Record<string, Asset>;
}

/**
 * 프로젝트 구조를 저장합니다.
 * 레이어/뼈대 정보는 깊은 복사, 픽셀 버퍼와 자료(Asset)는 "참조"만 저장합니다.
 */
export function snapshotStructure(p: Project): StructureSnapshot {
  return {
    width: p.width,
    height: p.height,
    layers: structuredClone(p.layers),
    frames: p.frames.map((f) => ({ ...f })),
    cels: { ...p.cels },
    tags: p.tags.map((t) => ({ ...t })),
    palette: p.palette.slice(),
    name: p.name,
    bones: structuredClone(p.bones),
    assets: { ...p.assets },
  };
}

export function restoreStructure(p: Project, s: StructureSnapshot): void {
  p.width = s.width;
  p.height = s.height;
  p.layers = structuredClone(s.layers);
  p.frames = s.frames.map((f) => ({ ...f }));
  p.cels = { ...s.cels };
  p.tags = s.tags.map((t) => ({ ...t }));
  p.palette = s.palette.slice();
  p.name = s.name;
  p.bones = structuredClone(s.bones);
  p.assets = { ...s.assets };
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
export function addLayer(p: Project, index?: number, name?: string, kind: LayerKind = 'pixel', parentId: string | null = null): Layer {
  const layer = createLayer(name ?? nextLayerName(p), kind);
  layer.parentId = parentId;
  const at = index === undefined ? p.layers.length : Math.max(0, Math.min(p.layers.length, index));
  p.layers.splice(at, 0, layer);
  return layer;
}

/** 기준 레이어 바로 위(같은 그룹 안)에 새 레이어를 추가 */
export function addLayerAbove(p: Project, refId: string | null, name: string, kind: LayerKind = 'pixel'): Layer {
  const ref = findLayer(p, refId);
  if (!ref) return addLayer(p, undefined, name, kind, null);
  // 기준이 열린 그룹이면 그룹 안 맨 위에 추가
  if (ref.kind === 'group' && kind !== 'group') {
    return addLayer(p, layerIndex(p, ref.id), name, kind, ref.id);
  }
  return addLayer(p, layerIndex(p, ref.id) + 1, name, kind, ref.parentId);
}

export function duplicateLayer(p: Project, layerId: string, copySuffix = 'copy'): Layer | null {
  const src = findLayer(p, layerId);
  if (!src) return null;
  const idMap = new Map<string, string>();
  const cloneOne = (layer: Layer, parentId: string | null, nameSuffix: string): Layer => {
    const copy: Layer = { ...structuredClone(layer), id: uid('layer'), parentId, name: nameSuffix ? `${layer.name} ${nameSuffix}` : layer.name };
    idMap.set(layer.id, copy.id);
    // 링크 관계를 유지하면서 픽셀 복사
    const bufMap = new Map<Uint8ClampedArray, Uint8ClampedArray>();
    for (const f of p.frames) {
      const cel = getCel(p, layer.id, f.id);
      if (!cel) continue;
      let c = bufMap.get(cel);
      if (!c) {
        c = cloneBuffer(cel);
        bufMap.set(cel, c);
      }
      p.cels[celKey(copy.id, f.id)] = c;
    }
    return copy;
  };
  const copy = cloneOne(src, src.parentId, copySuffix);
  const inserted: Layer[] = [copy];
  if (src.kind === 'group') {
    const walk = (oldParent: string) => {
      for (const child of childrenOf(p, oldParent)) {
        inserted.push(cloneOne(child, idMap.get(oldParent) ?? null, ''));
        walk(child.id);
      }
    };
    walk(src.id);
  }
  // 복제본(그룹이면 자식 포함)을 원본 바로 위에 넣습니다.
  const at = layerIndex(p, src.id) + 1;
  p.layers.splice(at, 0, ...inserted.slice(1), copy);
  return copy;
}

/** 레이어 삭제 (그룹이면 안의 레이어도 함께). 레이어가 하나도 남지 않게 되면 실패합니다. */
export function removeLayer(p: Project, layerId: string): boolean {
  const ids = new Set([layerId, ...descendantIds(p, layerId)]);
  const remaining = p.layers.filter((l) => !ids.has(l.id));
  if (remaining.length === 0 || !remaining.some((l) => l.kind !== 'group')) return false;
  if (!findLayer(p, layerId)) return false;
  p.layers = remaining;
  for (const id of ids) for (const f of p.frames) delete p.cels[celKey(id, f.id)];
  return true;
}

/** 배열 위치를 바꿉니다. (그룹 안 순서도 배열 순서를 따릅니다) */
export function moveLayer(p: Project, layerId: string, toIndex: number): boolean {
  const from = layerIndex(p, layerId);
  if (from < 0) return false;
  const to = Math.max(0, Math.min(p.layers.length - 1, toIndex));
  if (from === to) return false;
  const [layer] = p.layers.splice(from, 1);
  p.layers.splice(to, 0, layer);
  return true;
}

/** 같은 그룹 안에서 위(+1)/아래(-1) 로 한 칸 이동 */
export function moveLayerAmongSiblings(p: Project, layerId: string, delta: 1 | -1): boolean {
  const layer = findLayer(p, layerId);
  if (!layer) return false;
  const sibs = childrenOf(p, layer.parentId);
  const i = sibs.indexOf(layer);
  const j = i + delta;
  if (j < 0 || j >= sibs.length) return false;
  const a = layerIndex(p, layer.id);
  const b = layerIndex(p, sibs[j].id);
  p.layers[a] = sibs[j];
  p.layers[b] = layer;
  return true;
}

/**
 * 레이어를 다른 레이어 위/아래 또는 그룹 안으로 옮깁니다. (끌어서 놓기)
 * where: 'above' | 'below' | 'inside'
 */
export function placeLayer(p: Project, layerId: string, targetId: string, where: 'above' | 'below' | 'inside'): boolean {
  const layer = findLayer(p, layerId);
  const target = findLayer(p, targetId);
  if (!layer || !target || layer.id === target.id) return false;
  // 자기 자신의 하위로는 옮길 수 없음
  if (descendantIds(p, layer.id).includes(target.id)) return false;
  p.layers.splice(layerIndex(p, layer.id), 1);
  const tIndex = layerIndex(p, target.id);
  if (where === 'inside' && target.kind === 'group') {
    layer.parentId = target.id;
    p.layers.splice(tIndex, 0, layer); // 그룹 안의 맨 위 (그룹 바로 아래 배열 위치)
  } else if (where === 'above') {
    layer.parentId = target.parentId;
    p.layers.splice(tIndex + 1, 0, layer);
  } else {
    layer.parentId = target.parentId;
    p.layers.splice(tIndex, 0, layer);
  }
  return true;
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

/**
 * frameIndex 프레임을 복제해서 바로 뒤에 넣습니다.
 * linked=true 면 픽셀을 복사하지 않고 같은 그림을 공유(링크)합니다.
 */
export function duplicateFrame(p: Project, frameIndex: number, linked = false): Frame | null {
  const src = p.frames[frameIndex];
  if (!src) return null;
  const copy = createFrame(src.duration);
  p.frames.splice(frameIndex + 1, 0, copy);
  for (const l of p.layers) {
    const cel = getCel(p, l.id, src.id);
    if (cel) p.cels[celKey(l.id, copy.id)] = linked ? cel : cloneBuffer(cel);
  }
  shiftTagsForInsert(p, frameIndex + 1, 1);
  return copy;
}

/** 프레임 삭제. 마지막 남은 프레임은 지울 수 없습니다. 그 프레임의 키프레임도 함께 지웁니다. */
export function removeFrame(p: Project, frameIndex: number): boolean {
  if (p.frames.length <= 1) return false;
  const frame = p.frames[frameIndex];
  if (!frame) return false;
  p.frames.splice(frameIndex, 1);
  for (const l of p.layers) {
    delete p.cels[celKey(l.id, frame.id)];
    if (l.anim) l.anim.keys = l.anim.keys.filter((k) => k.frameId !== frame.id);
  }
  for (const b of p.bones) b.keys = b.keys.filter((k) => k.frameId !== frame.id);
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

/** 모든 셀 버퍼를 변환하되, 링크(같은 버퍼 공유) 관계는 그대로 유지합니다. */
function mapCels(p: Project, fn: (buf: Uint8ClampedArray) => Uint8ClampedArray): void {
  const memo = new Map<Uint8ClampedArray, Uint8ClampedArray>();
  const cels: Record<string, Uint8ClampedArray> = {};
  for (const key of Object.keys(p.cels)) {
    const buf = p.cels[key];
    let out = memo.get(buf);
    if (!out) {
      out = fn(buf);
      memo.set(buf, out);
    }
    cels[key] = out;
  }
  p.cels = cels;
}

/** 위치 정보(중심점, 뼈대, 레퍼런스, 파티클)를 함께 옮깁니다. */
function mapPositions(p: Project, fn: (x: number, y: number) => { x: number; y: number }, rotFn: (r: number) => number = (r) => r): void {
  for (const l of p.layers) {
    if (l.anim) {
      const c = fn(l.anim.pivotX, l.anim.pivotY);
      l.anim.pivotX = c.x;
      l.anim.pivotY = c.y;
      const o = fn(0, 0);
      for (const k of l.anim.keys) {
        const moved = fn(k.x, k.y);
        k.x = Math.round(moved.x - o.x);
        k.y = Math.round(moved.y - o.y);
        k.rotation = rotFn(k.rotation) - rotFn(0);
      }
    }
    if (l.reference) {
      const c = fn(l.reference.x, l.reference.y);
      l.reference.x = Math.round(c.x);
      l.reference.y = Math.round(c.y);
    }
    if (l.particles) {
      const c = fn(l.particles.x, l.particles.y);
      l.particles.x = c.x;
      l.particles.y = c.y;
    }
  }
  for (const b of p.bones) {
    const c = fn(b.x, b.y);
    b.x = c.x;
    b.y = c.y;
    b.rotation = rotFn(b.rotation);
  }
}

/**
 * 캔버스 크기 변경
 * anchorX/anchorY: 0 = 왼쪽/위, 0.5 = 가운데, 1 = 오른쪽/아래 기준
 */
export function resizeCanvas(p: Project, newWidth: number, newHeight: number, anchorX: number, anchorY: number): void {
  const offsetX = Math.round((newWidth - p.width) * anchorX);
  const offsetY = Math.round((newHeight - p.height) * anchorY);
  const w = p.width;
  const h = p.height;
  mapCels(p, (buf) => resizeBuffer(buf, w, h, newWidth, newHeight, offsetX, offsetY));
  mapPositions(p, (x, y) => ({ x: x + offsetX, y: y + offsetY }));
  p.width = newWidth;
  p.height = newHeight;
}

/** 이미지 전체 크기 조절 (최근접 이웃) */
export function scaleProject(p: Project, newWidth: number, newHeight: number): void {
  const w = p.width;
  const h = p.height;
  const sx = newWidth / w;
  const sy = newHeight / h;
  mapCels(p, (buf) => scaleNearest(buf, w, h, newWidth, newHeight));
  mapPositions(p, (x, y) => ({ x: x * sx, y: y * sy }));
  for (const b of p.bones) b.length *= (sx + sy) / 2;
  p.width = newWidth;
  p.height = newHeight;
}

export function flipProject(p: Project, axis: 'horizontal' | 'vertical'): void {
  const w = p.width;
  const h = p.height;
  mapCels(p, (buf) => (axis === 'horizontal' ? flipHorizontal(buf, w, h) : flipVertical(buf, w, h)));
  if (axis === 'horizontal') mapPositions(p, (x, y) => ({ x: w - x, y }), (r) => 180 - r);
  else mapPositions(p, (x, y) => ({ x, y: h - y }), (r) => -r);
}

export function rotateProject(p: Project, clockwise: boolean): void {
  const w = p.width;
  const h = p.height;
  mapCels(p, (buf) => rotate90(buf, w, h, clockwise).buf);
  // 시계 방향: (x, y) → (h - y, x)
  if (clockwise) mapPositions(p, (x, y) => ({ x: h - y, y: x }), (r) => r + 90);
  else mapPositions(p, (x, y) => ({ x: y, y: w - x }), (r) => r - 90);
  p.width = h;
  p.height = w;
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

/* ------------------------------------------------------------------ */
/* 자료(Asset)                                                           */
/* ------------------------------------------------------------------ */

export function addAsset(p: Project, name: string, mime: string, data: Uint8Array): Asset {
  const asset: Asset = { id: uid('asset'), name, mime, data };
  p.assets = { ...p.assets, [asset.id]: asset };
  return asset;
}

/** 어떤 레이어도 쓰지 않는 자료를 정리합니다. */
export function pruneAssets(p: Project): void {
  const used = new Set<string>();
  for (const l of p.layers) {
    if (l.reference) used.add(l.reference.assetId);
  }
  const next: Record<string, Asset> = {};
  for (const id of Object.keys(p.assets)) if (used.has(id)) next[id] = p.assets[id];
  p.assets = next;
}
