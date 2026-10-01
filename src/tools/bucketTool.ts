/**
 * 채우기(페인트 통) 도구
 * ------------------------------------------------------------
 *  - "이어진 영역만" 옵션이 켜져 있으면 클릭한 곳과 연결된 같은 색만 채웁니다.
 *  - 꺼져 있으면 그림 전체에서 같은 색을 모두 바꿉니다. (색 교체 효과)
 */
import { floodFillMask } from '../core/drawing';
import { tr } from '../i18n';
import { getState } from '../store/editorStore';
import { PixelEditSession } from './session';
import type { Tool, ToolPointer } from './types';

export class BucketTool implements Tool {
  readonly layerSpace = true;

  begin(e: ToolPointer): void {
    const session = PixelEditSession.start();
    if (!session) return;
    const s = getState();
    if (e.x < 0 || e.y < 0 || e.x >= session.width || e.y >= session.height) return;
    const color = e.button === 2 ? s.secondary : s.primary;
    const mask = floodFillMask(session.cel, session.width, session.height, e.x, e.y, s.fillContiguous, s.fillTolerance, session.mask);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) session.plot(i % session.width, Math.floor(i / session.width), color);
    }
    session.changed();
    session.commit(tr('tool.bucket'));
  }

  move(): void {}

  end(): void {}
}
