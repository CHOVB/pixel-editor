/**
 * 연필 / 지우개 / 디더 브러시
 * ------------------------------------------------------------
 *  - 연필: 왼쪽 클릭 = 주 색, 오른쪽 클릭 = 보조 색
 *  - 지우개: 투명하게 지웁니다.
 *  - 디더: 체크무늬로 주 색/보조 색을 번갈아 칠합니다. (픽셀아트 명암 표현에 자주 사용)
 *
 *  Shift+클릭: 마지막으로 찍은 점에서 지금 점까지 직선
 *  Alt+클릭: 스포이드 (색 가져오기)
 */
import { brushOffsets, dedupeConsecutive, linePoints, pixelPerfect } from '../core/drawing';
import type { Color, Point } from '../core/types';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { getState } from '../store/editorStore';
import { pickColorAt } from './pickerTool';
import { PixelEditSession } from './session';
import type { Tool, ToolPointer } from './types';

export type FreehandMode = 'pencil' | 'eraser' | 'dither';

/** Shift+클릭 직선을 위해 마지막 점을 기억합니다. (도구끼리 공유) */
let lastPoint: { layerId: string; frameId: string; x: number; y: number } | null = null;

export class FreehandTool implements Tool {
  private session: PixelEditSession | null = null;
  private points: Point[] = [];
  private drawnCount = 0;
  private picking = false;
  private colorFn: (x: number, y: number) => Color = () => 0;
  private offsets: Point[] = [{ x: 0, y: 0 }];
  private usePixelPerfect = false;
  readonly layerSpace = true;

  constructor(private readonly mode: FreehandMode) {}

  begin(e: ToolPointer): void {
    if (e.alt && this.mode !== 'eraser') {
      this.picking = true;
      pickColorAt(e.x, e.y, e.button);
      return;
    }
    const session = PixelEditSession.start();
    if (!session) return;
    this.session = session;
    const s = getState();
    const main = e.button === 2 ? s.secondary : s.primary;
    const sub = e.button === 2 ? s.primary : s.secondary;
    if (this.mode === 'eraser') this.colorFn = () => 0;
    else if (this.mode === 'dither') this.colorFn = (x, y) => (((x + y) & 1) === 0 ? main : sub);
    else this.colorFn = () => main;
    this.offsets = brushOffsets(s.brushSize, s.brushShape);
    this.usePixelPerfect = s.pixelPerfect && s.brushSize === 1 && this.mode !== 'dither';

    const start =
      e.shift && lastPoint && lastPoint.layerId === session.layerId && lastPoint.frameId === session.frameId
        ? { x: lastPoint.x, y: lastPoint.y }
        : { x: e.x, y: e.y };
    this.points = linePoints(start.x, start.y, e.x, e.y);
    this.drawnCount = 0;
    this.draw();
  }

  move(e: ToolPointer): void {
    if (this.picking) {
      pickColorAt(e.x, e.y, e.button);
      return;
    }
    if (!this.session) return;
    const last = this.points[this.points.length - 1];
    if (last.x === e.x && last.y === e.y) return;
    this.points.push(...linePoints(last.x, last.y, e.x, e.y).slice(1));
    this.draw();
  }

  end(): void {
    if (this.picking) {
      this.picking = false;
      return;
    }
    const session = this.session;
    if (!session) return;
    const last = this.points[this.points.length - 1];
    lastPoint = { layerId: session.layerId, frameId: session.frameId, x: last.x, y: last.y };
    const label = this.mode === 'eraser' ? tr('tool.eraser') : this.mode === 'dither' ? tr('tool.dither') : tr('tool.pencil');
    session.commit(label);
    this.session = null;
    this.points = [];
  }

  cancel(): void {
    if (this.session) {
      this.session.restore();
      this.session.changed();
      this.session = null;
      requestRender();
    }
  }

  private draw(): void {
    const session = this.session;
    if (!session) return;
    if (this.usePixelPerfect) {
      // 픽셀 퍼펙트: 매번 처음부터 다시 그려야 "ㄱ"자 모서리를 정확히 제거할 수 있습니다.
      session.restore();
      for (const p of pixelPerfect(dedupeConsecutive(this.points))) {
        session.stamp(p.x, p.y, this.offsets, this.colorFn);
      }
    } else {
      for (let i = this.drawnCount; i < this.points.length; i++) {
        const p = this.points[i];
        session.stamp(p.x, p.y, this.offsets, this.colorFn);
      }
      this.drawnCount = this.points.length;
    }
    session.changed();
  }
}
