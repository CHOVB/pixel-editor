/**
 * 이동 도구
 * ------------------------------------------------------------
 *  - 선택 영역이 있으면: 선택된 픽셀만 들어서 옮깁니다.
 *  - 선택 영역이 없으면: 현재 레이어(현재 프레임) 전체를 옮깁니다.
 *  - 방향키로 1픽셀씩, Shift+방향키로 10픽셀씩 옮길 수 있습니다.
 *
 * "들어 올린 상태(lift)"를 기억하기 때문에 여러 번 나눠서 옮겨도
 * 아래에 있던 그림이 지워지지 않습니다. (다른 작업을 하면 내려놓기 됩니다)
 */
import { cloneBuffer, createBuffer } from '../core/pixels';
import { ensureCel } from '../core/project';
import { fullMask, selectionFromMask, translateMask } from '../core/selection';
import type { Selection } from '../core/types';
import { markEdited } from '../core/versions';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { canEditCurrentLayer, commitPixels, currentEditFrameId } from '../store/actions';
import { getState, setState } from '../store/editorStore';
import type { Tool, ToolPointer } from './types';

interface Lift {
  layerId: string;
  frameId: string;
  /** 들어 올린 픽셀을 뺀 나머지 그림 */
  base: Uint8ClampedArray;
  /** 들어 올린 픽셀 (캔버스 크기, 원래 위치 기준) */
  floating: Uint8ClampedArray;
  /** 원래 위치 기준 선택 마스크 (선택 없이 옮기면 null) */
  mask: Uint8Array | null;
  dx: number;
  dy: number;
  /** 이 lift 가 유효한 문서 버전. 다른 작업으로 버전이 바뀌면 새로 들어 올립니다. */
  version: number;
}

interface Drag {
  startX: number;
  startY: number;
  startDx: number;
  startDy: number;
  before: Uint8ClampedArray;
  selBefore: Selection | null;
}

export class MoveTool implements Tool {
  private lift: Lift | null = null;
  private drag: Drag | null = null;

  /** 외부(붙여넣기)에서 "떠 있는 픽셀"을 직접 만들어 줄 때 사용 */
  setLift(lift: Omit<Lift, 'version'>): void {
    this.lift = { ...lift, version: getState().docVersion };
  }

  private ensureLift(): Lift | null {
    const s = getState();
    const p = s.project;
    const frameId = currentEditFrameId();
    const valid =
      this.lift &&
      this.lift.version === s.docVersion &&
      this.lift.layerId === s.currentLayerId &&
      this.lift.frameId === frameId &&
      this.lift.base.length === p.width * p.height * 4;
    if (valid) return this.lift;

    const cel = ensureCel(p, s.currentLayerId, frameId);
    const sel = s.selection;
    const mask = sel ? sel.mask : fullMask(p.width * p.height);
    const base = cloneBuffer(cel);
    const floating = createBuffer(p.width, p.height);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const k = i * 4;
      floating[k] = cel[k];
      floating[k + 1] = cel[k + 1];
      floating[k + 2] = cel[k + 2];
      floating[k + 3] = cel[k + 3];
      base[k] = 0;
      base[k + 1] = 0;
      base[k + 2] = 0;
      base[k + 3] = 0;
    }
    this.lift = {
      layerId: s.currentLayerId,
      frameId,
      base,
      floating,
      mask: sel ? sel.mask : null,
      dx: 0,
      dy: 0,
      version: s.docVersion,
    };
    return this.lift;
  }

  /** lift 상태를 셀에 반영: 바탕 + (dx,dy) 만큼 옮긴 픽셀 */
  private apply(): void {
    const lift = this.lift;
    if (!lift) return;
    const p = getState().project;
    const w = p.width;
    const h = p.height;
    const cel = ensureCel(p, lift.layerId, lift.frameId);
    cel.set(lift.base);
    for (let y = 0; y < h; y++) {
      const ny = y + lift.dy;
      if (ny < 0 || ny >= h) continue;
      for (let x = 0; x < w; x++) {
        const nx = x + lift.dx;
        if (nx < 0 || nx >= w) continue;
        const s = (y * w + x) * 4;
        if (lift.floating[s + 3] === 0) continue; // 투명 픽셀은 아래 그림을 가리지 않습니다.
        const d = (ny * w + nx) * 4;
        cel[d] = lift.floating[s];
        cel[d + 1] = lift.floating[s + 1];
        cel[d + 2] = lift.floating[s + 2];
        cel[d + 3] = lift.floating[s + 3];
      }
    }
    if (lift.mask) {
      const moved = translateMask(lift.mask, w, h, lift.dx, lift.dy);
      setState({ selection: selectionFromMask(moved, w, h) });
    }
    markEdited(cel);
    requestRender();
  }

  begin(e: ToolPointer): void {
    if (!canEditCurrentLayer()) return;
    const lift = this.ensureLift();
    if (!lift) return;
    const p = getState().project;
    this.drag = {
      startX: e.x,
      startY: e.y,
      startDx: lift.dx,
      startDy: lift.dy,
      before: cloneBuffer(ensureCel(p, lift.layerId, lift.frameId)),
      selBefore: getState().selection,
    };
  }

  move(e: ToolPointer): void {
    const drag = this.drag;
    const lift = this.lift;
    if (!drag || !lift) return;
    const dx = drag.startDx + (e.x - drag.startX);
    const dy = drag.startDy + (e.y - drag.startY);
    if (dx === lift.dx && dy === lift.dy) return;
    lift.dx = dx;
    lift.dy = dy;
    this.apply();
  }

  end(): void {
    const drag = this.drag;
    const lift = this.lift;
    this.drag = null;
    if (!drag || !lift) return;
    const changed = commitPixels(tr('tool.move'), lift.layerId, lift.frameId, drag.before, {
      before: drag.selBefore,
      after: getState().selection,
    });
    // 우리가 만든 기록이므로 lift 를 계속 유효하게 유지합니다.
    if (changed) lift.version = getState().docVersion;
  }

  cancel(): void {
    const drag = this.drag;
    const lift = this.lift;
    if (drag && lift) {
      lift.dx = drag.startDx;
      lift.dy = drag.startDy;
      this.apply();
    }
    this.drag = null;
  }

  /** 방향키로 조금씩 옮기기 */
  nudge(dx: number, dy: number): void {
    const pointer: ToolPointer = { x: 0, y: 0, fx: 0, fy: 0, zoom: 1, button: 0, shift: false, ctrl: false, alt: false };
    this.begin(pointer);
    if (!this.drag) return;
    this.move({ ...pointer, x: dx, y: dy, fx: dx, fy: dy });
    this.end();
  }
}
