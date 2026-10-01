/**
 * 애니메이션 미리보기 창
 * ------------------------------------------------------------
 * 그리는 동안에도 작은 창에서 애니메이션이 계속 재생되어
 * "움직임이 자연스러운지" 바로 확인할 수 있습니다. (애니메이션 작업 필수 기능!)
 * 태그를 선택하면 그 구간만 반복 재생합니다.
 */
import { useEffect, useRef, useState } from 'react';
import { compositeFrame } from '../core/render';
import { useT } from '../i18n';
import { createCheckerTile } from '../platform/canvas';
import { getState, useEditor } from '../store/editorStore';
import { IconButton } from './ui';

type PreviewScale = 1 | 2 | 4 | 0; // 0 = 창에 맞춤

export function PreviewPanel() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(true);
  const [scale, setScale] = useState<PreviewScale>(0);
  const [frameLabel, setFrameLabel] = useState('1');
  const activeTagId = useEditor((s) => s.activeTagId);
  const tagName = useEditor((s) => s.project.tags.find((tg) => tg.id === s.activeTagId)?.name);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 체크무늬 색은 테마(CSS 변수)를 따릅니다. 테마가 바뀌면 다시 만듭니다.
    const cssVar = (name: string, fallback: string) => getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;
    let checkerTheme = '';
    let checker: CanvasPattern | null = null;
    const ensureChecker = () => {
      const key = cssVar('--checker-a', '#3a3b45') + cssVar('--checker-b', '#2e2f38');
      if (key !== checkerTheme) {
        checkerTheme = key;
        checker = ctx.createPattern(createCheckerTile(6, cssVar('--checker-a', '#3a3b45'), cssVar('--checker-b', '#2e2f38')), 'repeat');
      }
      return checker;
    };
    const sprite = document.createElement('canvas');
    let frame = getState().currentFrame;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;
    let lastKey = '';

    const render = (now: number) => {
      const s = getState();
      const p = s.project;
      const tag = p.tags.find((tg) => tg.id === s.activeTagId);
      const from = tag ? tag.from : 0;
      const to = tag ? tag.to : p.frames.length - 1;
      if (frame < from || frame > to) frame = from;

      if (running) {
        elapsed += now - last;
        let guard = 0;
        while (elapsed >= p.frames[frame].duration && guard++ < 100) {
          elapsed -= p.frames[frame].duration;
          frame = frame >= to ? from : frame + 1;
        }
      } else {
        frame = Math.min(Math.max(s.currentFrame, 0), p.frames.length - 1);
        elapsed = 0;
      }
      last = now;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const key = `${s.docVersion}:${frame}:${w}:${h}:${scale}:${running ? '' : s.currentFrame}`;
      // 붓질 중에는 docVersion 이 바뀌지 않으므로 일정 간격으로 강제 갱신
      const forceRefresh = Math.floor(now / 250);
      if (key + forceRefresh !== lastKey) {
        lastKey = key + forceRefresh;
        if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
        if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const fit = Math.max(0.1, Math.min((w - 8) / p.width, (h - 8) / p.height));
        const z = scale === 0 ? (fit >= 1 ? Math.floor(fit) : fit) : scale;
        const dw = p.width * z;
        const dh = p.height * z;
        const x = Math.round((w - dw) / 2);
        const y = Math.round((h - dh) / 2);
        const pattern = ensureChecker();
        if (pattern) {
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, dw, dh);
          ctx.restore();
        }
        if (sprite.width !== p.width) sprite.width = p.width;
        if (sprite.height !== p.height) sprite.height = p.height;
        const sctx = sprite.getContext('2d');
        if (sctx) {
          sctx.putImageData(new ImageData(compositeFrame(p, frame) as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sprite, x, y, dw, dh);
        }
        setFrameLabel(`${frame + 1} / ${p.frames.length}`);
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [running, scale]);

  return (
    <div className="preview-panel">
      <canvas ref={canvasRef} className="preview-canvas" />
      <div className="panel-actions">
        <IconButton
          icon={running ? 'pause' : 'play'}
          label={running ? t('preview.pause') : t('preview.play')}
          onClick={() => setRunning(!running)}
          size={14}
        />
        <span className="preview-frame">{frameLabel}</span>
        {activeTagId && tagName && <span className="preview-tag">#{tagName}</span>}
        <span className="spacer" />
        <select value={scale} onChange={(e) => setScale(Number(e.target.value) as PreviewScale)} aria-label={t('preview.scale')}>
          <option value={0}>{t('preview.fit')}</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>
      </div>
    </div>
  );
}
