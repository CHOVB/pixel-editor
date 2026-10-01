/**
 * 이미지 미리보기 상자
 * ------------------------------------------------------------
 * 픽셀 버퍼를 주어진 상자 크기에 맞춰 보여줍니다. (체크무늬 = 투명)
 *  - overlay: 이미지 위에 선/사각형 등을 덧그리는 함수 (이미지 좌표 기준 변환 정보 제공)
 *  - onPointer: 이미지 좌표로 바꾼 마우스 입력 (영역 선택 등에 사용)
 */
import { useEffect, useRef } from 'react';
import { bufferToCanvas } from '../platform/canvas';

export interface PreviewTransform {
  scale: number;
  ox: number;
  oy: number;
}

interface ImagePreviewProps {
  pixels: Uint8ClampedArray | null;
  width: number;
  height: number;
  boxW: number;
  boxH: number;
  /** true 면 확대할 때 픽셀을 선명하게 (도트용) */
  crisp?: boolean;
  overlay?: (ctx: CanvasRenderingContext2D, t: PreviewTransform) => void;
  onPointer?: (kind: 'down' | 'move' | 'up', x: number, y: number) => void;
  version?: string | number;
  className?: string;
}

export function ImagePreview({ pixels, width, height, boxW, boxH, crisp = true, overlay, onPointer, version, className }: ImagePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tRef = useRef<PreviewTransform>({ scale: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(boxW * dpr);
    c.height = Math.round(boxH * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    if (!pixels || width <= 0 || height <= 0) return;
    let scale = Math.min((boxW - 8) / width, (boxH - 8) / height);
    if (crisp && scale >= 1) scale = Math.floor(scale);
    const ox = Math.round((boxW - width * scale) / 2);
    const oy = Math.round((boxH - height * scale) / 2);
    tRef.current = { scale, ox, oy };
    ctx.imageSmoothingEnabled = !crisp || scale < 1;
    ctx.drawImage(bufferToCanvas(pixels, width, height), ox, oy, width * scale, height * scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(ox - 0.5, oy - 0.5, width * scale + 1, height * scale + 1);
    overlay?.(ctx, tRef.current);
  }, [pixels, width, height, boxW, boxH, crisp, overlay, version]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = tRef.current;
    return { x: (e.clientX - r.left - t.ox) / t.scale, y: (e.clientY - r.top - t.oy) / t.scale };
  };

  return (
    <canvas
      ref={ref}
      className={`image-preview checker ${className ?? ''}`}
      style={{ width: boxW, height: boxH }}
      onPointerDown={
        onPointer
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = toImage(e);
              onPointer('down', p.x, p.y);
            }
          : undefined
      }
      onPointerMove={
        onPointer
          ? (e) => {
              if (e.buttons === 0) return;
              const p = toImage(e);
              onPointer('move', p.x, p.y);
            }
          : undefined
      }
      onPointerUp={
        onPointer
          ? (e) => {
              const p = toImage(e);
              onPointer('up', p.x, p.y);
            }
          : undefined
      }
    />
  );
}
