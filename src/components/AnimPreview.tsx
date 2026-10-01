/**
 * 움직이는 작은 미리보기 (자동 애니메이션 · AI 다듬기 대화상자에서 사용)
 * ------------------------------------------------------------
 * 여러 프레임을 프레임 시간대로 반복 재생합니다. 그림이 있는 영역만 크게 보여 줍니다.
 */
import { useEffect, useRef } from 'react';
import type { Rect } from '../core/types';

export interface AnimFrames {
  frames: Uint8ClampedArray[];
  durations: number[];
  width: number;
  height: number;
  /** 모든 프레임의 그림이 차지하는 영역 (없으면 전체) */
  bounds: Rect | null;
}

/** 움직이는 작은 미리보기 */
export function AnimPreview({ preview, box, playing = true }: { preview: AnimFrames | null; box: number; playing?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !preview || preview.frames.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = box * dpr;
    c.height = box * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // 그림이 있는 곳만 크게 (모든 프레임을 감싸는 영역 + 여유)
    const b = preview.bounds ?? { x: 0, y: 0, w: preview.width, h: preview.height };
    const side = Math.max(b.w, b.h) + 4;
    const cx = b.x + b.w / 2 - side / 2;
    const cy = b.y + b.h / 2 - side / 2;
    const scale = Math.max(1, Math.floor((box * dpr) / side));
    const ox = (box * dpr - side * scale) / 2;
    const tmp = document.createElement('canvas');
    tmp.width = preview.width;
    tmp.height = preview.height;
    const tctx = tmp.getContext('2d');
    let frame = 0;
    let last = performance.now();
    let raf = 0;
    const draw = () => {
      if (!tctx) return;
      tctx.putImageData(new ImageData(new Uint8ClampedArray(preview.frames[frame]), preview.width, preview.height), 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, cx, cy, side, side, ox, ox, side * scale, side * scale);
    };
    const tick = (now: number) => {
      if (playing && now - last >= preview.durations[frame]) {
        last = now;
        frame = (frame + 1) % preview.frames.length;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    draw();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [preview, box, playing]);
  return <canvas ref={ref} className="anim-preview checker" style={{ width: box, height: box }} />;
}

