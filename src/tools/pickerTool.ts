/**
 * 스포이드(색 추출) 도구
 * ------------------------------------------------------------
 * 클릭한 위치의 색을 "보이는 그대로"(모든 레이어 합성) 가져옵니다.
 * 왼쪽 클릭 = 주 색, 오른쪽 클릭 = 보조 색.
 * 다른 그리기 도구에서도 Alt+클릭으로 바로 사용할 수 있습니다.
 */
import { getPixel } from '../core/pixels';
import { compositeFrame } from '../core/render';
import { setColor } from '../store/actions';
import { getState } from '../store/editorStore';
import type { Tool, ToolPointer } from './types';

export function pickColorAt(x: number, y: number, button: number): void {
  const s = getState();
  const p = s.project;
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  const image = compositeFrame(p, s.currentFrame);
  const color = getPixel(image, p.width, x, y);
  // 완전히 투명한 곳은 무시합니다. (초보자가 "투명색"을 집어서 아무것도 안 그려지는 혼란 방지)
  if ((color & 255) === 0) return;
  setColor(button === 2 ? 'secondary' : 'primary', color);
}

export class PickerTool implements Tool {
  private active = false;

  begin(e: ToolPointer): void {
    this.active = true;
    pickColorAt(e.x, e.y, e.button);
  }

  move(e: ToolPointer): void {
    if (this.active) pickColorAt(e.x, e.y, e.button);
  }

  end(): void {
    this.active = false;
  }
}
