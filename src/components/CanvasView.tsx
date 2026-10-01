/**
 * 캔버스 화면 (그림을 그리는 메인 영역)
 * ------------------------------------------------------------
 * 하는 일
 *  1) 그림을 확대해서 보여주기 (체크무늬 배경, 어니언 스킨, 격자, 선택 영역 점선)
 *  2) 마우스/펜 입력을 "픽셀 좌표"로 바꿔서 현재 도구에 전달하기
 *  3) 휠 = 확대/축소, 스페이스바+드래그 / 가운데 버튼 = 화면 이동
 *
 * 성능을 위해 React 렌더링과 별개로 requestAnimationFrame 루프에서 직접 그립니다.
 * "다시 그려야 함(dirty)" 표시가 있을 때만 실제로 그립니다.
 */
import { useEffect, useRef, useState } from 'react';
import { colorToCss } from '../core/color';
import { brushOffsets } from '../core/drawing';
import { compositeFrame } from '../core/render';
import { maskOutline, type Segment } from '../core/selection';
import type { Selection } from '../core/types';
import { onRenderRequest } from '../editor/renderBus';
import { fitToScreen, panBy, screenToPixel, setViewportSize, zoomStep } from '../editor/view';
import { getState, setState, useEditor, type ToolId } from '../store/editorStore';
import { TOOLS, usesBrush } from '../tools';
import type { Tool, ToolPointer } from '../tools/types';
import { createCheckerTile } from '../platform/canvas';

const WORKSPACE_BG = '#15161b';
const ONION_PREV_TINT = 'rgba(255, 70, 110, 0.55)';
const ONION_NEXT_TINT = 'rgba(70, 170, 255, 0.55)';

function cursorFor(tool: ToolId, panning: boolean, spaceHeld: boolean): string {
  if (panning) return 'grabbing';
  if (spaceHeld || tool === 'hand') return 'grab';
  if (tool === 'move') return 'move';
  return 'crosshair';
}

/** 픽셀 버퍼를 캔버스에 올립니다. (크기가 다르면 캔버스 크기를 맞춤) */
function putBuffer(canvas: HTMLCanvasElement, buf: Uint8ClampedArray, w: number, h: number): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
}

export function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tool = useEditor((s) => s.tool);
  const fitRequest = useEditor((s) => s.fitRequest);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);

  // 스페이스바를 누르고 있는 동안 "손 도구"
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target) && !getState().dialog) {
        e.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceHeld(true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctxOrNull = canvas.getContext('2d');
    if (!ctxOrNull) return;
    const ctx: CanvasRenderingContext2D = ctxOrNull;

    let dirty = true;
    let raf = 0;
    let antsPhase = 0;
    let lastAnts = 0;
    let hover: { x: number; y: number } | null = null;
    let drag:
      | { mode: 'pan'; lastX: number; lastY: number; pointerId: number }
      | { mode: 'tool'; tool: Tool; button: number; pointerId: number }
      | null = null;
    let wheelAcc = 0;

    const spriteCanvas = document.createElement('canvas');
    const checkerTile = createCheckerTile(8, '#3a3b45', '#2e2f38');
    const checker = ctx.createPattern(checkerTile, 'repeat');
    let outlineCache: { sel: Selection; segs: Segment[] } | null = null;
    const onionCache = new Map<string, HTMLCanvasElement>();
    let onionCacheVersion = -1;

    const markDirty = () => {
      dirty = true;
    };
    const unsubStore = useEditor.subscribe(markDirty);
    const unsubBus = onRenderRequest(markDirty);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      setViewportSize(r.width, r.height);
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    /** 어니언 스킨용 프레임 이미지 (색조 입힘, 문서 버전별 캐시) */
    const onionImage = (frameIndex: number, tint: string | null): HTMLCanvasElement => {
      const s = getState();
      if (onionCacheVersion !== s.docVersion) {
        onionCache.clear();
        onionCacheVersion = s.docVersion;
      }
      const key = `${frameIndex}:${tint ?? ''}`;
      const cached = onionCache.get(key);
      if (cached) return cached;
      const p = s.project;
      const c = document.createElement('canvas');
      putBuffer(c, compositeFrame(p, frameIndex), p.width, p.height);
      if (tint) {
        const cctx = c.getContext('2d');
        if (cctx) {
          cctx.globalCompositeOperation = 'source-atop';
          cctx.fillStyle = tint;
          cctx.fillRect(0, 0, p.width, p.height);
        }
      }
      onionCache.set(key, c);
      return c;
    };

    const draw = () => {
      const s = getState();
      const p = s.project;
      const dpr = window.devicePixelRatio || 1;
      const vw = canvas.width / dpr;
      const vh = canvas.height / dpr;
      const z = s.zoom;
      const ox = s.panX;
      const oy = s.panY;
      const sw = p.width * z;
      const sh = p.height * z;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      ctx.fillStyle = WORKSPACE_BG;
      ctx.fillRect(0, 0, vw, vh);

      // 그림자 + 체크무늬(투명) 배경
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(ox + 4, oy + 4, sw, sh);
      if (checker) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillStyle = checker;
        ctx.fillRect(0, 0, sw, sh);
        ctx.restore();
      }

      // 어니언 스킨 (재생 중에는 숨김)
      if (s.onion.enabled && !s.playing && p.frames.length > 1) {
        const drawOnion = (fi: number, distance: number, count: number, tint: string) => {
          if (fi < 0 || fi >= p.frames.length) return;
          const falloff = 1 - ((distance - 1) / Math.max(1, count)) * 0.6;
          ctx.globalAlpha = s.onion.opacity * falloff;
          ctx.drawImage(onionImage(fi, s.onion.tint ? tint : null), ox, oy, sw, sh);
        };
        for (let k = s.onion.before; k >= 1; k--) drawOnion(s.currentFrame - k, k, s.onion.before, ONION_PREV_TINT);
        for (let k = s.onion.after; k >= 1; k--) drawOnion(s.currentFrame + k, k, s.onion.after, ONION_NEXT_TINT);
        ctx.globalAlpha = 1;
      }

      // 현재 프레임 합성 이미지
      putBuffer(spriteCanvas, compositeFrame(p, s.currentFrame), p.width, p.height);
      ctx.drawImage(spriteCanvas, ox, oy, sw, sh);

      // 보이는 영역의 픽셀 범위 (격자를 화면에 보이는 곳만 그리기 위해)
      const x0 = Math.max(0, Math.floor(-ox / z));
      const y0 = Math.max(0, Math.floor(-oy / z));
      const x1 = Math.min(p.width, Math.ceil((vw - ox) / z));
      const y1 = Math.min(p.height, Math.ceil((vh - oy) / z));

      // 픽셀 격자
      if (s.showGrid && z >= 6) {
        ctx.beginPath();
        for (let x = x0; x <= x1; x++) {
          ctx.moveTo(ox + x * z + 0.5, oy + y0 * z);
          ctx.lineTo(ox + x * z + 0.5, oy + y1 * z);
        }
        for (let y = y0; y <= y1; y++) {
          ctx.moveTo(ox + x0 * z, oy + y * z + 0.5);
          ctx.lineTo(ox + x1 * z, oy + y * z + 0.5);
        }
        ctx.strokeStyle = 'rgba(160, 160, 180, 0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 타일 격자 (예: 16x16 마다 굵은 선)
      if (s.showTileGrid && s.tileSize > 0) {
        ctx.beginPath();
        for (let x = 0; x <= p.width; x += s.tileSize) {
          ctx.moveTo(ox + x * z + 0.5, oy);
          ctx.lineTo(ox + x * z + 0.5, oy + sh);
        }
        for (let y = 0; y <= p.height; y += s.tileSize) {
          ctx.moveTo(ox, oy + y * z + 0.5);
          ctx.lineTo(ox + sw, oy + y * z + 0.5);
        }
        ctx.strokeStyle = 'rgba(108, 140, 255, 0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 캔버스 테두리
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox - 0.5, oy - 0.5, sw + 1, sh + 1);

      // 대칭 축
      if (s.symmetryX || s.symmetryY) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.beginPath();
        if (s.symmetryX) {
          ctx.moveTo(ox + sw / 2, oy - 8);
          ctx.lineTo(ox + sw / 2, oy + sh + 8);
        }
        if (s.symmetryY) {
          ctx.moveTo(ox - 8, oy + sh / 2);
          ctx.lineTo(ox + sw + 8, oy + sh / 2);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 선택 영역 "개미 행렬" 점선
      if (s.selection) {
        if (!outlineCache || outlineCache.sel !== s.selection) {
          outlineCache = { sel: s.selection, segs: maskOutline(s.selection.mask, p.width, p.height) };
        }
        ctx.beginPath();
        for (const seg of outlineCache.segs) {
          ctx.moveTo(ox + seg.x1 * z + 0.5, oy + seg.y1 * z + 0.5);
          ctx.lineTo(ox + seg.x2 * z + 0.5, oy + seg.y2 * z + 0.5);
        }
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -antsPhase;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 도구 미리보기 (선택 사각형, 올가미 경로)
      const overlay = TOOLS[s.tool].overlay?.();
      if (overlay) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -antsPhase;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        if (overlay.kind === 'rect') {
          const left = Math.min(overlay.x0, overlay.x1);
          const top = Math.min(overlay.y0, overlay.y1);
          const w = Math.abs(overlay.x1 - overlay.x0) + 1;
          const h = Math.abs(overlay.y1 - overlay.y0) + 1;
          ctx.fillStyle = 'rgba(108, 140, 255, 0.15)';
          ctx.fillRect(ox + left * z, oy + top * z, w * z, h * z);
          ctx.strokeRect(ox + left * z + 0.5, oy + top * z + 0.5, w * z, h * z);
        } else if (overlay.points.length > 0) {
          ctx.beginPath();
          overlay.points.forEach((pt, i) => {
            const px = ox + (pt.x + 0.5) * z;
            const py = oy + (pt.y + 0.5) * z;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 브러시 커서 (어디에 칠해질지 미리 보여주기)
      if (hover && !drag && !spaceRef.current && s.tool !== 'hand' && s.tool !== 'move') {
        const offsets = usesBrush(s.tool) ? brushOffsets(s.brushSize, s.brushShape) : [{ x: 0, y: 0 }];
        const fill = s.tool === 'eraser' ? null : s.tool === 'pencil' || s.tool === 'dither' || s.tool === 'line' || s.tool === 'rect' || s.tool === 'ellipse' ? colorToCss(s.primary) : null;
        ctx.save();
        if (fill) {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = fill;
          for (const o of offsets) ctx.fillRect(ox + (hover.x + o.x) * z, oy + (hover.y + o.y) * z, z, z);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        if (offsets.length === 1) {
          ctx.strokeRect(ox + hover.x * z + 0.5, oy + hover.y * z + 0.5, z - 1, z - 1);
        } else {
          const minX = Math.min(...offsets.map((o) => o.x));
          const minY = Math.min(...offsets.map((o) => o.y));
          const maxX = Math.max(...offsets.map((o) => o.x));
          const maxY = Math.max(...offsets.map((o) => o.y));
          ctx.strokeRect(
            ox + (hover.x + minX) * z + 0.5,
            oy + (hover.y + minY) * z + 0.5,
            (maxX - minX + 1) * z - 1,
            (maxY - minY + 1) * z - 1,
          );
        }
        ctx.restore();
      }
    };

    const loop = (t: number) => {
      const s = getState();
      const animating = !!s.selection || !!TOOLS[s.tool].overlay?.();
      if (animating && t - lastAnts > 120) {
        antsPhase = (antsPhase + 1) % 8;
        lastAnts = t;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    /* ---------------- 입력 처리 ---------------- */

    const toPointer = (e: PointerEvent | MouseEvent, button: number): ToolPointer => {
      const r = canvas.getBoundingClientRect();
      const px = screenToPixel(e.clientX - r.left, e.clientY - r.top);
      return {
        x: Math.floor(px.x),
        y: Math.floor(px.y),
        button,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey,
      };
    };

    const updateHover = (e: PointerEvent) => {
      const p = getState().project;
      const pt = toPointer(e, 0);
      const inside = pt.x >= 0 && pt.y >= 0 && pt.x < p.width && pt.y < p.height;
      const next = inside ? { x: pt.x, y: pt.y } : null;
      if (next?.x !== hover?.x || next?.y !== hover?.y) {
        hover = next;
        dirty = true;
        setState({ cursor: next });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (drag) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      const s = getState();
      if (e.button === 1 || spaceRef.current || s.tool === 'hand') {
        drag = { mode: 'pan', lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
        setPanning(true);
      } else if (e.button === 0 || e.button === 2) {
        if (s.playing) setState({ playing: false });
        const tool = TOOLS[s.tool];
        const button = e.button;
        drag = { mode: 'tool', tool, button, pointerId: e.pointerId };
        tool.begin(toPointer(e, button));
      } else {
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      dirty = true;
    };

    const onPointerMove = (e: PointerEvent) => {
      updateHover(e);
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.mode === 'pan') {
        panBy(e.clientX - drag.lastX, e.clientY - drag.lastY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      } else {
        drag.tool.move(toPointer(e, drag.button));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.mode === 'tool') drag.tool.end(toPointer(e, drag.button));
      else setPanning(false);
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      dirty = true;
    };

    const onPointerLeave = () => {
      if (hover) {
        hover = null;
        dirty = true;
        setState({ cursor: null });
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (e.shiftKey && !e.ctrlKey) {
        panBy(-(e.deltaY || e.deltaX), 0);
        return;
      }
      // 트랙패드는 아주 작은 값이 자주 들어오므로 모아서 한 단계씩 줌
      wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(wheelAcc) >= 40) {
        zoomStep(wheelAcc < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
        wheelAcc = 0;
      }
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      cancelAnimationFrame(raf);
      unsubStore();
      unsubBus();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // "화면에 맞추기" 요청이 오면 실행 (새 프로젝트, 열기, 크기 변경 등)
  useEffect(() => {
    fitToScreen();
  }, [fitRequest]);

  return (
    <div className="canvas-wrap" ref={wrapRef} style={{ cursor: cursorFor(tool, panning, spaceHeld) }}>
      <canvas ref={canvasRef} className="main-canvas" />
    </div>
  );
}
