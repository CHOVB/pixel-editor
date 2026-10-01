/**
 * 에디터 전체 상태 (Zustand Store)
 * ------------------------------------------------------------
 * 화면 곳곳(툴바, 캔버스, 타임라인, 팔레트...)이 함께 쓰는 "공용 상태"를 한 곳에 모았습니다.
 *
 *  - 읽기:  컴포넌트에서  const tool = useEditor((s) => s.tool);
 *  - 쓰기:  useEditor.setState({ tool: 'pencil' })  또는  store/actions.ts 의 함수 사용
 *
 * project 객체는 성능을 위해 "직접 수정(mutable)" 합니다.
 * 대신 수정 후에는 docVersion 숫자를 올려서 화면이 다시 그려지도록 알려줍니다.
 */
import { create } from 'zustand';
import { packColor } from '../core/color';
import type { BrushShape } from '../core/drawing';
import { DEFAULT_PALETTE_ID, getPreset, presetToColors } from '../core/palettes';
import { createProject } from '../core/project';
import type { Color, Point, Project, Selection } from '../core/types';
import { en } from '../i18n/en';
import { ko } from '../i18n/ko';
import { loadPrefs } from './prefs';

export type ToolId =
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'picker'
  | 'select'
  | 'lasso'
  | 'wand'
  | 'move'
  | 'hand'
  | 'dither'
  | 'transform'
  | 'bone'
  | 'pose';

export type Lang = 'ko' | 'en';
export type LoopMode = 'loop' | 'pingpong' | 'once';
export type TileMode = 'none' | 'x' | 'y' | 'both';
export type Theme = 'dark' | 'light' | 'system';

export type DialogId =
  | 'welcome'
  | 'new'
  | 'export'
  | 'canvasSize'
  | 'scale'
  | 'shortcuts'
  | 'about'
  | 'frameDuration'
  | 'layerProps'
  | 'tag'
  | 'confirm'
  | 'importSheet'
  | 'inbetween'
  | 'replaceColor'
  | 'pixelFixer'
  | 'codex'
  | 'partFill'
  | 'vfx'
  | 'cleanup'
  | 'settings'
  | 'tutorial'
  | 'license'
  | 'crash';

export interface DialogState {
  id: DialogId;
  /** 다이얼로그에 넘길 추가 정보 (예: 편집할 태그 id) */
  payload?: Record<string, unknown>;
}

export interface OnionSettings {
  enabled: boolean;
  before: number;
  after: number;
  /** 0 ~ 1 */
  opacity: number;
  /** 이전=빨강, 다음=파랑 색조 입히기 */
  tint: boolean;
  /** 처음/끝을 이어서 보기 (반복 애니메이션용) */
  wrap: boolean;
  /** 항상 함께 보여줄 기준 프레임 (null = 없음) */
  pinnedFrameId: string | null;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

export type ContextMenuEntry =
  | {
      label: string;
      run: () => void;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      shortcut?: string;
    }
  | 'sep';

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
}

export interface EditorState {
  /* ---------- 문서 ---------- */
  project: Project;
  /** project 가 바뀔 때마다 1씩 증가 (화면 갱신 신호) */
  docVersion: number;
  currentLayerId: string;
  currentFrame: number;
  /** 타임라인에서 Shift+클릭으로 고른 프레임 범위 [시작, 끝] */
  frameRange: [number, number] | null;
  selection: Selection | null;

  /* ---------- 도구 ---------- */
  tool: ToolId;
  primary: Color;
  secondary: Color;
  /** 색 선택기가 지금 편집 중인 색 */
  activeSlot: 'primary' | 'secondary';
  brushSize: number;
  brushShape: BrushShape;
  pixelPerfect: boolean;
  fillContiguous: boolean;
  fillTolerance: number;
  shapeFilled: boolean;
  symmetryX: boolean;
  symmetryY: boolean;

  /* ---------- 화면 ---------- */
  zoom: number;
  panX: number;
  panY: number;
  /** 값이 바뀌면 캔버스가 "화면에 맞추기"를 실행합니다. */
  fitRequest: number;
  showGrid: boolean;
  showTileGrid: boolean;
  tileSize: number;
  /** 반복 타일 미리보기 */
  tileMode: TileMode;
  /** 아래쪽(타임라인) 영역 높이 */
  bottomHeight: number;

  /* ---------- 애니메이션 ---------- */
  playing: boolean;
  loopMode: LoopMode;
  /** 재생할 태그 (null 이면 전체 프레임) */
  activeTagId: string | null;
  onion: OnionSettings;
  /** 프레임 복제 시 그림을 공유(링크)할지 */
  linkOnDuplicate: boolean;

  /* ---------- 뼈대 ---------- */
  selectedBoneId: string | null;
  showBones: boolean;
  /** 자세 도구에서 IK(끝을 끌면 팔 전체가 따라옴) 사용 */
  ikEnabled: boolean;
  ikChain: number;

  /* ---------- 파일 / UI ---------- */
  fileName: string | null;
  dirty: boolean;
  language: Lang;
  theme: Theme;
  uiScale: number;
  dialog: DialogState | null;
  toast: Toast | null;
  contextMenu: ContextMenuState | null;
  /** 마우스가 가리키는 픽셀 좌표 (상태바 표시용) */
  cursor: Point | null;
  paletteId: string;
  /** 팔레트에서 선택한 칸 번호 (-1 = 없음) */
  paletteIndex: number;
  /** 오른쪽 패널 구역 접힘 상태 (예: { color: true }) */
  collapsed: Record<string, boolean>;
}

const COLLAPSE_KEY = 'pixel-editor:collapsed:v2';

/** 접힘 상태 불러오기. 저장된 값이 없으면 화면이 낮을 때 색 선택기를 접어 둡니다. */
function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(COLLAPSE_KEY) : null;
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // 무시하고 기본값 사용
  }
  const short = typeof window !== 'undefined' && window.innerHeight < 900;
  return { color: short, effects: true, bones: true, animation: false };
}

export function saveCollapsed(collapsed: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
  } catch {
    // 무시
  }
}

const prefs = loadPrefs();
const initialLanguage: Lang =
  prefs.language ?? (typeof navigator !== 'undefined' && navigator.language?.startsWith('ko') ? 'ko' : 'en');
const dict = initialLanguage === 'ko' ? ko : en;
const initialPalette = presetToColors(getPreset(prefs.paletteId ?? DEFAULT_PALETTE_ID));
const initialProject = createProject(32, 32, {
  name: dict['project.untitled'],
  palette: initialPalette,
  layerName: `${dict['layer.defaultName']} 1`,
});

const defaultOnion: OnionSettings = { enabled: false, before: 1, after: 1, opacity: 0.35, tint: true, wrap: false, pinnedFrameId: null };

export const useEditor = create<EditorState>(() => ({
  project: initialProject,
  docVersion: 0,
  currentLayerId: initialProject.layers[0].id,
  currentFrame: 0,
  frameRange: null,
  selection: null,

  tool: 'pencil',
  primary: packColor(24, 20, 37),
  secondary: packColor(255, 255, 255),
  activeSlot: 'primary',
  brushSize: prefs.brushSize ?? 1,
  brushShape: prefs.brushShape ?? 'square',
  pixelPerfect: prefs.pixelPerfect ?? true,
  fillContiguous: true,
  fillTolerance: 0,
  shapeFilled: false,
  symmetryX: false,
  symmetryY: false,

  zoom: 16,
  panX: 0,
  panY: 0,
  fitRequest: 1,
  showGrid: prefs.showGrid ?? true,
  showTileGrid: prefs.showTileGrid ?? false,
  tileSize: prefs.tileSize ?? 16,
  tileMode: 'none',
  bottomHeight: prefs.bottomHeight ?? 210,

  playing: false,
  loopMode: 'loop',
  activeTagId: null,
  onion: { ...defaultOnion, ...(prefs.onion ?? {}), pinnedFrameId: null },
  linkOnDuplicate: prefs.linkOnDuplicate ?? false,

  selectedBoneId: null,
  showBones: true,
  ikEnabled: true,
  ikChain: 2,

  fileName: null,
  dirty: false,
  language: initialLanguage,
  theme: prefs.theme ?? 'dark',
  uiScale: prefs.uiScale ?? 1,
  dialog: { id: 'welcome' },
  toast: null,
  contextMenu: null,
  cursor: null,
  paletteId: prefs.paletteId ?? DEFAULT_PALETTE_ID,
  paletteIndex: -1,
  collapsed: loadCollapsed(),
}));

/** 상태를 바로 읽을 때 쓰는 짧은 별칭 (컴포넌트 밖에서 사용) */
export const getState = useEditor.getState;
export const setState = useEditor.setState;
