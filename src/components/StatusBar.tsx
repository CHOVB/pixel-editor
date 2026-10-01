/**
 * 상태 표시줄 (화면 맨 아래)
 * ------------------------------------------------------------
 * 마우스 위치(픽셀 좌표), 그림 크기, 확대 배율, 현재 프레임/레이어, 선택 영역 크기,
 * 화면 그리기 방식(GPU/CPU)을 보여줍니다.
 */
import { useT } from '../i18n';
import { useEditor } from '../store/editorStore';

export function StatusBar() {
  const t = useT();
  const cursor = useEditor((s) => s.cursor);
  const width = useEditor((s) => s.project.width);
  const height = useEditor((s) => s.project.height);
  const zoom = useEditor((s) => s.zoom);
  const currentFrame = useEditor((s) => s.currentFrame);
  const frameCount = useEditor((s) => s.project.frames.length);
  const layerName = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId)?.name ?? '');
  const selection = useEditor((s) => s.selection);
  const dirty = useEditor((s) => s.dirty);
  const activeRenderer = useEditor((s) => s.activeRenderer);
  useEditor((s) => s.docVersion);

  return (
    <footer className="statusbar">
      <span className="status-item" data-tip={t('status.cursor')}>
        📍 {cursor ? `${cursor.x}, ${cursor.y}` : '-'}
      </span>
      <span className="status-item" data-tip={t('status.size')}>
        ▦ {width} × {height}
      </span>
      <span className="status-item" data-tip={t('status.zoom')}>
        🔍 {Math.round(zoom * 100)}%
      </span>
      <span className="status-item">
        🎞 {t('status.frame')} {currentFrame + 1}/{frameCount}
      </span>
      <span className="status-item">
        📄 {layerName}
      </span>
      {selection && (
        <span className="status-item">
          ⬚ {selection.bounds.w} × {selection.bounds.h}
        </span>
      )}
      <span className="spacer" />
      {activeRenderer && (
        <span className={`status-item renderer ${activeRenderer}`} data-tip={t(activeRenderer === 'gpu' ? 'status.gpuTip' : 'status.cpuTip')}>
          {activeRenderer === 'gpu' ? '⚡ GPU' : 'CPU'}
        </span>
      )}
      <span className={`status-item ${dirty ? 'warn' : 'ok'}`}>{dirty ? t('status.unsaved') : t('status.saved')}</span>
    </footer>
  );
}
