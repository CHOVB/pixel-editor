/**
 * 변형(Transform) 도구 – 키프레임 애니메이션의 핵심
 * ------------------------------------------------------------
 * 레이어 주변에 상자가 나타납니다.
 *  - 상자 안을 끌기: 이동
 *  - 모서리 네모 끌기: 크기 (Shift = 비율 유지)
 *  - 위쪽 동그라미(또는 상자 바깥) 끌기: 회전 (Shift = 15° 단위)
 *  - 가운데 십자(+) 끌기: 회전/크기의 중심점 옮기기
 *
 * 끌고 나면 "지금 프레임"에 키프레임이 자동으로 찍힙니다. (오토 키)
 * 예) 1프레임에서 왼쪽에 두고, 8프레임에서 오른쪽으로 옮기면 → 2~7프레임이 자동으로 채워짐
 */
import { apply, rotateDeg, type Mat } from '../core/affine';
import { evaluateTrack, setKey } from '../core/keyframes';
import { contentBounds } from '../core/pixels';
import { renderLayer } from '../core/render';
import type { Point, Rect, TransformValues } from '../core/types';
import { tweenMatrix } from '../core/layerSpace';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { ensureTrack } from '../store/animActions';
import { beginStructureEdit, currentLayer, endStructureEdit, notify, type StructureEditToken } from '../store/actions';
import { getState } from '../store/editorStore';
import { isEffectivelyLocked } from '../core/project';
import type { Tool, ToolOverlay, ToolPointer } from './types';

type Mode = 'move' | 'rotate' | 'scale' | 'pivot';

interface Geometry {
  corners: Point[];
  rotateHandle: Point;
  pivot: Point;
  bounds: Rect;
  values: TransformValues;
  matrix: Mat;
}

interface Drag {
  mode: Mode;
  token: StructureEditToken;
  startFx: number;
  startFy: number;
  start: TransformValues;
  startAngle: number;
  startLocal: Point;
  startPivot: Point;
  frameId: string;
  changed: boolean;
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class TransformTool implements Tool {
  private drag: Drag | null = null;
  private hoverMode: Mode | null = null;
  private zoom = 8;

  /** 현재 레이어의 변형 상자 계산 */
  private geometry(): Geometry | null {
    const s = getState();
    const p = s.project;
    const layer = currentLayer();
    if (!layer || layer.kind === 'reference') return null;
    // 키프레임 적용 "전" 모습의 범위 (뼈대는 반영). 키는 남겨 두되 값만 기본값으로 바꿔야
    // "앞 프레임 그림 유지(hold)" 규칙이 그대로 적용됩니다.
    const neutralAnim = layer.anim
      ? { ...layer.anim, keys: layer.anim.keys.map((k) => ({ ...k, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 })) }
      : null;
    const plain = renderLayer(p, { ...layer, anim: neutralAnim, effects: [] }, s.currentFrame, { includeHidden: true, includeGuides: true });
    const bounds = (plain && contentBounds(plain.buf, p.width, p.height)) || { x: 0, y: 0, w: p.width, h: p.height };
    const values = evaluateTrack(p, layer.anim, s.currentFrame);
    const matrix = tweenMatrix(p, layer, s.currentFrame);
    const { x, y, w, h } = bounds;
    const corners = [apply(matrix, x, y), apply(matrix, x + w, y), apply(matrix, x + w, y + h), apply(matrix, x, y + h)];
    const top = apply(matrix, x + w / 2, y);
    const up = apply(rotateDeg(values.rotation), 0, -1);
    const flip = values.scaleY < 0 ? -1 : 1;
    const rotateHandle = { x: top.x + (up.x * flip * 14) / this.zoom, y: top.y + (up.y * flip * 14) / this.zoom };
    const pivotSrc = layer.anim ? { x: layer.anim.pivotX, y: layer.anim.pivotY } : { x: x + w / 2, y: y + h / 2 };
    const pivot = { x: pivotSrc.x + values.x, y: pivotSrc.y + values.y };
    return { corners, rotateHandle, pivot, bounds, values, matrix };
  }

  private hitTest(e: ToolPointer, g: Geometry): Mode {
    const pt = { x: e.fx, y: e.fy };
    const r = 7 / e.zoom;
    if (dist(pt, g.rotateHandle) <= r * 1.4) return 'rotate';
    if (dist(pt, g.pivot) <= r) return 'pivot';
    if (g.corners.some((c) => dist(pt, c) <= r * 1.3)) return 'scale';
    if (pointInPolygon(pt, g.corners)) return 'move';
    const nearBox = g.corners.some((c) => dist(pt, c) <= r * 4);
    return nearBox ? 'rotate' : 'move';
  }

  hover(e: ToolPointer): void {
    this.zoom = e.zoom;
    if (this.drag) return;
    const g = this.geometry();
    const mode = g ? this.hitTest(e, g) : null;
    if (mode !== this.hoverMode) {
      this.hoverMode = mode;
      requestRender();
    }
  }

  begin(e: ToolPointer): void {
    this.zoom = e.zoom;
    const s = getState();
    const p = s.project;
    const layer = currentLayer();
    if (!layer || layer.kind === 'reference') return;
    if (isEffectivelyLocked(p, layer)) {
      notify(tr('toast.layerLocked'), 'error');
      return;
    }
    const g = this.geometry();
    if (!g) return;
    const mode = this.hitTest(e, g);
    const token = beginStructureEdit();
    ensureTrack(p, layer, s.currentFrame);
    const local = apply(rotateDeg(-g.values.rotation), e.fx - g.pivot.x, e.fy - g.pivot.y);
    this.drag = {
      mode,
      token,
      startFx: e.fx,
      startFy: e.fy,
      start: { ...g.values },
      startAngle: Math.atan2(e.fy - g.pivot.y, e.fx - g.pivot.x),
      startLocal: local,
      startPivot: g.pivot,
      frameId: p.frames[s.currentFrame].id,
      changed: false,
    };
  }

  move(e: ToolPointer): void {
    const drag = this.drag;
    const layer = currentLayer();
    if (!drag || !layer?.anim) return;
    const track = layer.anim;
    const v: TransformValues = { ...drag.start };
    if (drag.mode === 'move') {
      v.x = drag.start.x + Math.round(e.fx - drag.startFx);
      v.y = drag.start.y + Math.round(e.fy - drag.startFy);
    } else if (drag.mode === 'rotate') {
      const angle = Math.atan2(e.fy - drag.startPivot.y, e.fx - drag.startPivot.x);
      let deg = drag.start.rotation + ((angle - drag.startAngle) * 180) / Math.PI;
      deg = e.shift ? Math.round(deg / 15) * 15 : Math.round(deg);
      v.rotation = deg;
    } else if (drag.mode === 'scale') {
      const local = apply(rotateDeg(-drag.start.rotation), e.fx - drag.startPivot.x, e.fy - drag.startPivot.y);
      const s0 = drag.startLocal;
      if (e.shift) {
        const k = Math.hypot(local.x, local.y) / Math.max(0.5, Math.hypot(s0.x, s0.y));
        v.scaleX = drag.start.scaleX * k;
        v.scaleY = drag.start.scaleY * k;
      } else {
        if (Math.abs(s0.x) > 0.5) v.scaleX = drag.start.scaleX * (local.x / s0.x);
        if (Math.abs(s0.y) > 0.5) v.scaleY = drag.start.scaleY * (local.y / s0.y);
      }
      v.scaleX = Math.round(v.scaleX * 100) / 100 || 0.01;
      v.scaleY = Math.round(v.scaleY * 100) / 100 || 0.01;
    } else if (drag.mode === 'pivot') {
      track.pivotX = Math.round(e.fx - drag.start.x);
      track.pivotY = Math.round(e.fy - drag.start.y);
      drag.changed = true;
      requestRender();
      return;
    }
    setKey(track, drag.frameId, v);
    drag.changed = true;
    requestRender();
  }

  end(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (!drag.changed) {
      // 클릭만 했으면: 키프레임이 없을 때만 현재 값으로 키를 찍습니다.
      const layer = currentLayer();
      const s = getState();
      if (layer?.anim && !layer.anim.keys.some((k) => k.frameId === drag.frameId)) {
        setKey(layer.anim, drag.frameId, evaluateTrack(s.project, layer.anim, s.currentFrame));
      }
    }
    endStructureEdit(drag.mode === 'pivot' ? tr('history.pivot') : tr('history.keyframe'), drag.token);
    requestRender();
  }

  cancel(): void {
    this.drag = null;
    requestRender();
  }

  overlay(): ToolOverlay | null {
    const g = this.geometry();
    if (!g) return null;
    return { kind: 'transform', corners: g.corners, rotateHandle: g.rotateHandle, pivot: g.pivot, active: this.drag?.mode ?? this.hoverMode };
  }
}
