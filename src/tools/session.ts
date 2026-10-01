/**
 * 픽셀 편집 세션
 * ------------------------------------------------------------
 * "한 번의 붓질" 동안 필요한 정보를 묶어 둔 클래스입니다.
 *  1) 시작할 때 셀의 원본을 복사해 둡니다. (base)
 *  2) 그리는 동안 셀 픽셀을 직접 바꿉니다.
 *  3) 끝날 때 원본과 비교해서 바뀐 부분만 실행 취소 기록에 넣습니다.
 *
 * 선택 영역이 있으면 그 안에만 그려지고, 대칭 모드면 반대편에도 함께 그려집니다.
 */
import type { Color } from '../core/types';
import { cloneBuffer, setPixel } from '../core/pixels';
import { ensureCel } from '../core/project';
import type { Point } from '../core/types';
import { canEditCurrentLayer, commitPixels, currentFrameObj } from '../store/actions';
import { getState } from '../store/editorStore';
import { requestRender } from '../editor/renderBus';

export class PixelEditSession {
  readonly layerId: string;
  readonly frameId: string;
  readonly width: number;
  readonly height: number;
  readonly cel: Uint8ClampedArray;
  readonly base: Uint8ClampedArray;
  readonly mask: Uint8Array | null;
  private readonly symX: boolean;
  private readonly symY: boolean;

  private constructor() {
    const s = getState();
    const p = s.project;
    this.layerId = s.currentLayerId;
    this.frameId = currentFrameObj().id;
    this.width = p.width;
    this.height = p.height;
    this.cel = ensureCel(p, this.layerId, this.frameId);
    this.base = cloneBuffer(this.cel);
    this.mask = s.selection?.mask ?? null;
    this.symX = s.symmetryX;
    this.symY = s.symmetryY;
  }

  /** 편집을 시작합니다. 잠긴/숨긴 레이어면 null 을 돌려줍니다. */
  static start(): PixelEditSession | null {
    if (!canEditCurrentLayer()) return null;
    return new PixelEditSession();
  }

  /** 셀을 시작 상태로 되돌립니다. (도형 미리보기를 다시 그릴 때 사용) */
  restore(): void {
    this.cel.set(this.base);
  }

  /** 한 픽셀 칠하기 (캔버스 밖이거나 선택 영역 밖이면 무시) */
  plot(x: number, y: number, color: Color): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (this.mask && !this.mask[y * this.width + x]) return;
    setPixel(this.cel, this.width, x, y, color);
  }

  /** 대칭 모드를 고려해서 칠하기 */
  plotSym(x: number, y: number, color: Color | ((x: number, y: number) => Color)): void {
    const pick = typeof color === 'function' ? color : () => color;
    this.plot(x, y, pick(x, y));
    const mx = this.width - 1 - x;
    const my = this.height - 1 - y;
    if (this.symX) this.plot(mx, y, pick(mx, y));
    if (this.symY) this.plot(x, my, pick(x, my));
    if (this.symX && this.symY) this.plot(mx, my, pick(mx, my));
  }

  /** 브러시 모양(offsets)으로 한 점 찍기 */
  stamp(x: number, y: number, offsets: Point[], color: Color | ((x: number, y: number) => Color)): void {
    for (const o of offsets) this.plotSym(x + o.x, y + o.y, color);
  }

  /** 편집을 마치고 실행 취소 기록에 넣습니다. */
  commit(label: string): void {
    commitPixels(label, this.layerId, this.frameId, this.base);
    requestRender();
  }
}
