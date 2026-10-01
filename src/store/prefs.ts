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
  onion?: { enabled: boolean; before: number; after: number; opacity: number; tint: boolean; wrap?: boolean; keysOnly?: boolean };
  bottomHeight?: number;
  linkOnDuplicate?: boolean;
  theme?: 'dark' | 'light' | 'system';
  uiScale?: number;
  /** 화면 그리기 방식 (gpu = WebGL 가속, cpu) */
  renderer?: 'gpu' | 'cpu';
  /** Codex 브리지 주소 (기본 http://127.0.0.1:47811) */
  codexBridgeUrl?: string;
  /** 단축키 사용자 설정: 기능 id → 키 조합 */
  shortcuts?: Record<string, string>;
  /** 자동 저장 간격(초) */
  autosaveSeconds?: number;
  /** 튜토리얼을 끝까지 봤는지 */
  tutorialDone?: boolean;
  /** 튜토리얼에서 마지막으로 본 단계 */
  tutorialStep?: number;
  /** 시작할 때 환영 화면 보여주기 (기본 true) */
  showWelcome?: boolean;
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
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...prefs }));
  } catch {
    // 저장 실패는 무시합니다. (설정이 기억되지 않을 뿐 사용에는 문제 없음)
  }
}

/** 모든 환경설정 지우기 (설정 화면의 "초기화") */
export function resetPrefs(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('pixel-editor:')) localStorage.removeItem(key);
    }
  } catch {
    // 무시
  }
}
