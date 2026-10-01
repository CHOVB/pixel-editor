/**
 * 사용자 환경설정 저장 (localStorage)
 * ------------------------------------------------------------
 * 언어, 격자 표시, 브러시 크기처럼 "다음에 켰을 때도 유지되면 좋은 설정"을 저장합니다.
 * localStorage 는 시크릿 모드 등에서 실패할 수 있으므로 항상 try/catch 로 감쌉니다.
 */
import type { BrushShape } from '../core/drawing';

const KEY = 'pixel-editor:prefs:v1';

export interface Prefs {
  language?: 'ko' | 'en';
  showGrid?: boolean;
  showTileGrid?: boolean;
  tileSize?: number;
  brushSize?: number;
  brushShape?: BrushShape;
  pixelPerfect?: boolean;
  paletteId?: string;
  onion?: { enabled: boolean; before: number; after: number; opacity: number; tint: boolean };
}

export function loadPrefs(): Prefs {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 저장 실패는 무시합니다. (설정이 기억되지 않을 뿐 사용에는 문제 없음)
  }
}
