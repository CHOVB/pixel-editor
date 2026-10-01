/**
 * 색 선택기 (HSV 방식)
 * ------------------------------------------------------------
 *  - 큰 사각형: 채도(가로) / 명도(세로)
 *  - 무지개 막대: 색상(Hue)
 *  - 체크무늬 막대: 투명도(Alpha)
 *  - HEX 입력칸: #ff0044 처럼 직접 입력
 * 왼쪽 도구 막대의 주 색/보조 색 견본 중 "편집 중"인 색을 바꿉니다.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { colorToCss, colorToHex, hexToColor, hsvToRgb, packColor, rgbToHsv, unpackColor, type HSV } from '../core/color';
import { useT } from '../i18n';
import { addColorToPalette, setColor } from '../store/actions';
import { setState, useEditor } from '../store/editorStore';
import { Icon } from './Icon';

/** 포인터를 누른 채 끌면 계속 onMove 를 호출하는 도우미 */
function useDrag(onMove: (fx: number, fy: number) => void) {
  return (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const update = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      onMove(Math.max(0, Math.min(1, (clientX - r.left) / r.width)), Math.max(0, Math.min(1, (clientY - r.top) / r.height)));
    };
    update(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
}

export function ColorPicker() {
  const t = useT();
  const slot = useEditor((s) => s.activeSlot);
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);
  const color = slot === 'primary' ? primary : secondary;

  const [hsv, setHsv] = useState<HSV>(() => {
    const [r, g, b] = unpackColor(color);
    return rgbToHsv(r, g, b);
  });
  const [alpha, setAlpha] = useState(() => unpackColor(color)[3]);
  const [hexText, setHexText] = useState(colorToHex(color));
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const alphaRef = useRef(alpha);
  alphaRef.current = alpha;

  // 바깥에서 색이 바뀌면 (팔레트 클릭, 스포이드 등) 선택기 상태를 맞춰 줍니다.
  useEffect(() => {
    const [r, g, b, a] = unpackColor(color);
    const local = packColor(...hsvToRgb(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v), alphaRef.current);
    if (local !== color) {
      const next = rgbToHsv(r, g, b);
      // 회색(채도 0)일 때는 색상 값을 유지해야 막대가 튀지 않습니다.
      if (next.s === 0 || next.v === 0) next.h = hsvRef.current.h;
      setHsv(next);
      setAlpha(a);
    }
    setHexText(colorToHex(color));
  }, [color]);

  const apply = (next: HSV, a: number) => {
    setHsv(next);
    setAlpha(a);
    hsvRef.current = next;
    alphaRef.current = a;
    setColor(slot, packColor(...hsvToRgb(next.h, next.s, next.v), a));
  };

  const onSV = useDrag((fx, fy) => apply({ h: hsvRef.current.h, s: fx, v: 1 - fy }, alphaRef.current));
  const onHue = useDrag((fx) => apply({ ...hsvRef.current, h: fx * 360 }, alphaRef.current));
  const onAlpha = useDrag((fx) => apply(hsvRef.current, Math.round(fx * 255)));

  const commitHex = () => {
    const c = hexToColor(hexText);
    if (c === null) {
      setHexText(colorToHex(color));
      return;
    }
    setColor(slot, c);
  };

  const pureHue = `hsl(${hsv.h}, 100%, 50%)`;
  const [r, g, b] = unpackColor(color);
  const opaque = `rgb(${r}, ${g}, ${b})`;

  return (
    <div className="color-picker">
      <div className="slot-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={slot === 'primary'}
          className={slot === 'primary' ? 'active' : ''}
          onClick={() => setState({ activeSlot: 'primary' })}
        >
          <span className="mini-swatch" style={{ ['--swatch' as string]: colorToCss(primary) }} />
          {t('color.primaryShort')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={slot === 'secondary'}
          className={slot === 'secondary' ? 'active' : ''}
          onClick={() => setState({ activeSlot: 'secondary' })}
        >
          <span className="mini-swatch" style={{ ['--swatch' as string]: colorToCss(secondary) }} />
          {t('color.secondaryShort')}
        </button>
      </div>

      <div
        className="sv-box"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})` }}
        onPointerDown={onSV}
        role="slider"
        aria-label={t('color.saturation')}
        aria-valuenow={Math.round(hsv.s * 100)}
      >
        <div className="sv-marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: opaque }} />
      </div>

      <div className="hue-bar" onPointerDown={onHue} role="slider" aria-label={t('color.hue')} aria-valuenow={Math.round(hsv.h)}>
        <div className="bar-marker" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="alpha-bar" onPointerDown={onAlpha} role="slider" aria-label={t('color.alpha')} aria-valuenow={alpha}>
        <div className="alpha-fill" style={{ background: `linear-gradient(to right, transparent, ${opaque})` }} />
        <div className="bar-marker" style={{ left: `${(alpha / 255) * 100}%` }} />
      </div>

      <div className="color-inputs">
        <span className="hex-label">HEX</span>
        <input
          className="hex-input"
          value={hexText}
          spellCheck={false}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitHex();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="HEX"
        />
        <span className="alpha-text" data-tip={t('color.alpha')}>
          {Math.round((alpha / 255) * 100)}%
        </span>
        <button
          type="button"
          className="icon-btn small"
          onClick={() => addColorToPalette(color)}
          data-tip={t('palette.addCurrent')}
          aria-label={t('palette.addCurrent')}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}
