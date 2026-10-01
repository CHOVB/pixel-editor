/**
 * 에디터 동작(Actions) 모음 – 기본
 * ------------------------------------------------------------
 * 버튼/메뉴/단축키가 실행하는 "명령"들입니다.
 * 문서를 바꾸는 명령은 모두 실행 취소(history)에 기록됩니다.
 *
 *  ┌──────────┐   클릭    ┌──────────────┐  수정  ┌─────────┐
 *  │ 버튼/메뉴 │ ───────▶ │ actions.ts   │ ─────▶ │ project │
 *  └──────────┘           │ (+ history)  │        └─────────┘
 *                         └──────────────┘ docVersion++ → 화면 갱신
 *
 * 기능별 명령 파일
 *  - actions.ts        기본 (실행 취소, 레이어, 프레임, 태그, 선택, 캔버스, 팔레트)
 *  - animActions.ts    애니메이션 (키프레임, 링크 셀, 중간 프레임 생성, 색 바꾸기)
 *  - effectActions.ts  효과
 *  - boneActions.ts    뼈대
 */
import { mergeDown, bakeLayer, siblingBelow } from '../core/bake';
import { luminance } from '../core/color';
import { applyPatch, diffBuffers, History } from '../core/history';
import { getPreset, presetToColors } from '../core/palettes';
import { cloneBuffer, flipHorizontal, flipVertical, setPixel, uniqueColors } from '../core/pixels';
import {
  addFrame,
  addLayerAbove,
  addTag,
  celKey,
  duplicateFrame,
  duplicateLayer,
  editableFrameId,
  ensureCel,
  findLayer,
  flipProject,
  isEffectivelyLocked,
  isEffectivelyVisible,
  moveFrame,
  moveLayerAmongSiblings,
  nextLayerName,
  placeLayer,
  removeFrame,
  removeLayer,
  removeTag,
  resizeCanvas,
  restoreStructure,
  reverseFrames,
  rotateProject,
  scaleProject,
  snapshotStructure,
  type StructureSnapshot,
} from '../core/project';
import { fullMask, invertMask, selectionFromMask } from '../core/selection';
import type { BlendMode, Color, Frame, Layer, LayerKind, Project, Selection, Tag } from '../core/types';
import { markEdited } from '../core/versions';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { getState as S, setState, type ContextMenuEntry, type Toast } from './editorStore';

/** 실행 취소 기록 (앱 전체에서 하나) */
export const history = new History(300);

/* ================================================================== */
/* 공통 도우미                                                         */
/* ================================================================== */

let toastCounter = 0;
/** 화면 아래에 잠깐 나타나는 알림 메시지 */
export function notify(message: string, kind: Toast['kind'] = 'info'): void {
  toastCounter++;
  setState({ toast: { id: toastCounter, message, kind } });
}

/** 마우스 위치에 오른쪽 클릭 메뉴 열기 */
export function openContextMenu(x: number, y: number, items: ContextMenuEntry[]): void {
  setState({ contextMenu: { x, y, items } });
}

export function currentFrameObj(): Frame {
  const s = S();
  return s.project.frames[Math.min(s.currentFrame, s.project.frames.length - 1)];
}

export function currentLayer(): Layer | undefined {
  const s = S();
  return findLayer(s.project, s.currentLayerId);
}

/** 그리기 도구가 편집할 셀의 프레임 id (움직이는 레이어가 앞 그림을 쓰는 중이면 그 원본) */
export function currentEditFrameId(): string {
  const s = S();
  const layer = currentLayer();
  if (!layer) return currentFrameObj().id;
  return editableFrameId(s.project, layer, Math.min(s.currentFrame, s.project.frames.length - 1));
}

/** 문서가 바뀌었다고 알립니다. (화면 갱신 + 저장 안 됨 표시) */
export function touch(markDirty = true): void {
  setState((s) => ({ docVersion: s.docVersion + 1, dirty: markDirty ? true : s.dirty }));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 실행 취소 때 함께 되돌릴 "화면 상태" */
export interface UiSnapshot {
  layerId: string;
  frame: number;
  selection: Selection | null;
}

function uiSnapshot(): UiSnapshot {
  const s = S();
  return { layerId: s.currentLayerId, frame: s.currentFrame, selection: s.selection };
}

function applyUi(ui: UiSnapshot): void {
  const s = S();
  const p = s.project;
  const layerId = p.layers.some((l) => l.id === ui.layerId) ? ui.layerId : p.layers[p.layers.length - 1].id;
  const frame = clamp(ui.frame, 0, p.frames.length - 1);
  const selection = ui.selection && ui.selection.mask.length === p.width * p.height ? ui.selection : null;
  const selectedBoneId = p.bones.some((b) => b.id === s.selectedBoneId) ? s.selectedBoneId : null;
  setState({ currentLayerId: layerId, currentFrame: frame, selection, frameRange: null, selectedBoneId });
}

/* ================================================================== */
/* 실행 취소 기록 만들기                                                */
/* ================================================================== */

export interface StructureEditToken {
  before: StructureSnapshot;
  uiBefore: UiSnapshot;
}

/** 구조 변경을 "시작"합니다. (슬라이더처럼 여러 번 바뀌다가 끝나는 경우에 사용) */
export function beginStructureEdit(): StructureEditToken {
  return { before: snapshotStructure(S().project), uiBefore: uiSnapshot() };
}

/** 구조 변경을 "끝내고" 실행 취소 기록에 넣습니다. */
export function endStructureEdit(label: string, token: StructureEditToken, uiAfter?: Partial<UiSnapshot>): void {
  const p = S().project;
  const after = snapshotStructure(p);
  applyUi({ ...uiSnapshot(), ...uiAfter });
  const uiAfterFull = uiSnapshot();
  history.push({
    label,
    undo: () => {
      restoreStructure(p, token.before);
      applyUi(token.uiBefore);
    },
    redo: () => {
      restoreStructure(p, after);
      applyUi(uiAfterFull);
    },
  });
  touch();
}

/**
 * 프로젝트 구조(레이어/프레임/크기/팔레트 등)를 바꾸는 작업을 실행하고 기록합니다.
 * mutate 함수가 false 를 돌려주면 "변경 없음"으로 보고 기록하지 않습니다.
 * mutate 가 객체를 돌려주면 작업 후 선택할 레이어/프레임으로 사용합니다.
 */
export function commitStructure(label: string, mutate: (p: Project) => boolean | void | Partial<UiSnapshot>): boolean {
  const token = beginStructureEdit();
  const result = mutate(S().project);
  if (result === false) {
    // 변경이 없었다고 했지만 혹시 바뀐 부분이 있으면 되돌립니다.
    restoreStructure(S().project, token.before);
    return false;
  }
  endStructureEdit(label, token, typeof result === 'object' ? result : undefined);
  return true;
}

/**
 * 픽셀 변경을 기록합니다.
 * before: 작업 전에 복사해 둔 셀 픽셀. 지금 셀과 비교해서 바뀐 부분만 저장합니다.
 */
export function commitPixels(
  label: string,
  layerId: string,
  frameId: string,
  before: Uint8ClampedArray,
  sel?: { before: Selection | null; after: Selection | null },
): boolean {
  const p = S().project;
  const key = celKey(layerId, frameId);
  const cel = p.cels[key];
  if (!cel) return false;
  const patch = diffBuffers(before, cel, p.width, p.height);
  const selChanged = !!sel && sel.before !== sel.after;
  if (!patch && !selChanged) return false;
  const focus = () => {
    if (p.layers.some((l) => l.id === layerId)) setState({ currentLayerId: layerId });
  };
  if (patch) markEdited(cel);
  history.push({
    label,
    undo: () => {
      const c = p.cels[key];
      if (patch && c) {
        applyPatch(c, p.width, patch, 'before');
        markEdited(c);
      }
      if (sel && selChanged) setState({ selection: sel.before });
      focus();
    },
    redo: () => {
      const c = p.cels[key];
      if (patch && c) {
        applyPatch(c, p.width, patch, 'after');
        markEdited(c);
      }
      if (sel && selChanged) setState({ selection: sel.after });
      focus();
    },
  });
  touch();
  return true;
}

/** 선택 영역 변경을 기록합니다. (선택도 실행 취소할 수 있어요) */
export function commitSelection(label: string, next: Selection | null): void {
  const prev = S().selection;
  if (prev === next || (!prev && !next)) return;
  setState({ selection: next });
  history.push({
    label,
    undo: () => setState({ selection: prev }),
    redo: () => setState({ selection: next }),
  });
  touch(false);
}

export function undo(): void {
  const entry = history.undo();
  if (entry) {
    touch();
    notify(tr('toast.undo', { name: entry.label }));
  }
}

export function redo(): void {
  const entry = history.redo();
  if (entry) {
    touch();
    notify(tr('toast.redo', { name: entry.label }));
  }
}

/** 새 프로젝트로 통째로 바꿉니다. (실행 취소 기록은 초기화) */
export function replaceProject(project: Project, fileName: string | null): void {
  history.clear();
  const top = [...project.layers].reverse().find((l) => l.kind === 'pixel') ?? project.layers[project.layers.length - 1];
  setState((s) => ({
    project,
    docVersion: s.docVersion + 1,
    currentLayerId: top.id,
    currentFrame: 0,
    frameRange: null,
    selection: null,
    playing: false,
    activeTagId: null,
    selectedBoneId: null,
    fileName,
    dirty: false,
    fitRequest: s.fitRequest + 1,
  }));
}

/* ================================================================== */
/* 색                                                                   */
/* ================================================================== */

export function setColor(slot: 'primary' | 'secondary', color: Color): void {
  setState(slot === 'primary' ? { primary: color } : { secondary: color });
}

export function swapColors(): void {
  const s = S();
  setState({ primary: s.secondary, secondary: s.primary });
}

/* ================================================================== */
/* 레이어                                                               */
/* ================================================================== */

export function selectLayer(layerId: string): void {
  setState({ currentLayerId: layerId });
}

function addKindLayer(kind: LayerKind, label: string, name: string, configure?: (l: Layer) => void): void {
  commitStructure(label, (p) => {
    const layer = addLayerAbove(p, S().currentLayerId, name, kind);
    configure?.(layer);
    return { layerId: layer.id };
  });
}

export function addLayerAction(): void {
  const p = S().project;
  addKindLayer('pixel', tr('history.addLayer'), nextLayerName(p, tr('layer.defaultName')));
}

export function addGroupAction(): void {
  const p = S().project;
  addKindLayer('group', tr('history.addGroup'), nextLayerName(p, tr('layer.groupName')));
}

/** 밑그림(스케치) 레이어: 내보내기에서 빠지고, 반투명하게 보입니다. */
export function addSketchLayerAction(): void {
  const p = S().project;
  addKindLayer('pixel', tr('history.addSketch'), nextLayerName(p, tr('layer.sketchName')), (l) => {
    l.guide = true;
    l.opacity = 0.5;
  });
}

export function duplicateLayerAction(): void {
  commitStructure(tr('history.duplicateLayer'), (p) => {
    const copy = duplicateLayer(p, S().currentLayerId, tr('layer.copySuffix'));
    return copy ? { layerId: copy.id } : false;
  });
}

export function deleteLayerAction(layerId = S().currentLayerId): void {
  commitStructure(tr('history.deleteLayer'), (proj) => {
    const layer = findLayer(proj, layerId);
    if (!layer) return false;
    const sibs = proj.layers.filter((l) => l.parentId === layer.parentId);
    const i = sibs.indexOf(layer);
    if (!removeLayer(proj, layerId)) {
      notify(tr('toast.cannotDeleteLastLayer'), 'error');
      return false;
    }
    const next = sibs[i - 1] ?? sibs[i + 1] ?? findLayer(proj, layer.parentId) ?? proj.layers[proj.layers.length - 1];
    return { layerId: next.id };
  });
}

/** delta=+1 이면 위로, -1 이면 아래로 (같은 그룹 안에서) */
export function moveLayerBy(delta: 1 | -1): void {
  commitStructure(tr('history.moveLayer'), (p) => moveLayerAmongSiblings(p, S().currentLayerId, delta));
}

/** 끌어서 놓기: target 레이어의 위/아래/안(그룹)으로 옮기기 */
export function placeLayerAction(layerId: string, targetId: string, where: 'above' | 'below' | 'inside'): void {
  commitStructure(tr('history.moveLayer'), (p) => placeLayer(p, layerId, targetId, where));
}

export function mergeDownAction(): void {
  const s = S();
  const layer = currentLayer();
  if (!layer || !siblingBelow(s.project, layer) || siblingBelow(s.project, layer)?.kind === 'group') {
    notify(tr('toast.noLayerBelow'), 'error');
    return;
  }
  commitStructure(tr('history.mergeDown'), (proj) => {
    const lower = mergeDown(proj, s.currentLayerId);
    return lower ? { layerId: lower.id } : false;
  });
}

/** 움직임/효과/뼈대 결과를 실제 픽셀로 굽기 */
export function bakeLayerAction(layerId = S().currentLayerId): void {
  commitStructure(tr('history.bakeLayer'), (p) => bakeLayer(p, layerId));
  notify(tr('toast.baked'), 'success');
}

export function toggleLayerVisible(layerId: string): void {
  const layer = findLayer(S().project, layerId);
  if (!layer) return;
  layer.visible = !layer.visible;
  touch();
}

export function toggleLayerLocked(layerId: string): void {
  const layer = findLayer(S().project, layerId);
  if (!layer) return;
  layer.locked = !layer.locked;
  touch();
}

export function toggleLayerExpanded(layerId: string): void {
  const layer = findLayer(S().project, layerId);
  if (!layer) return;
  layer.expanded = !layer.expanded;
  touch(false);
}

export function toggleGuide(layerId = S().currentLayerId): void {
  commitStructure(tr('history.layerProps'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer || layer.kind === 'group') return false;
    layer.guide = !layer.guide;
  });
}

export function setLayerBlendMode(layerId: string, mode: BlendMode): void {
  commitStructure(tr('history.layerProps'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer || layer.blendMode === mode) return false;
    layer.blendMode = mode;
  });
}

export function renameLayer(layerId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  commitStructure(tr('history.renameLayer'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer || layer.name === trimmed) return false;
    layer.name = trimmed;
  });
}

/** 불투명도 슬라이더를 움직이는 동안 (기록 없이 미리보기) */
export function previewLayerOpacity(layerId: string, opacity: number): void {
  const layer = findLayer(S().project, layerId);
  if (!layer) return;
  layer.opacity = clamp(opacity, 0, 1);
  requestRender();
}

/* ================================================================== */
/* 프레임                                                               */
/* ================================================================== */

export function gotoFrame(index: number, keepRange = false): void {
  const p = S().project;
  setState({ currentFrame: clamp(index, 0, p.frames.length - 1), ...(keepRange ? {} : { frameRange: null }) });
}

export function nextFrame(): void {
  const s = S();
  gotoFrame((s.currentFrame + 1) % s.project.frames.length);
}

export function prevFrame(): void {
  const s = S();
  gotoFrame((s.currentFrame - 1 + s.project.frames.length) % s.project.frames.length);
}

/** Shift+클릭: 현재 프레임부터 index 까지 범위 선택 */
export function selectFrameRange(index: number): void {
  const s = S();
  const anchor = s.frameRange ? s.frameRange[0] : s.currentFrame;
  setState({ frameRange: [anchor, index], currentFrame: index });
}

/** 선택된 프레임 범위 [작은 값, 큰 값]. 범위가 없으면 현재 프레임 하나 */
export function selectedFrames(): [number, number] {
  const s = S();
  if (!s.frameRange) return [s.currentFrame, s.currentFrame];
  return [Math.min(...s.frameRange), Math.max(...s.frameRange)];
}

export function addFrameAction(): void {
  commitStructure(tr('history.addFrame'), (p) => {
    const at = S().currentFrame + 1;
    addFrame(p, at);
    return { frame: at };
  });
}

export function duplicateFramesAction(linked = S().linkOnDuplicate): void {
  const [a, b] = selectedFrames();
  commitStructure(tr('history.duplicateFrame'), (p) => {
    // 뒤에서부터 복제하면 인덱스가 꼬이지 않습니다. 복제본들은 원본 구간 바로 뒤에 놓입니다.
    for (let i = b; i >= a; i--) duplicateFrame(p, i, linked);
    // 위 방식은 [원본, 복제] 가 번갈아 놓이므로, 복제본들을 구간 뒤로 모읍니다.
    const count = b - a + 1;
    if (count > 1) {
      const block = p.frames.splice(a, count * 2);
      const originals = block.filter((_, i) => i % 2 === 0);
      const copies = block.filter((_, i) => i % 2 === 1);
      p.frames.splice(a, 0, ...originals, ...copies);
    }
    return { frame: b + 1 };
  });
}

export function deleteFramesAction(): void {
  const p = S().project;
  const [a, b] = selectedFrames();
  if (b - a + 1 >= p.frames.length) {
    notify(tr('toast.cannotDeleteAllFrames'), 'error');
    return;
  }
  commitStructure(tr('history.deleteFrame'), (proj) => {
    for (let i = b; i >= a; i--) removeFrame(proj, i);
    return { frame: Math.min(a, proj.frames.length - 1) };
  });
}

export function moveFrameAction(from: number, to: number): void {
  commitStructure(tr('history.moveFrame'), (p) => {
    if (!moveFrame(p, from, to)) return false;
    return { frame: clamp(to, 0, p.frames.length - 1) };
  });
}

export function moveCurrentFrameBy(delta: number): void {
  const s = S();
  const to = s.currentFrame + delta;
  if (to < 0 || to >= s.project.frames.length) return;
  moveFrameAction(s.currentFrame, to);
}

export function reverseFramesAction(): void {
  const [a, b] = selectedFrames();
  if (a === b) {
    notify(tr('toast.selectRangeFirst'), 'error');
    return;
  }
  commitStructure(tr('history.reverseFrames'), (p) => {
    reverseFrames(p, a, b);
  });
}

/** 여러 프레임의 재생 시간을 한 번에 바꿉니다. */
export function setFrameDurations(indices: number[], duration: number): void {
  const ms = clamp(Math.round(duration), 10, 60000);
  commitStructure(tr('history.frameDuration'), (p) => {
    let changed = false;
    for (const i of indices) {
      const f = p.frames[i];
      if (f && f.duration !== ms) {
        f.duration = ms;
        changed = true;
      }
    }
    return changed;
  });
}

/** 모든 프레임을 같은 속도(FPS)로 맞춥니다. */
export function setAllFps(fps: number): void {
  const p = S().project;
  setFrameDurations(
    p.frames.map((_, i) => i),
    1000 / clamp(fps, 1, 60),
  );
}

/* ================================================================== */
/* 태그                                                                 */
/* ================================================================== */

export function addTagAction(name: string, from: number, to: number): void {
  commitStructure(tr('history.addTag'), (p) => {
    addTag(p, name.trim() || tr('tag.defaultName'), from, to);
  });
}

export function updateTagAction(tagId: string, patch: Partial<Omit<Tag, 'id'>>): void {
  commitStructure(tr('history.editTag'), (p) => {
    const tag = p.tags.find((t) => t.id === tagId);
    if (!tag) return false;
    Object.assign(tag, patch);
    const last = p.frames.length - 1;
    tag.from = clamp(Math.min(tag.from, tag.to), 0, last);
    tag.to = clamp(Math.max(tag.from, tag.to), 0, last);
  });
}

export function deleteTagAction(tagId: string): void {
  if (S().activeTagId === tagId) setState({ activeTagId: null });
  commitStructure(tr('history.deleteTag'), (p) => {
    removeTag(p, tagId);
  });
}

/* ================================================================== */
/* 선택 영역                                                            */
/* ================================================================== */

export function selectAll(): void {
  const p = S().project;
  commitSelection(tr('history.selectAll'), selectionFromMask(fullMask(p.width * p.height), p.width, p.height));
}

export function deselect(): void {
  commitSelection(tr('history.deselect'), null);
}

export function invertSelection(): void {
  const p = S().project;
  const mask = invertMask(S().selection?.mask ?? null, p.width * p.height);
  commitSelection(tr('history.invertSelection'), selectionFromMask(mask, p.width, p.height));
}

/** 그림을 그릴 수 있는 상태인지 확인하고, 안 되면 이유를 알려줍니다. */
export function canEditCurrentLayer(): boolean {
  const layer = currentLayer();
  if (!layer) return false;
  const p = S().project;
  if (layer.kind !== 'pixel') {
    notify(tr('toast.notPixelLayer'), 'error');
    return false;
  }
  if (isEffectivelyLocked(p, layer)) {
    notify(tr('toast.layerLocked'), 'error');
    return false;
  }
  if (!isEffectivelyVisible(p, layer)) {
    notify(tr('toast.layerHidden'), 'error');
    return false;
  }
  return true;
}

/** 선택 영역 안의 픽셀 지우기 (선택이 없으면 현재 셀 전체) */
export function clearSelectionPixels(label = tr('history.clear')): void {
  if (!canEditCurrentLayer()) return;
  const s = S();
  const p = s.project;
  const frameId = currentEditFrameId();
  const cel = p.cels[celKey(s.currentLayerId, frameId)];
  if (!cel) return;
  const before = cloneBuffer(cel);
  const mask = s.selection?.mask;
  for (let i = 0; i < p.width * p.height; i++) {
    if (mask && !mask[i]) continue;
    cel[i * 4] = 0;
    cel[i * 4 + 1] = 0;
    cel[i * 4 + 2] = 0;
    cel[i * 4 + 3] = 0;
  }
  commitPixels(label, s.currentLayerId, frameId, before);
}

/** 선택 영역(또는 현재 셀 전체)을 좌우/상하 뒤집기 */
export function flipSelectionOrCel(axis: 'horizontal' | 'vertical'): void {
  if (!canEditCurrentLayer()) return;
  const s = S();
  const p = s.project;
  const frameId = currentEditFrameId();
  const cel = ensureCel(p, s.currentLayerId, frameId);
  const before = cloneBuffer(cel);
  const sel = s.selection;
  if (!sel) {
    const flipped = axis === 'horizontal' ? flipHorizontal(cel, p.width, p.height) : flipVertical(cel, p.width, p.height);
    cel.set(flipped);
    commitPixels(tr('history.flip'), s.currentLayerId, frameId, before);
    return;
  }
  const { x: bx, y: by, w: bw, h: bh } = sel.bounds;
  const newMask = new Uint8Array(sel.mask.length);
  // 1) 선택된 픽셀 지우기
  for (let i = 0; i < sel.mask.length; i++) {
    if (sel.mask[i]) {
      cel[i * 4] = 0;
      cel[i * 4 + 1] = 0;
      cel[i * 4 + 2] = 0;
      cel[i * 4 + 3] = 0;
    }
  }
  // 2) 뒤집힌 위치에 다시 찍기
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const i = y * p.width + x;
      if (!sel.mask[i]) continue;
      const nx = axis === 'horizontal' ? bx + bw - 1 - (x - bx) : x;
      const ny = axis === 'vertical' ? by + bh - 1 - (y - by) : y;
      newMask[ny * p.width + nx] = 1;
      const si = i * 4;
      setPixel(cel, p.width, nx, ny, ((before[si] << 24) | (before[si + 1] << 16) | (before[si + 2] << 8) | before[si + 3]) >>> 0);
    }
  }
  const nextSel = selectionFromMask(newMask, p.width, p.height);
  commitPixels(tr('history.flip'), s.currentLayerId, frameId, before, { before: sel, after: nextSel });
}

/* ================================================================== */
/* 캔버스 전체                                                          */
/* ================================================================== */

export function resizeCanvasAction(width: number, height: number, anchorX: number, anchorY: number): void {
  commitStructure(tr('history.canvasSize'), (p) => {
    if (p.width === width && p.height === height) return false;
    resizeCanvas(p, width, height, anchorX, anchorY);
    return { selection: null };
  });
  setState((s) => ({ fitRequest: s.fitRequest + 1 }));
}

export function scaleSpriteAction(width: number, height: number): void {
  commitStructure(tr('history.scaleSprite'), (p) => {
    if (p.width === width && p.height === height) return false;
    scaleProject(p, width, height);
    return { selection: null };
  });
  setState((s) => ({ fitRequest: s.fitRequest + 1 }));
}

export function flipCanvasAction(axis: 'horizontal' | 'vertical'): void {
  commitStructure(tr('history.flipCanvas'), (p) => {
    flipProject(p, axis);
    return { selection: null };
  });
}

export function rotateCanvasAction(clockwise: boolean): void {
  commitStructure(tr('history.rotateCanvas'), (p) => {
    rotateProject(p, clockwise);
    return { selection: null };
  });
  setState((s) => ({ fitRequest: s.fitRequest + 1 }));
}

/* ================================================================== */
/* 팔레트                                                               */
/* ================================================================== */

export function setPaletteColors(colors: Color[], label = tr('history.palette')): void {
  commitStructure(label, (p) => {
    p.palette = colors.slice();
  });
  setState({ paletteIndex: -1 });
}

export function loadPalettePreset(id: string): void {
  setPaletteColors(presetToColors(getPreset(id)), tr('history.loadPalette'));
  setState({ paletteId: id });
}

export function addColorToPalette(color: Color): void {
  const p = S().project;
  const existing = p.palette.indexOf(color);
  if (existing >= 0) {
    setState({ paletteIndex: existing });
    notify(tr('toast.colorExists'));
    return;
  }
  commitStructure(tr('history.addColor'), (proj) => {
    proj.palette = [...proj.palette, color];
  });
  setState({ paletteIndex: S().project.palette.length - 1 });
}

export function removePaletteColor(index: number): void {
  if (index < 0) return;
  commitStructure(tr('history.removeColor'), (p) => {
    if (index >= p.palette.length) return false;
    p.palette = p.palette.filter((_, i) => i !== index);
  });
  setState({ paletteIndex: -1 });
}

/** 그림에서 쓰인 색으로 팔레트 만들기 */
export function extractPaletteFromSprite(): void {
  const p = S().project;
  const set = new Set<number>();
  for (const key of Object.keys(p.cels)) {
    for (const c of uniqueColors(p.cels[key], 256)) {
      set.add(c);
      if (set.size >= 256) break;
    }
    if (set.size >= 256) break;
  }
  if (set.size === 0) {
    notify(tr('toast.noColorsInSprite'), 'error');
    return;
  }
  setPaletteColors(Array.from(set), tr('history.extractPalette'));
  notify(tr('toast.paletteExtracted', { count: set.size }), 'success');
}

export function sortPaletteByBrightness(): void {
  const colors = S().project.palette.slice().sort((a, b) => luminance(a) - luminance(b));
  setPaletteColors(colors, tr('history.sortPalette'));
}
