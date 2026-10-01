/**
 * 선택 도구: 사각형 선택 / 올가미 / 마술봉
 * ------------------------------------------------------------
 *  - 그냥 드래그: 새로 선택
 *  - Shift + 드래그: 기존 선택에 추가
 *  - Alt + 드래그: 기존 선택에서 빼기
 *  - 사각형 선택 도구로 그냥 클릭(드래그 없이): 선택 해제
 */
import { floodFillMask, linePoints, polygonMask } from '../core/drawing';
import { celKey } from '../core/project';
import { combineMasks, rectMask, selectionFromMask, type SelectMode } from '../core/selection';
import type { Point } from '../core/types';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { commitSelection, currentFrameObj } from '../store/actions';
import { getState } from '../store/editorStore';
import type { Tool, ToolOverlay, ToolPointer } from './types';

function modeFrom(e: ToolPointer): SelectMode {
  if (e.alt) return 'subtract';
  if (e.shift) return 'add';
  return 'replace';
}

function clampPoint(x: number, y: number): Point {
  const p = getState().project;
  return { x: Math.max(0, Math.min(p.width - 1, x)), y: Math.max(0, Math.min(p.height - 1, y)) };
}

function applyMask(mask: Uint8Array, mode: SelectMode, label: string): void {
  const s = getState();
  const p = s.project;
  const combined = combineMasks(s.selection?.mask ?? null, mask, mode);
  commitSelection(label, selectionFromMask(combined, p.width, p.height));
}

export class RectSelectTool implements Tool {
  private start: Point | null = null;
  private current: Point = { x: 0, y: 0 };
  private mode: SelectMode = 'replace';
  private moved = false;

  begin(e: ToolPointer): void {
    this.start = clampPoint(e.x, e.y);
    this.current = this.start;
    this.mode = modeFrom(e);
    this.moved = false;
    requestRender();
  }

  move(e: ToolPointer): void {
    if (!this.start) return;
    const next = clampPoint(e.x, e.y);
    if (next.x !== this.start.x || next.y !== this.start.y) this.moved = true;
    this.current = next;
    requestRender();
  }

  end(): void {
    if (!this.start) return;
    const p = getState().project;
    if (!this.moved && this.mode === 'replace') {
      commitSelection(tr('history.deselect'), null);
    } else {
      const mask = rectMask(p.width, p.height, this.start.x, this.start.y, this.current.x, this.current.y);
      applyMask(mask, this.mode, tr('tool.select'));
    }
    this.start = null;
    requestRender();
  }

  cancel(): void {
    this.start = null;
    requestRender();
  }

  overlay(): ToolOverlay | null {
    if (!this.start) return null;
    return { kind: 'rect', x0: this.start.x, y0: this.start.y, x1: this.current.x, y1: this.current.y };
  }
}

export class LassoTool implements Tool {
  private points: Point[] = [];
  private active = false;
  private mode: SelectMode = 'replace';

  begin(e: ToolPointer): void {
    this.active = true;
    this.mode = modeFrom(e);
    this.points = [clampPoint(e.x, e.y)];
    requestRender();
  }

  move(e: ToolPointer): void {
    if (!this.active) return;
    const last = this.points[this.points.length - 1];
    const next = clampPoint(e.x, e.y);
    if (last.x === next.x && last.y === next.y) return;
    this.points.push(...linePoints(last.x, last.y, next.x, next.y).slice(1));
    requestRender();
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    const p = getState().project;
    if (this.points.length < 3) {
      if (this.mode === 'replace') commitSelection(tr('history.deselect'), null);
    } else {
      applyMask(polygonMask(this.points, p.width, p.height), this.mode, tr('tool.lasso'));
    }
    this.points = [];
    requestRender();
  }

  cancel(): void {
    this.active = false;
    this.points = [];
    requestRender();
  }

  overlay(): ToolOverlay | null {
    return this.active ? { kind: 'path', points: this.points } : null;
  }
}

export class WandTool implements Tool {
  begin(e: ToolPointer): void {
    const s = getState();
    const p = s.project;
    if (e.x < 0 || e.y < 0 || e.x >= p.width || e.y >= p.height) return;
    const frame = currentFrameObj();
    const cel = p.cels[celKey(s.currentLayerId, frame.id)] ?? new Uint8ClampedArray(p.width * p.height * 4);
    const mask = floodFillMask(cel, p.width, p.height, e.x, e.y, s.fillContiguous, s.fillTolerance);
    applyMask(mask, modeFrom(e), tr('tool.wand'));
    requestRender();
  }

  move(): void {}

  end(): void {}
}
