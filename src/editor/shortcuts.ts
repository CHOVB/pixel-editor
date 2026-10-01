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
import { gotoNeighborKey, linkCelsAction, openInbetweenDialog, toggleKeyframeAction } from '../store/animActions';
import { getState, setState, type ToolId } from '../store/editorStore';
import { loadPrefs, savePrefs } from '../store/prefs';
import { moveTool, TOOL_LIST, TOOLS, type ToolInfo } from '../tools';
import { copySelection, cutSelection } from './clipboard';
import { confirmDiscard, openFile, saveProject } from './fileActions';
import { actualSize, fitToScreen, zoomStep } from './view';

export type ShortcutGroup = 'file' | 'edit' | 'tools' | 'view' | 'animation' | 'helpers';

export interface Shortcut {
  /** 사용자 설정 저장용 이름 (아래에서 자동으로 붙임) */
  id?: string;
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
  { label: 'Ctrl+,', code: 'Comma', ctrl: true, group: 'file', desc: 'menu.settings', run: () => setState({ dialog: { id: 'settings' } }) },

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
  { label: 'K', code: 'KeyK', group: 'animation', desc: 'menu.addKey', run: toggleKeyframeAction },
  { label: 'Shift+,', code: 'Comma', shift: true, group: 'animation', desc: 'timeline.prevKey', run: () => gotoNeighborKey(-1) },
  { label: 'Shift+.', code: 'Period', shift: true, group: 'animation', desc: 'timeline.nextKey', run: () => gotoNeighborKey(1) },
  { label: 'Alt+L', code: 'KeyL', alt: true, group: 'animation', desc: 'menu.linkCels', run: linkCelsAction },
  { label: 'Alt+T', code: 'KeyT', alt: true, group: 'animation', desc: 'menu.frameTransform', run: () => setState({ dialog: { id: 'frameTransform' } }) },

  // 도우미 기능
  { label: 'Shift+I', code: 'KeyI', shift: true, group: 'helpers', desc: 'menu.inbetween', run: openInbetweenDialog },
  { label: 'Shift+A', code: 'KeyA', shift: true, group: 'helpers', desc: 'menu.autoAnimate', run: () => setState({ dialog: { id: 'autoAnimate' } }) },
  { label: 'Shift+X', code: 'KeyX', shift: true, group: 'helpers', desc: 'menu.vfx', run: () => setState({ dialog: { id: 'vfx' } }) },
  { label: 'Shift+L', code: 'KeyL', shift: true, group: 'helpers', desc: 'menu.cleanup', run: () => setState({ dialog: { id: 'cleanup' } }) },
  { label: 'Shift+R', code: 'KeyR', shift: true, group: 'helpers', desc: 'menu.replaceColor', run: () => setState({ dialog: { id: 'replaceColor' } }) },
  { label: 'Shift+B', code: 'KeyB', shift: true, group: 'helpers', desc: 'bones.show', run: () => setState((s) => ({ showBones: !s.showBones })) },
];

/* ------------------------------------------------------------------ */
/* 단축키 바꾸기 (설정 화면)                                               */
/* ------------------------------------------------------------------ */

export interface KeyBinding {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

const CODE_LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Escape: 'Esc',
  Space: 'Space',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadEnter: 'Enter',
};

/** 'KeyK' → 'K', 'Digit1' → '1' 처럼 사람이 읽기 쉬운 이름 */
export function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function bindingLabel(b: KeyBinding): string {
  return [b.ctrl ? 'Ctrl' : '', b.alt ? 'Alt' : '', b.shift ? 'Shift' : '', codeLabel(b.code)].filter(Boolean).join('+');
}

function bindingToString(b: KeyBinding): string {
  return [b.ctrl ? 'ctrl' : '', b.alt ? 'alt' : '', b.shift ? 'shift' : '', b.code].filter(Boolean).join('+');
}

function bindingFromString(text: string): KeyBinding | null {
  const parts = text.split('+').filter(Boolean);
  const code = parts.pop();
  if (!code) return null;
  return { code, ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') };
}

/** 키보드 입력 → 키 조합 (Ctrl/Shift/Alt 만 누른 경우와 방향키·Esc 는 쓸 수 없음) */
export function bindingFromEvent(e: KeyboardEvent): KeyBinding | null {
  if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock'].includes(e.code)) return null;
  if (e.code.startsWith('Arrow') || e.code === 'Escape' || !e.code) return null;
  return { code: e.code, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
}

const defaults = new Map<string, KeyBinding & { label: string }>();

// 각 단축키에 저장용 이름을 붙이고, 처음 값을 "기본값"으로 기억해 둡니다.
{
  const seen = new Map<string, number>();
  for (const sc of SHORTCUTS) {
    const n = seen.get(sc.desc) ?? 0;
    seen.set(sc.desc, n + 1);
    sc.id = n ? `${sc.desc}#${n}` : sc.desc;
    if (!sc.displayOnly && typeof sc.code === 'string' && sc.code) {
      defaults.set(sc.id, { code: sc.code, ctrl: !!sc.ctrl, shift: !!sc.shift, alt: !!sc.alt, label: sc.label });
    }
  }
}

/** 바꿀 수 있는 단축키 목록 (도움말 전용 항목, 여러 키를 쓰는 항목 제외) */
export function customizableShortcuts(): Shortcut[] {
  return SHORTCUTS.filter((sc) => sc.id && defaults.has(sc.id));
}

export function isCustomized(sc: Shortcut): boolean {
  const d = sc.id ? defaults.get(sc.id) : undefined;
  return !!d && (d.code !== sc.code || d.ctrl !== !!sc.ctrl || d.shift !== !!sc.shift || d.alt !== !!sc.alt);
}

/** 같은 키 조합을 쓰는 다른 단축키 */
export function findConflict(id: string, b: KeyBinding): Shortcut | undefined {
  return SHORTCUTS.find((sc) => {
    if (sc.id === id || sc.displayOnly) return false;
    const codes = Array.isArray(sc.code) ? sc.code : [sc.code];
    return codes.includes(b.code) && !!sc.ctrl === b.ctrl && !!sc.shift === b.shift && !!sc.alt === b.alt;
  });
}

/** 저장된 사용자 설정을 단축키 목록에 반영 */
export function applyShortcutOverrides(overrides: Record<string, string>): void {
  for (const sc of SHORTCUTS) {
    const d = sc.id ? defaults.get(sc.id) : undefined;
    if (!d) continue;
    const custom = sc.id ? bindingFromString(overrides[sc.id] ?? '') : null;
    const b = custom ?? d;
    sc.code = b.code;
    sc.ctrl = b.ctrl;
    sc.shift = b.shift;
    sc.alt = b.alt;
    sc.label = custom ? bindingLabel(custom) : d.label;
  }
  setState((s) => ({ shortcutsVersion: s.shortcutsVersion + 1 }));
}

/** 단축키 하나 바꾸기 (binding=null 이면 기본값으로) */
export function setShortcutBinding(id: string, binding: KeyBinding | null): void {
  const overrides = { ...(loadPrefs().shortcuts ?? {}) };
  if (binding) overrides[id] = bindingToString(binding);
  else delete overrides[id];
  savePrefs({ shortcuts: overrides });
  applyShortcutOverrides(overrides);
}

export function resetAllShortcuts(): void {
  savePrefs({ shortcuts: {} });
  applyShortcutOverrides({});
}

/** 메뉴/툴팁에 보여줄 현재 단축키 글자 (desc 가 같은 첫 번째 단축키) */
export function shortcutLabel(desc: TKey, fallback = ''): string {
  return SHORTCUTS.find((sc) => sc.desc === desc && !sc.displayOnly)?.label ?? fallback;
}

applyShortcutOverrides(loadPrefs().shortcuts ?? {});

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
    if (ctrl && dy !== 0) moveLayerBy(dy < 0 ? 1 : -1);
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
