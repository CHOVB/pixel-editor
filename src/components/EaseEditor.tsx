/**
 * 이징 곡선 편집기
 * ------------------------------------------------------------
 * 가로 = 시간, 세로 = 움직임 진행도. 곡선 모양이 곧 "움직임의 느낌"입니다.
 *  - 위쪽 버튼으로 자주 쓰는 느낌을 고르거나
 *  - 그래프의 두 점(손잡이)을 끌어서 직접 만들 수 있습니다. (베지어 곡선)
 */
import { useEffect, useRef } from 'react';
import { ease, PRESET_BEZIER } from '../core/easing';
import type { Ease, EaseKind } from '../core/types';
import { useT } from '../i18n';

const PRESETS: EaseKind[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'back', 'bounce', 'elastic', 'step'];
const W = 220;
const H = 120;
const PAD = 14;

interface EaseEditorProps {
  value: Ease;
  onChange: (ease: Ease) => void;
}

export function EaseEditor({ value, onChange }: EaseEditorProps) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const bezier = value.kind === 'bezier' ? (value.bezier ?? [0.25, 0.1, 0.25, 1]) : (PRESET_BEZIER[value.kind] ?? null);
  /** 값이 바뀔 때만 다시 그리기 위한 문자열 키 */
  const valueKey = JSON.stringify(value);

  // 좌표 변환 (값 0~1 → 화면)
  const toX = (v: number) => PAD + v * (W - PAD * 2);
  const toY = (v: number) => H - PAD - v * (H - PAD * 2) * 0.8 - (H - PAD * 2) * 0.1;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 바탕 격자
    ctx.strokeStyle = 'rgba(160,160,190,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(toX(0) + 0.5, toY(1) + 0.5, toX(1) - toX(0), toY(0) - toY(1));
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));
    ctx.lineTo(toX(1), toY(1));
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 곡선
    ctx.strokeStyle = '#6c8cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = i / 80;
      const y = ease(value, x);
      if (i === 0) ctx.moveTo(toX(x), toY(y));
      else ctx.lineTo(toX(x), toY(y));
    }
    ctx.stroke();
    // 베지어 손잡이
    if (value.kind === 'bezier' && bezier) {
      const [x1, y1, x2, y2] = bezier;
      ctx.strokeStyle = 'rgba(255,209,102,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0));
      ctx.lineTo(toX(x1), toY(y1));
      ctx.moveTo(toX(1), toY(1));
      ctx.lineTo(toX(x2), toY(y2));
      ctx.stroke();
      for (const [hx, hy] of [
        [x1, y1],
        [x2, y2],
      ]) {
        ctx.beginPath();
        ctx.arc(toX(hx), toY(hy), 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd166';
        ctx.fill();
      }
    }
  }, [valueKey]);

  const fromEvent = (e: { clientX: number; clientY: number }, el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const vx = Math.max(0, Math.min(1, (x - PAD) / (W - PAD * 2)));
    const vy = (H - PAD - (H - PAD * 2) * 0.1 - y) / ((H - PAD * 2) * 0.8);
    return { vx, vy: Math.max(-0.6, Math.min(1.6, vy)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    const start = bezier ?? [0.25, 0.1, 0.25, 1];
    const { vx, vy } = fromEvent(e, el);
    const d1 = Math.hypot(vx - start[0], vy - start[1]);
    const d2 = Math.hypot(vx - start[2], vy - start[3]);
    const which = d1 <= d2 ? 0 : 1;
    el.setPointerCapture(e.pointerId);
    const update = (ev: { clientX: number; clientY: number }) => {
      const p = fromEvent(ev, el);
      const next: [number, number, number, number] = [...start];
      next[which * 2] = Math.round(p.vx * 100) / 100;
      next[which * 2 + 1] = Math.round(p.vy * 100) / 100;
      onChange({ kind: 'bezier', bezier: next });
    };
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="ease-editor">
      <div className="ease-presets">
        {PRESETS.map((k) => (
          <button key={k} type="button" className={`chip ${value.kind === k ? 'active' : ''}`} onClick={() => onChange({ kind: k })} data-tip={t(`easeTip.${k}`)}>
            {t(`ease.${k}`)}
          </button>
        ))}
        <button
          type="button"
          className={`chip ${value.kind === 'bezier' ? 'active' : ''}`}
          onClick={() => onChange({ kind: 'bezier', bezier: bezier ?? [0.25, 0.1, 0.25, 1] })}
          data-tip={t('easeTip.bezier')}
        >
          {t('ease.bezier')}
        </button>
      </div>
      <canvas ref={ref} className="ease-canvas" style={{ width: W, height: H }} onPointerDown={onPointerDown} data-tip={t('easeTip.drag')} />
    </div>
  );
}
