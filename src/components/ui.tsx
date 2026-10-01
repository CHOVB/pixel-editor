/**
 * 작은 공용 UI 부품들
 * ------------------------------------------------------------
 *  - IconButton: 아이콘 버튼 (마우스를 올리면 설명 + 단축키 말풍선)
 *  - NumberField: 숫자 입력칸 (엔터/포커스 해제 시 적용, 범위 자동 제한)
 *  - Toggle: 켜고 끄는 체크박스 스타일 버튼
 *
 * 말풍선(툴팁)은 data-tip 속성만 붙이면 TooltipLayer 가 알아서 보여줍니다.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
}

export function IconButton({ icon, label, shortcut, onClick, active, disabled, size = 18, className }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''} ${className ?? ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      data-tip-key={shortcut}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  width?: number;
  suffix?: string;
  ariaLabel?: string;
}

/** 타이핑 중에는 바로 반영하지 않고, Enter 또는 포커스를 벗어날 때 반영합니다. */
export function NumberField({ value, min, max, step = 1, onChange, width = 64, suffix, ariaLabel }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <span className="number-field">
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        style={{ width }}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setText(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  tip?: string;
}

export function Toggle({ checked, onChange, children, tip }: ToggleProps) {
  return (
    <label className={`toggle ${checked ? 'on' : ''}`} data-tip={tip}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

/** 화면 전체에서 data-tip 속성을 가진 요소에 말풍선을 보여주는 레이어 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      current = null;
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      current = el;
      timer = setTimeout(() => {
        if (!current) return;
        const r = current.getBoundingClientRect();
        const below = r.top < 60;
        setTip({
          text: current.dataset.tip ?? '',
          key: current.dataset.tipKey,
          x: r.left + r.width / 2,
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
      }, 450);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', hide);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', hide);
      window.removeEventListener('blur', hide);
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!tip) return null;
  const left = Math.max(80, Math.min(window.innerWidth - 80, tip.x));
  return (
    <div
      className={`tooltip ${tip.below ? 'below' : ''}`}
      style={{ left, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  );
}
