/**
 * 화면 다시 그리기 신호
 * ------------------------------------------------------------
 * 붓질 중에는 매 순간 store 를 바꾸지 않고(느려지므로), 픽셀만 직접 바꾼 뒤
 * "캔버스야, 다시 그려줘" 라는 신호만 보냅니다. 캔버스 컴포넌트가 이 신호를 듣습니다.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function requestRender(): void {
  listeners.forEach((fn) => fn());
}

export function onRenderRequest(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
