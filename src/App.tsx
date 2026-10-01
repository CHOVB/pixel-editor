/**
 * 앱 전체 화면 배치 (Layout)
 * ------------------------------------------------------------
 *  ┌────────────── 메뉴 막대 ──────────────┐
 *  ├────────────── 도구 옵션 ──────────────┤
 *  │ 도구 │        캔버스         │ 오른쪽 │
 *  │ 막대 │                       │ 패널   │
 *  ├════════ (끌어서 높이 조절) ═══════════┤
 *  │          타임라인            │미리보기│
 *  └────────────── 상태 표시줄 ────────────┘
 *
 * 그 밖에 "전역"으로 해야 하는 일들도 여기서 연결합니다.
 *  - 키보드 단축키, 붙여넣기, 파일 끌어다 놓기, 자동 저장, 닫기 전 경고, 환경설정 저장, 테마
 */
import { useEffect, useRef, useState } from 'react';
import { CanvasView } from './components/CanvasView';
import { ContextMenuHost } from './components/ContextMenuHost';
import { DialogHost } from './components/dialogs/DialogHost';
import { MenuBar } from './components/MenuBar';
import { PreviewPanel } from './components/PreviewPanel';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { Timeline } from './components/Timeline';
import { ToastHost } from './components/ToastHost';
import { ToolOptionsBar } from './components/ToolOptionsBar';
import { Toolbar } from './components/Toolbar';
import { TutorialPanel } from './components/TutorialPanel';
import { TooltipLayer } from './components/ui';
import { pasteImageBlob, pasteInternal } from './editor/clipboard';
import { installCrashGuard } from './editor/crashGuard';
import { backgroundUpdateCheck } from './platform/updates';
import { confirmDiscard, DEFAULT_AUTOSAVE_SECONDS, importImageFileAsLayer, openFileObject, startAutosave } from './editor/fileActions';
import { loadRecentFiles } from './editor/recentFiles';
import { desktopLaunchFile } from './platform/desktop';
import { handleKeyDown } from './editor/shortcuts';
import { usePlayback } from './editor/usePlayback';
import { tr, useT } from './i18n';
import { notify } from './store/actions';
import { getState, setState, useEditor, type Theme } from './store/editorStore';
import { loadPrefs, savePrefs } from './store/prefs';
// 프레임 범위 뒤집기(Shift+H/V)를 연결하기 위해 미리 불러옵니다.
import './store/frameActions';

const MIN_BOTTOM = 120;
const MAX_BOTTOM_RATIO = 0.6;

function useGlobalEvents() {
  const t = useT();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // 1) 키보드 단축키
    const onKey = (e: KeyboardEvent) => {
      if (handleKeyDown(e)) e.preventDefault();
    };

    // 2) 붙여넣기: 다른 프로그램에서 복사한 이미지 → 없으면 프로그램 안 클립보드
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (getState().dialog) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (file) void pasteImageBlob(file);
      else if (!pasteInternal()) notify(t('toast.clipboardEmpty'), 'error');
    };

    // 3) 파일 끌어다 놓기: 프로젝트/이미지 열기 (Shift 를 누르고 놓으면 새 레이어로 가져오기)
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      // 대화상자(예: AI 도트 정리)가 직접 파일을 받는 경우에는 건드리지 않습니다.
      if (getState().dialog) return;
      if (e.shiftKey && file.type.startsWith('image/')) void importImageFileAsLayer(file);
      else confirmDiscard(() => void openFileObject(file));
    };

    // 4) 저장하지 않고 창을 닫으려 할 때 경고
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    // 5) 마우스로 버튼/목록/슬라이더를 쓴 뒤에는 포커스를 풀어 줍니다.
    //    (그대로 두면 Enter/Space 를 눌렀을 때 단축키 대신 그 버튼이 다시 눌림)
    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement | null)?.closest?.('button');
      if (button && e.detail > 0) button.blur();
    };
    const onChange = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLSelectElement) el.blur();
      if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'checkbox')) el.blur();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, true);
    window.addEventListener('change', onChange, true);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('change', onChange, true);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [t]);

  // 6) 자동 저장 시작 (간격은 환경설정) + 오류 감시 + 최근 파일 목록 불러오기
  useEffect(() => {
    startAutosave(loadPrefs().autosaveSeconds ?? DEFAULT_AUTOSAVE_SECONDS);
    void loadRecentFiles();
    return installCrashGuard();
  }, []);

  // 6-0) 데스크톱 앱: 하루 한 번 조용히 새 버전 확인 → 있으면 알림 (설정에서 끌 수 있음)
  useEffect(() => {
    const timer = setTimeout(() => {
      void backgroundUpdateCheck().then((info) => {
        if (!info) return;
        if (getState().dialog) notify(tr('update.availableToast', { version: info.version ?? '' }), 'info');
        else setState({ dialog: { id: 'update', payload: { info } } });
      });
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // 6-1) 설치한 앱(PWA)이나 데스크톱 앱을 .pxe / .aseprite 파일 더블클릭으로 열었을 때
  useEffect(() => {
    void desktopLaunchFile().then((r) => {
      if (!r) return;
      setState({ dialog: null });
      void openFileObject(r.file, r.handle);
    });
    const launchQueue = (window as unknown as { launchQueue?: { setConsumer: (cb: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
    launchQueue?.setConsumer(async (params) => {
      const handle = params.files[0];
      if (!handle) return;
      const file = await handle.getFile();
      setState({ dialog: null });
      confirmDiscard(() => void openFileObject(file, handle as unknown as Parameters<typeof openFileObject>[1]));
    });
  }, []);

  // 7) 환경설정이 바뀌면 저장
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (
          s.language !== prev.language ||
          s.showGrid !== prev.showGrid ||
          s.showTileGrid !== prev.showTileGrid ||
          s.tileSize !== prev.tileSize ||
          s.brushSize !== prev.brushSize ||
          s.brushShape !== prev.brushShape ||
          s.pixelPerfect !== prev.pixelPerfect ||
          s.paletteId !== prev.paletteId ||
          s.onion !== prev.onion ||
          s.bottomHeight !== prev.bottomHeight ||
          s.linkOnDuplicate !== prev.linkOnDuplicate ||
          s.theme !== prev.theme ||
          s.uiScale !== prev.uiScale ||
          s.renderer !== prev.renderer
        ) {
          savePrefs({
            language: s.language,
            showGrid: s.showGrid,
            showTileGrid: s.showTileGrid,
            tileSize: s.tileSize,
            brushSize: s.brushSize,
            brushShape: s.brushShape,
            pixelPerfect: s.pixelPerfect,
            paletteId: s.paletteId,
            onion: s.onion,
            bottomHeight: s.bottomHeight,
            linkOnDuplicate: s.linkOnDuplicate,
            theme: s.theme,
            uiScale: s.uiScale,
            renderer: s.renderer,
          });
        }
        if (s.language !== prev.language) document.documentElement.lang = s.language;
      }),
    [],
  );

  return dragging;
}

/** 테마(다크/라이트/시스템 설정 따르기)와 화면 배율을 문서 전체에 적용 */
function useTheme(): void {
  const theme = useEditor((s) => s.theme);
  const uiScale = useEditor((s) => s.uiScale);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = (mode: Theme) => {
      const resolved = mode === 'system' ? (media?.matches ? 'light' : 'dark') : mode;
      document.documentElement.dataset.theme = resolved;
    };
    apply(theme);
    if (theme !== 'system' || !media) return;
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);
  useEffect(() => {
    // 화면 전체 크기 조절 (CSS zoom: 버튼/글자/패널이 함께 커짐)
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
    (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = uiScale === 1 ? '' : String(uiScale);
  }, [uiScale]);
}

/** 캔버스와 타임라인 사이의 가로 막대: 위아래로 끌어서 타임라인 높이를 바꿉니다. */
function BottomSplitter() {
  const t = useT();
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      className="h-splitter"
      role="separator"
      aria-orientation="horizontal"
      data-tip={t('layout.resizeTimeline')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: getState().bottomHeight };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const max = Math.round(window.innerHeight * MAX_BOTTOM_RATIO);
        const h = Math.max(MIN_BOTTOM, Math.min(max, start.current.h - (e.clientY - start.current.y)));
        setState({ bottomHeight: h });
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onDoubleClick={() => setState({ bottomHeight: 210 })}
    />
  );
}

export function App() {
  const t = useT();
  const dragging = useGlobalEvents();
  const bottomHeight = useEditor((s) => s.bottomHeight);
  usePlayback();
  useTheme();

  useEffect(() => {
    document.documentElement.lang = getState().language;
  }, []);

  return (
    <div className="app">
      <MenuBar />
      <ToolOptionsBar />
      <main className="workspace">
        <Toolbar />
        <CanvasView />
        <RightPanel />
      </main>
      <BottomSplitter />
      <div className="bottom-area" style={{ height: bottomHeight }}>
        <Timeline />
        <aside className="preview-dock" aria-label={t('panel.preview')}>
          <div className="dock-title">{t('panel.preview')}</div>
          <PreviewPanel />
        </aside>
      </div>
      <StatusBar />
      <TutorialPanel />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
      <TooltipLayer />
      {dragging && <div className="drop-overlay">{t('drop.hint')}</div>}
      {import.meta.env.VITE_E2E_HOOKS === '1' && <CrashProbe />}
    </div>
  );
}

/**
 * 자동 점검(E2E) 빌드에서만 들어가는 "일부러 오류 내기" 장치.
 * 오류 복구 화면이 제대로 나오는지 시험합니다. 일반 빌드에서는 코드째 빠집니다.
 */
function CrashProbe() {
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    (window as unknown as { __pxeCrashTest?: () => void }).__pxeCrashTest = () => setBoom(true);
  }, []);
  if (boom) throw new Error('e2e render crash in /Users/kim/work.pxe');
  return null;
}
