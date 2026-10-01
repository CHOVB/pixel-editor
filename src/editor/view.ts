/**
 * 화면 보기(줌/이동) 계산
 * ------------------------------------------------------------
 * zoom: 그림 1픽셀이 화면에서 몇 픽셀로 보이는지 (예: 16 = 16배 확대)
 * panX, panY: 그림의 왼쪽 위 모서리가 화면(캔버스 영역)의 어디에 있는지
 */
import { getState, setState } from '../store/editorStore';

export const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];

/** 캔버스 영역의 크기 (CanvasView 가 알려줍니다) */
export const viewport = { width: 800, height: 600 };

export function setViewportSize(width: number, height: number): void {
  const dw = width - viewport.width;
  const dh = height - viewport.height;
  viewport.width = width;
  viewport.height = height;
  // 창 크기가 바뀌어도 그림이 같은 자리(가운데 기준)에 있도록 보정
  const s = getState();
  setState({ panX: Math.round(s.panX + dw / 2), panY: Math.round(s.panY + dh / 2) });
}

/** 화면 좌표 → 그림 픽셀 좌표 (소수점 포함) */
export function screenToPixel(sx: number, sy: number): { x: number; y: number } {
  const s = getState();
  return { x: (sx - s.panX) / s.zoom, y: (sy - s.panY) / s.zoom };
}

/** anchor(화면 좌표)를 기준으로 확대/축소합니다. 마우스 위치를 기준으로 줌할 때 사용 */
export function zoomTo(newZoom: number, anchorX = viewport.width / 2, anchorY = viewport.height / 2): void {
  const s = getState();
  const z = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], newZoom));
  if (z === s.zoom) return;
  const px = (anchorX - s.panX) / s.zoom;
  const py = (anchorY - s.panY) / s.zoom;
  setState({ zoom: z, panX: Math.round(anchorX - px * z), panY: Math.round(anchorY - py * z) });
}

export function zoomStep(direction: 1 | -1, anchorX?: number, anchorY?: number): void {
  const z = getState().zoom;
  let next = z;
  if (direction > 0) next = ZOOM_LEVELS.find((l) => l > z) ?? z;
  else next = [...ZOOM_LEVELS].reverse().find((l) => l < z) ?? z;
  zoomTo(next, anchorX, anchorY);
}

/** 그림 전체가 화면에 들어오도록 맞춥니다. */
export function fitToScreen(): void {
  const p = getState().project;
  const margin = 0.85;
  const maxZoom = Math.min((viewport.width * margin) / p.width, (viewport.height * margin) / p.height);
  let zoom = ZOOM_LEVELS[0];
  for (const l of ZOOM_LEVELS) if (l <= maxZoom) zoom = l;
  setState({
    zoom,
    panX: Math.round((viewport.width - p.width * zoom) / 2),
    panY: Math.round((viewport.height - p.height * zoom) / 2),
  });
}

/** 100% (실제 크기) 보기 */
export function actualSize(): void {
  zoomTo(1);
  const p = getState().project;
  setState({
    panX: Math.round((viewport.width - p.width) / 2),
    panY: Math.round((viewport.height - p.height) / 2),
  });
}

export function panBy(dx: number, dy: number): void {
  const s = getState();
  setState({ panX: s.panX + dx, panY: s.panY + dy });
}
