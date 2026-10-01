/**
 * 알림 메시지 (토스트)
 * ------------------------------------------------------------
 * "저장했어요", "레이어가 잠겨 있어요" 같은 짧은 안내를 화면 아래에 잠깐 보여줍니다.
 */
import { useEffect } from 'react';
import { setState, useEditor } from '../store/editorStore';

export function ToastHost() {
  const toast = useEditor((s) => s.toast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => {
        // 그 사이 새 알림이 왔다면 지우지 않습니다.
        if (useEditor.getState().toast?.id === toast.id) setState({ toast: null });
      },
      toast.kind === 'error' ? 3200 : 1800,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live="polite" key={toast.id}>
      {toast.message}
    </div>
  );
}
