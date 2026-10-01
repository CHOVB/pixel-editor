/**
 * 작은 미리보기 그림 (레이어/프레임 썸네일)
 * ------------------------------------------------------------
 * getPixels() 로 받은 픽셀을 작은 캔버스에 비율을 유지하며 그립니다.
 * version 값이 바뀔 때만 다시 그려서 성능을 아낍니다.
 */
import { useEffect, useRef } from 'react';
import { bufferToCanvas } from '../platform/canvas';

interface ThumbnailProps {
  getPixels: () => Uint8ClampedArray | null | undefined;
  width: number;
  height: number;
  size: number;
  /** 이 값이 바뀌면 다시 그립니다. */
  version: string | number;
  className?: string;
}

export function Thumbnail({ getPixels, width, height, size, version, className }: ThumbnailProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, px, px);
    const pixels = getPixels();
    if (!pixels) return;
    const scale = Math.min(px / width, px / height);
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(bufferToCanvas(pixels, width, height), Math.floor((px - dw) / 2), Math.floor((px - dh) / 2), dw, dh);
  }, [version, width, height, size]);

  return <canvas ref={ref} className={`thumb ${className ?? ''}`} style={{ width: size, height: size }} />;
}
