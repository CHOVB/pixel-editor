/**
 * 애니메이션 재생 (메인 캔버스)
 * ------------------------------------------------------------
 * playing 이 true 인 동안 각 프레임의 재생 시간(ms)만큼 기다렸다가 다음 프레임으로 넘깁니다.
 *  - loop: 끝나면 처음부터
 *  - pingpong: 끝까지 갔다가 거꾸로 돌아오기
 *  - once: 한 번만 재생하고 멈춤
 * 태그가 선택되어 있으면 그 구간 안에서만 재생합니다.
 */
import { useEffect } from 'react';
import { getState, setState, useEditor } from '../store/editorStore';

export function playRange(): [number, number] {
  const s = getState();
  const tag = s.project.tags.find((t) => t.id === s.activeTagId);
  if (tag) return [tag.from, tag.to];
  return [0, s.project.frames.length - 1];
}

export function usePlayback(): void {
  const playing = useEditor((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    let timer: ReturnType<typeof setTimeout>;
    let direction = 1;

    const [from, to] = playRange();
    const start = getState();
    // 재생 구간 밖이거나, "한 번 재생" 모드에서 끝에 있으면 처음부터
    if (start.currentFrame < from || start.currentFrame > to || (start.loopMode === 'once' && start.currentFrame === to)) {
      setState({ currentFrame: from });
    }

    const tick = () => {
      const s = getState();
      const [a, b] = playRange();
      let next = s.currentFrame + direction;
      if (s.loopMode === 'loop') {
        if (next > b || next < a) next = a;
      } else if (s.loopMode === 'pingpong') {
        if (next > b) {
          direction = -1;
          next = Math.max(a, b - 1);
        } else if (next < a) {
          direction = 1;
          next = Math.min(b, a + 1);
        }
      } else if (next > b) {
        setState({ playing: false });
        return;
      }
      setState({ currentFrame: next });
      timer = setTimeout(tick, s.project.frames[next]?.duration ?? 100);
    };

    timer = setTimeout(tick, getState().project.frames[getState().currentFrame]?.duration ?? 100);
    return () => clearTimeout(timer);
  }, [playing]);
}
