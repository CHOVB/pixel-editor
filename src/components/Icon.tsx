/**
 * 아이콘 모음 (SVG)
 * ------------------------------------------------------------
 * 외부 아이콘 라이브러리 없이 직접 그린 간단한 선(stroke) 아이콘입니다.
 * 24x24 좌표계에서 path 의 d 값만 정의하면 됩니다.
 *   - fill: true  → 면을 채움
 *   - dash: true  → 점선
 */
import type { CSSProperties } from 'react';

interface IconPath {
  d: string;
  fill?: boolean;
  dash?: boolean;
}

const P = (d: string): IconPath => ({ d });
const F = (d: string): IconPath => ({ d, fill: true });
const D = (d: string): IconPath => ({ d, dash: true });

export const ICONS = {
  pencil: [P('M4 20l1-4L16 5l3 3L8 19l-4 1z'), P('M14 7l3 3')],
  eraser: [P('M3 15l8-8 7 7-7 7H8z'), P('M7 11l7 7'), P('M14 21h7')],
  bucket: [P('M5 11l6-6 7 7-6 6z'), P('M5 11h13'), F('M20.5 14.5c0 0 2 2.6 2 4a2 2 0 0 1-4 0c0-1.4 2-4 2-4z')],
  picker: [P('M15 4l5 5'), P('M17.5 6.5l-11 11L4 20l2.5-2.5'), P('M13 6l5 5'), P('M10 10l4 4')],
  dither: [
    F('M4 4h4v4H4z M12 4h4v4h-4z M8 8h4v4H8z M16 8h4v4h-4z M4 12h4v4H4z M12 12h4v4h-4z M8 16h4v4H8z M16 16h4v4h-4z'),
  ],
  line: [P('M5 19L19 5')],
  rect: [P('M4 6h16v12H4z')],
  ellipse: [P('M4 12a8 7 0 1 0 16 0a8 7 0 1 0 -16 0')],
  select: [D('M4 4h16v16H4z')],
  lasso: [P('M12 4c5 0 8 2.5 8 5.5S17 15 12 15s-8-2.5-8-5.5S7 4 12 4z'), P('M7 13.5c-1.5 2 .5 3.5 2 3.5s2 2-.5 4')],
  wand: [P('M4 20L15 9'), P('M15 3v3 M15 12v3 M9 9h3 M18 9h3 M11 5l1.5 1.5 M19 5l-1.5 1.5 M19 13l-1.5-1.5')],
  move: [P('M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3')],
  hand: [
    P('M8 13V6a1.5 1.5 0 0 1 3 0v5 M11 11V4.5a1.5 1.5 0 0 1 3 0V11 M14 11V6a1.5 1.5 0 0 1 3 0v5'),
    P('M17 10a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 14.6a1.5 1.5 0 0 1 2.3-1.9L8 15'),
  ],
  eye: [P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'), P('M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0')],
  eyeOff: [P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'), P('M4 4l16 16')],
  lock: [P('M6 11h12v9H6z'), P('M8 11V8a4 4 0 0 1 8 0v3')],
  unlock: [P('M6 11h12v9H6z'), P('M8 11V8a4 4 0 0 1 7.5-2')],
  plus: [P('M12 5v14 M5 12h14')],
  minus: [P('M5 12h14')],
  trash: [P('M4 7h16 M10 11v6 M14 11v6'), P('M6 7l1 13h10l1-13'), P('M9 7V4h6v3')],
  copy: [P('M9 9h11v11H9z'), P('M15 9V4H4v11h5')],
  up: [P('M12 19V5 M6 11l6-6 6 6')],
  down: [P('M12 5v14 M6 13l6 6 6-6')],
  left: [P('M19 12H5 M11 6l-6 6 6 6')],
  right: [P('M5 12h14 M13 6l6 6-6 6')],
  play: [F('M7 4l13 8-13 8z')],
  pause: [F('M6 4h4v16H6z M14 4h4v16h-4z')],
  first: [P('M6 5v14'), F('M19 5L9 12l10 7z')],
  last: [P('M18 5v14'), F('M5 5l10 7-10 7z')],
  prev: [F('M17 5L7 12l10 7z')],
  next: [F('M7 5l10 7-10 7z')],
  loop: [P('M17 2l3 3-3 3 M4 11V9a4 4 0 0 1 4-4h12 M7 22l-3-3 3-3 M20 13v2a4 4 0 0 1-4 4H4')],
  pingpong: [P('M4 8h14 M14 4l4 4-4 4 M20 16H6 M10 12l-4 4 4 4')],
  once: [P('M4 12h13 M13 8l4 4-4 4 M20 6v12')],
  onion: [P('M3 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0'), D('M11 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0')],
  merge: [P('M12 3v12 M7 10l5 5 5-5 M5 20h14')],
  undo: [P('M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  redo: [P('M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],
  grid: [P('M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16')],
  swap: [P('M7 4L4 7l3 3 M4 7h12a4 4 0 0 1 4 4 M17 20l3-3-3-3 M20 17H8a4 4 0 0 1-4-4')],
  tag: [P('M3 3h8l10 10-8 8L3 11z'), F('M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0')],
  mirrorX: [D('M12 3v18'), P('M9 7L4 12l5 5z M15 7l5 5-5 5z')],
  mirrorY: [D('M3 12h18'), P('M7 9l5-5 5 5z M7 15l5 5 5-5z')],
  sliders: [P('M4 7h16 M4 17h16'), F('M13 5h4v4h-4z M7 15h4v4H7z')],
  help: [P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'), P('M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5 M12 17h.01')],
  fileNew: [P('M6 3h8l4 4v14H6z M14 3v4h4 M12 11v6 M9 14h6')],
  folder: [P('M3 6h6l2 2h10v11H3z')],
  save: [P('M5 3h11l3 3v15H5z M8 3v5h7V3 M8 21v-7h8v7')],
  download: [P('M12 3v12 M7 10l5 5 5-5 M4 21h16')],
  upload: [P('M12 15V3 M7 8l5-5 5 5 M4 21h16')],
  image: [P('M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6'), P('M15 9a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0')],
  fit: [P('M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5')],
  zoomIn: [P('M4 10a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M20 20l-5.5-5.5 M10 7v6 M7 10h6')],
  zoomOut: [P('M4 10a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M20 20l-5.5-5.5 M7 10h6')],
  sort: [P('M4 6h10 M4 12h7 M4 18h4 M17 5v14 M14 16l3 3 3-3')],
  check: [P('M5 12l5 5 9-10')],
  close: [P('M6 6l12 12 M18 6L6 18')],
  reverse: [P('M20 7H7 M10 4L7 7l3 3 M4 17h13 M14 14l3 3-3 3')],
  layers: [P('M12 3l9 5-9 5-9-5z M3 13l9 5 9-5')],
  film: [P('M4 4h16v16H4z M8 4v16 M16 4v16 M4 8h4 M4 12h4 M4 16h4 M16 8h4 M16 12h4 M16 16h4')],
  rotate: [P('M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7')],
  globe: [P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18')],
  palette: [
    P('M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1-1-1.3-1-2.2 0-.8.7-1.3 1.5-1.3H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z'),
    F('M7 11a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0 M10 7a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0 M14.5 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0'),
  ],
} satisfies Record<string, IconPath[]>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, className, style }: IconProps) {
  const paths: IconPath[] = ICONS[name];
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ? 'currentColor' : 'none'}
          stroke={p.fill ? 'none' : 'currentColor'}
          strokeDasharray={p.dash ? '3 3' : undefined}
        />
      ))}
    </svg>
  );
}
