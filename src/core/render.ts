/**
 * 합성(Compositing)
 * ------------------------------------------------------------
 * 여러 레이어를 아래에서 위로 겹쳐서 "한 장의 그림"으로 만듭니다.
 * 화면 표시, 썸네일, PNG/GIF 내보내기가 모두 이 함수를 사용합니다.
 */
import { blendOver, createBuffer, fillBuffer } from './pixels';
import { celKey } from './project';
import type { Color, Project } from './types';

export interface CompositeOptions {
  /** 숨긴 레이어도 포함할지 (기본 false) */
  includeHidden?: boolean;
  /** 배경색 (기본: 투명) */
  background?: Color | null;
  /**
   * 특정 레이어의 픽셀을 이 버퍼로 대신 사용합니다.
   * (선택 영역 이동 중 미리보기 등에 사용)
   */
  override?: { layerId: string; pixels: Uint8ClampedArray };
}

export function compositeFrame(p: Project, frameIndex: number, options: CompositeOptions = {}): Uint8ClampedArray {
  const out = createBuffer(p.width, p.height);
  if (options.background != null) fillBuffer(out, options.background);
  const frame = p.frames[frameIndex];
  if (!frame) return out;
  for (const layer of p.layers) {
    if (!layer.visible && !options.includeHidden) continue;
    const cel =
      options.override && options.override.layerId === layer.id
        ? options.override.pixels
        : p.cels[celKey(layer.id, frame.id)];
    if (!cel) continue;
    blendOver(out, cel, layer.opacity);
  }
  return out;
}
