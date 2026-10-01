/**
 * 도구 목록 (Tool Registry)
 * ------------------------------------------------------------
 * 툴바에 표시되는 순서, 단축키, 아이콘, 설명이 모두 여기 정의됩니다.
 * 새 도구를 만들면 이 파일에 한 줄 추가하면 됩니다.
 */
import type { TKey } from '../i18n';
import type { ToolId } from '../store/editorStore';
import { BoneCreateTool, PoseTool } from './boneTools';
import { BucketTool } from './bucketTool';
import { FreehandTool } from './brushTools';
import { MoveTool } from './moveTool';
import { PickerTool } from './pickerTool';
import { LassoTool, RectSelectTool, WandTool } from './selectTools';
import { ShapeTool } from './shapeTools';
import { TransformTool } from './transformTool';
import type { Tool } from './types';

export const moveTool = new MoveTool();
export const transformTool = new TransformTool();

/** 손 도구(화면 이동)는 캔버스가 직접 처리하므로 빈 도구입니다. */
const handTool: Tool = { begin() {}, move() {}, end() {} };

export const TOOLS: Record<ToolId, Tool> = {
  pencil: new FreehandTool('pencil'),
  eraser: new FreehandTool('eraser'),
  dither: new FreehandTool('dither'),
  bucket: new BucketTool(),
  line: new ShapeTool('line'),
  rect: new ShapeTool('rect'),
  ellipse: new ShapeTool('ellipse'),
  picker: new PickerTool(),
  select: new RectSelectTool(),
  lasso: new LassoTool(),
  wand: new WandTool(),
  move: moveTool,
  transform: transformTool,
  bone: new BoneCreateTool(),
  pose: new PoseTool(),
  hand: handTool,
};

export interface ToolInfo {
  id: ToolId;
  /** 표시용 단축키 */
  key: string;
  /** KeyboardEvent.code (한글 입력 상태에서도 동작하도록 code 를 사용) */
  code: string;
  name: TKey;
  hint: TKey;
}

/** 툴바 표시 순서. null 은 구분선입니다. */
export const TOOL_LIST: (ToolInfo | null)[] = [
  { id: 'pencil', key: 'B', code: 'KeyB', name: 'tool.pencil', hint: 'hint.pencil' },
  { id: 'eraser', key: 'E', code: 'KeyE', name: 'tool.eraser', hint: 'hint.eraser' },
  { id: 'bucket', key: 'G', code: 'KeyG', name: 'tool.bucket', hint: 'hint.bucket' },
  { id: 'picker', key: 'I', code: 'KeyI', name: 'tool.picker', hint: 'hint.picker' },
  { id: 'dither', key: 'D', code: 'KeyD', name: 'tool.dither', hint: 'hint.dither' },
  null,
  { id: 'line', key: 'L', code: 'KeyL', name: 'tool.line', hint: 'hint.line' },
  { id: 'rect', key: 'U', code: 'KeyU', name: 'tool.rect', hint: 'hint.rect' },
  { id: 'ellipse', key: 'O', code: 'KeyO', name: 'tool.ellipse', hint: 'hint.ellipse' },
  null,
  { id: 'select', key: 'M', code: 'KeyM', name: 'tool.select', hint: 'hint.select' },
  { id: 'lasso', key: 'Q', code: 'KeyQ', name: 'tool.lasso', hint: 'hint.lasso' },
  { id: 'wand', key: 'W', code: 'KeyW', name: 'tool.wand', hint: 'hint.wand' },
  { id: 'move', key: 'V', code: 'KeyV', name: 'tool.move', hint: 'hint.move' },
  null,
  { id: 'transform', key: 'T', code: 'KeyT', name: 'tool.transform', hint: 'hint.transform' },
  { id: 'bone', key: 'J', code: 'KeyJ', name: 'tool.bone', hint: 'hint.bone' },
  { id: 'pose', key: 'P', code: 'KeyP', name: 'tool.pose', hint: 'hint.pose' },
  null,
  { id: 'hand', key: 'H', code: 'KeyH', name: 'tool.hand', hint: 'hint.hand' },
];

export function toolInfo(id: ToolId): ToolInfo {
  return TOOL_LIST.find((t): t is ToolInfo => !!t && t.id === id) as ToolInfo;
}

/** 이 도구가 브러시 크기를 사용하는지 */
export function usesBrush(id: ToolId): boolean {
  return id === 'pencil' || id === 'eraser' || id === 'dither' || id === 'line' || id === 'rect' || id === 'ellipse';
}

/** 뼈대를 화면에 보여줘야 하는 도구인지 */
export function showsBones(id: ToolId): boolean {
  return id === 'bone' || id === 'pose';
}
