/**
 * 도형 도구: 직선 / 사각형 / 타원
 * ------------------------------------------------------------
 * 끄는 동안에는 "원본으로 되돌리기 → 도형 다시 그리기"를 반복해서 미리보기를 보여줍니다.
 *  - Shift: 직선은 45° 단위, 사각형/타원은 정사각형/정원
 *  - Ctrl: 클릭한 점을 중심으로 그리기 (사각형/타원)
 */
import {
  brushOffsets,
  constrainLine,
  constrainSquare,
  ellipsePoints,
  linePoints,
  rectPoints,
} from '../core/drawing';
import type { Color, Point } from '../core/types';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { getState } from '../store/editorStore';
import { PixelEditSession } from './session';
import type { Tool, ToolPointer } from './types';

export type ShapeKind = 'line' | 'rect' | 'ellipse';

export class ShapeTool implements Tool {
  private session: PixelEditSession | null = null;
  private start: Point = { x: 0, y: 0 };
  private color: Color = 0;
  readonly layerSpace = true;

  constructor(private readonly kind: ShapeKind) {}

  begin(e: ToolPointer): void {
    const session = PixelEditSession.start();
    if (!session) return;
    this.session = session;
    this.start = { x: e.x, y: e.y };
    const s = getState();
    this.color = e.button === 2 ? s.secondary : s.primary;
    this.update(e);
  }

  move(e: ToolPointer): void {
    this.update(e);
  }

  end(e: ToolPointer): void {
    if (!this.session) return;
    this.update(e);
    const label = tr(this.kind === 'line' ? 'tool.line' : this.kind === 'rect' ? 'tool.rect' : 'tool.ellipse');
    this.session.commit(label);
    this.session = null;
  }

  cancel(): void {
    if (this.session) {
      this.session.restore();
      this.session.changed();
      this.session = null;
      requestRender();
    }
  }

  private update(e: ToolPointer): void {
    const session = this.session;
    if (!session) return;
    session.restore();
    const s = getState();
    let x0 = this.start.x;
    let y0 = this.start.y;
    let end: Point = { x: e.x, y: e.y };
    let points: Point[];
    if (this.kind === 'line') {
      if (e.shift) end = constrainLine(x0, y0, end.x, end.y);
      points = linePoints(x0, y0, end.x, end.y);
    } else {
      if (e.shift) end = constrainSquare(x0, y0, end.x, end.y);
      if (e.ctrl) {
        // 중심에서 그리기: 시작점을 반대편으로 펼칩니다.
        x0 = this.start.x - (end.x - this.start.x);
        y0 = this.start.y - (end.y - this.start.y);
      }
      points =
        this.kind === 'rect'
          ? rectPoints(x0, y0, end.x, end.y, s.shapeFilled)
          : ellipsePoints(x0, y0, end.x, end.y, s.shapeFilled);
    }
    // 채워진 도형은 1px 로, 테두리는 브러시 크기로 그립니다.
    const offsets = this.kind !== 'line' && s.shapeFilled ? [{ x: 0, y: 0 }] : brushOffsets(s.brushSize, s.brushShape);
    for (const p of points) session.stamp(p.x, p.y, offsets, this.color);
    session.changed();
  }
}
