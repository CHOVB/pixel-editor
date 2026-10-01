/**
 * 키보드 단축키
 * ------------------------------------------------------------
 * 단축키 목록(SHORTCUTS)은 "실제 동작"과 "도움말 화면"이 함께 사용합니다.
 * 그래서 여기만 고치면 도움말도 자동으로 바뀝니다.
 *
 * 한글 입력 상태에서도 단축키가 동작하도록 e.key 대신 e.code(물리 키 위치)를 사용합니다.
 *   예) 한글 모드에서 B 키를 누르면 e.key 는 'ㅠ' 이지만 e.code 는 항상 'KeyB'
 */
import type { TKey } from '../i18n';
import {
  addFrameAction,
  addLayerAction,
  clearSelectionPixels,
  deselect,
  duplicateFramesAction,
  flipSelectionOrCel,
  invertSelection,
  moveLayerBy,
  nextFrame,
  prevFrame,
  redo,
  selectAll,
  swapColors,
  undo,
} from '../store/actions';
import { getState, setState, type ToolId } from '../store/editorStore';
import { moveTool, TOOL_LIST, TOOLS, type ToolInfo } from '../tools';
import { copySelection, cutSelection } from './clipboard';
import { confirmDiscard, openFile, saveProject } from './fileActions';
import { actualSize, fitToScreen, zoomStep } from './view';

export type ShortcutGroup = 'file' | 'edit' | 'tools' | 'view' | 'animation';

export interface Shortcut {
  /** 화면에 표시할 키 조합, 예: 'Ctrl+Z' */
  label: string;
  code: string | string[];
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  group: ShortcutGroup;
  desc: TKey;
  run: () => void;
  /** 도움말에만 표시하고 실제 처리는 다른 곳에서 하는 경우 */
  displayOnly?: boolean;
}

export function setTool(tool: ToolId): void {
  const s = getState();
  if (s.tool === tool) return;
  TOOLS[s.tool].cancel?.();
  setState({ tool });
}

function changeBrush(delta: number): void {
  const s = getState();
  setState({ brushSize: Math.max(1, Math.min(64, s.brushSize + delta)) });
}

function togglePlay(): void {
  setState((s) => ({ playing: !s.playing }));
}

/** 방향키: 이동 도구이거나 선택 영역이 있으면 픽셀 이동, 아니면 프레임/레이어 이동 */
function arrow(dx: number, dy: number, big: boolean): void {
  const s = getState();
  if (s.tool === 'move' || s.selection) {
    const step = big ? 10 : 1;
    moveTool.nudge(dx * step, dy * step);
    return;
  }
  if (dx > 0) nextFrame();
  else if (dx < 0) prevFrame();
  else if (dy !== 0) {
    const p = s.project;
    const idx = p.layers.findIndex((l) => l.id === s.currentLayerId);
    const next = p.layers[Math.max(0, Math.min(p.layers.length - 1, idx - dy))];
    if (next) setState({ currentLayerId: next.id });
  }
}

const toolShortcuts: Shortcut[] = TOOL_LIST.filter((t): t is ToolInfo => !!t).map((t) => ({
  label: t.key,
  code: t.code,
  group: 'tools' as const,
  desc: t.name,
  run: () => setTool(t.id),
}));

export const SHORTCUTS: Shortcut[] = [
  // 파일
  // Ctrl+N 은 브라우저가 "새 창"으로 가로채므로 Alt+N 도 함께 제공합니다.
  { label: 'Alt+N', code: 'KeyN', alt: true, group: 'file', desc: 'menu.new', run: () => confirmDiscard(() => setState({ dialog: { id: 'new' } })) },
  { label: 'Ctrl+N', code: 'KeyN', ctrl: true, group: 'file', desc: 'menu.new', run: () => confirmDiscard(() => setState({ dialog: { id: 'new' } })) },
  { label: 'Ctrl+O', code: 'KeyO', ctrl: true, group: 'file', desc: 'menu.open', run: () => confirmDiscard(() => void openFile()) },
  { label: 'Ctrl+S', code: 'KeyS', ctrl: true, group: 'file', desc: 'menu.save', run: () => void saveProject(false) },
  { label: 'Ctrl+Shift+S', code: 'KeyS', ctrl: true, shift: true, group: 'file', desc: 'menu.saveAs', run: () => void saveProject(true) },
  { label: 'Ctrl+E', code: 'KeyE', ctrl: true, group: 'file', desc: 'menu.export', run: () => setState({ dialog: { id: 'export' } }) },

  // 편집
  { label: 'Ctrl+Z', code: 'KeyZ', ctrl: true, group: 'edit', desc: 'menu.undo', run: undo },
  { label: 'Ctrl+Shift+Z', code: 'KeyZ', ctrl: true, shift: true, group: 'edit', desc: 'menu.redo', run: redo },
  { label: 'Ctrl+Y', code: 'KeyY', ctrl: true, group: 'edit', desc: 'menu.redo', run: redo },
  { label: 'Ctrl+C', code: 'KeyC', ctrl: true, group: 'edit', desc: 'menu.copy', run: () => void copySelection() },
  { label: 'Ctrl+X', code: 'KeyX', ctrl: true, group: 'edit', desc: 'menu.cut', run: cutSelection },
  { label: 'Ctrl+V', code: 'KeyV', ctrl: true, group: 'edit', desc: 'menu.paste', run: () => {}, displayOnly: true },
  { label: 'Delete', code: ['Delete', 'Backspace'], group: 'edit', desc: 'menu.clear', run: () => clearSelectionPixels() },
  { label: 'Ctrl+A', code: 'KeyA', ctrl: true, group: 'edit', desc: 'menu.selectAll', run: selectAll },
  { label: 'Ctrl+D', code: 'KeyD', ctrl: true, group: 'edit', desc: 'menu.deselect', run: deselect },
  { label: 'Ctrl+Shift+I', code: 'KeyI', ctrl: true, shift: true, group: 'edit', desc: 'menu.invertSelection', run: invertSelection },
  { label: 'Shift+H', code: 'KeyH', shift: true, group: 'edit', desc: 'menu.flipH', run: () => flipSelectionOrCel('horizontal') },
  { label: 'Shift+V', code: 'KeyV', shift: true, group: 'edit', desc: 'menu.flipV', run: () => flipSelectionOrCel('vertical') },
  { label: 'X', code: 'KeyX', group: 'edit', desc: 'shortcut.swapColors', run: swapColors },
  { label: '[', code: 'BracketLeft', group: 'edit', desc: 'shortcut.brushSmaller', run: () => changeBrush(-1) },
  { label: ']', code: 'BracketRight', group: 'edit', desc: 'shortcut.brushBigger', run: () => changeBrush(1) },
  { label: 'Esc', code: 'Escape', group: 'edit', desc: 'shortcut.escape', run: () => {}, displayOnly: true },

  // 도구
  ...toolShortcuts,
  { label: 'Alt + ' + 'Click', code: '', group: 'tools', desc: 'shortcut.altPick', run: () => {}, displayOnly: true },
  { label: 'Space + Drag', code: '', group: 'tools', desc: 'shortcut.spacePan', run: () => {}, displayOnly: true },

  // 보기
  { label: '+', code: ['Equal', 'NumpadAdd'], group: 'view', desc: 'menu.zoomIn', run: () => zoomStep(1) },
  { label: '-', code: ['Minus', 'NumpadSubtract'], group: 'view', desc: 'menu.zoomOut', run: () => zoomStep(-1) },
  { label: '0', code: ['Digit0', 'Numpad0'], group: 'view', desc: 'menu.fit', run: fitToScreen },
  { label: '1', code: ['Digit1', 'Numpad1'], group: 'view', desc: 'menu.actualSize', run: actualSize },
  { label: 'Ctrl+G', code: 'KeyG', ctrl: true, group: 'view', desc: 'menu.grid', run: () => setState((s) => ({ showGrid: !s.showGrid })) },
  { label: 'Shift+O', code: 'KeyO', shift: true, group: 'view', desc: 'menu.onion', run: () => setState((s) => ({ onion: { ...s.onion, enabled: !s.onion.enabled } })) },
  { label: 'F1', code: 'F1', group: 'view', desc: 'menu.shortcuts', run: () => setState({ dialog: { id: 'shortcuts' } }) },

  // 애니메이션
  { label: 'Enter', code: ['Enter', 'NumpadEnter'], group: 'animation', desc: 'shortcut.play', run: togglePlay },
  { label: ',', code: 'Comma', group: 'animation', desc: 'shortcut.prevFrame', run: prevFrame },
  { label: '.', code: 'Period', group: 'animation', desc: 'shortcut.nextFrame', run: nextFrame },
  { label: '← →', code: '', group: 'animation', desc: 'shortcut.arrowsFrame', run: () => {}, displayOnly: true },
  { label: '↑ ↓', code: '', group: 'animation', desc: 'shortcut.arrowsLayer', run: () => {}, displayOnly: true },
  { label: 'N', code: 'KeyN', group: 'animation', desc: 'menu.newFrame', run: addFrameAction },
  { label: 'Shift+D', code: 'KeyD', shift: true, group: 'animation', desc: 'menu.duplicateFrame', run: duplicateFramesAction },
  { label: 'Shift+N', code: 'KeyN', shift: true, group: 'animation', desc: 'menu.newLayer', run: addLayerAction },
  { label: 'Ctrl+↑ / Ctrl+↓', code: '', group: 'animation', desc: 'shortcut.moveLayer', run: () => {}, displayOnly: true },
];

function matches(sc: Shortcut, e: KeyboardEvent): boolean {
  if (sc.displayOnly || !sc.code) return false;
  const codes = Array.isArray(sc.code) ? sc.code : [sc.code];
  if (!codes.includes(e.code)) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  return !!sc.ctrl === ctrl && !!sc.shift === e.shiftKey && !!sc.alt === e.altKey;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || target.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(type);
  }
  return tag === 'SELECT';
}

/**
 * 전역 키보드 처리. 처리했으면 true 를 돌려줍니다.
 * (App 컴포넌트가 window 의 keydown 이벤트에 연결합니다)
 */
export function handleKeyDown(e: KeyboardEvent): boolean {
  const s = getState();
  if (isTyping(e.target)) return false;
  // 다이얼로그가 열려 있으면 Esc 만 처리 (닫기는 다이얼로그가 담당)
  if (s.dialog) return false;

  if (e.code === 'Escape') {
    TOOLS[s.tool].cancel?.();
    if (s.selection) deselect();
    if (s.playing) setState({ playing: false });
    return true;
  }

  // 방향키
  const ctrl = e.ctrlKey || e.metaKey;
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (arrows[e.code]) {
    const [dx, dy] = arrows[e.code];
    if (ctrl && dy !== 0) moveLayerBy(-dy);
    else arrow(dx, dy, e.shiftKey);
    return true;
  }

  for (const sc of SHORTCUTS) {
    if (matches(sc, e)) {
      sc.run();
      return true;
    }
  }
  return false;
}
