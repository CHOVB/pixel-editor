/**
 * 앱 전체 화면 배치 (Layout)
 * ------------------------------------------------------------
 *  ┌────────────── 메뉴 막대 ──────────────┐
 *  ├────────────── 도구 옵션 ──────────────┤
 *  │ 도구 │        캔버스         │ 오른쪽 │
 *  │ 막대 │                       │ 패널   │
 *  ├────────── 타임라인 ─────────┤ 미리보기│
 *  └────────────── 상태 표시줄 ────────────┘
 *
 * 그 밖에 "전역"으로 해야 하는 일들도 여기서 연결합니다.
 *  - 키보드 단축키, 붙여넣기, 파일 끌어다 놓기, 자동 저장, 닫기 전 경고, 환경설정 저장
 */
import { useEffect, useState } from 'react';
import { CanvasView } from './components/CanvasView';
import { DialogHost } from './components/dialogs/DialogHost';
import { MenuBar } from './components/MenuBar';
import { PreviewPanel } from './components/PreviewPanel';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { Timeline } from './components/Timeline';
import { ToastHost } from './components/ToastHost';
import { ToolOptionsBar } from './components/ToolOptionsBar';
import { Toolbar } from './components/Toolbar';
import { TooltipLayer } from './components/ui';
import { pasteImageBlob, pasteInternal } from './editor/clipboard';
import { confirmDiscard, importImageFileAsLayer, openFileObject, startAutosave } from './editor/fileActions';
import { handleKeyDown } from './editor/shortcuts';
import { usePlayback } from './editor/usePlayback';
import { useT } from './i18n';
import { notify } from './store/actions';
import { getState, useEditor } from './store/editorStore';
import { savePrefs } from './store/prefs';

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

  // 6) 자동 저장 시작
  useEffect(() => {
    startAutosave();
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
          s.onion !== prev.onion
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
          });
        }
        if (s.language !== prev.language) document.documentElement.lang = s.language;
      }),
    [],
  );

  return dragging;
}

export function App() {
  const t = useT();
  const dragging = useGlobalEvents();
  usePlayback();

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
      <div className="bottom-area">
        <Timeline />
        <aside className="preview-dock" aria-label={t('panel.preview')}>
          <div className="dock-title">{t('panel.preview')}</div>
          <PreviewPanel />
        </aside>
      </div>
      <StatusBar />
      <DialogHost />
      <ToastHost />
      <TooltipLayer />
      {dragging && <div className="drop-overlay">{t('drop.hint')}</div>}
    </div>
  );
}
