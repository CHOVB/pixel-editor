/**
 * 프레임 범위 일괄 작업 (이동 / 뒤집기 / 회전)
 * ------------------------------------------------------------
 * 여러 프레임에 같은 변형을 한 번에 적용합니다. 실행 취소도 한 번에 됩니다.
 *  - 링크된 그림은 한 번만 변형해서 링크를 그대로 유지합니다.
 *  - 범위 밖 프레임과 링크된 그림은 범위 안쪽만 새 그림으로 바뀝니다. (범위 밖은 그대로)
 *  - 잠긴 레이어는 건너뜁니다.
 */
import { celKey } from '../core/celKey';
import { isIdentityTransform, transformCelBuffer, type CelTransform } from '../core/frameTools';
import { isEffectivelyLocked } from '../core/project';
import { tr } from '../i18n';
import { commitStructure, notify, selectedFrames, setFlipRangeHook } from './actions';
import { getState as S } from './editorStore';

export interface FrameTransformRequest extends CelTransform {
  frames: 'range' | 'all';
  layers: 'current' | 'all';
}

/** 적용할 프레임 번호들 */
export function targetFrames(frames: 'range' | 'all'): number[] {
  const n = S().project.frames.length;
  if (frames === 'all') return Array.from({ length: n }, (_, i) => i);
  const [a, b] = selectedFrames();
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** 변경된 그림 수를 돌려줍니다. */
export function transformFramesAction(req: FrameTransformRequest): number {
  if (isIdentityTransform(req)) return 0;
  const indices = targetFrames(req.frames);
  let changed = 0;
  commitStructure(tr('history.frameTransform'), (p) => {
    const layers = p.layers.filter(
      (l) => l.kind === 'pixel' && !isEffectivelyLocked(p, l) && (req.layers === 'all' || l.id === S().currentLayerId),
    );
    for (const layer of layers) {
      const memo = new Map<Uint8ClampedArray, Uint8ClampedArray>();
      for (const i of indices) {
        const key = celKey(layer.id, p.frames[i].id);
        const cel = p.cels[key];
        if (!cel) continue;
        let out = memo.get(cel);
        if (!out) {
          out = transformCelBuffer(cel, p.width, p.height, req);
          memo.set(cel, out);
        }
        p.cels[key] = out;
        changed++;
      }
    }
    return changed > 0;
  });
  if (changed === 0) notify(tr('toast.nothingToTransform'), 'info');
  return changed;
}

/** 프레임을 여러 장 고른 상태인지 */
export function hasFrameRange(): boolean {
  const [a, b] = selectedFrames();
  return b > a;
}

// Shift+H / Shift+V: 프레임을 여러 장 골랐으면 고른 프레임 전체(현재 레이어)를 뒤집습니다.
setFlipRangeHook((axis) => {
  transformFramesAction({ frames: 'range', layers: 'current', dx: 0, dy: 0, wrap: false, flipH: axis === 'horizontal', flipV: axis === 'vertical', rotate: 0 });
});
