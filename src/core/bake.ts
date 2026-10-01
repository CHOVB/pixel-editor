/**
 * "굽기(Bake)": 비파괴로 계산되던 결과를 실제 픽셀로 저장하기
 * ------------------------------------------------------------
 *  - 키프레임 움직임/효과/뼈대 변형을 각 프레임의 실제 그림으로 바꿉니다.
 *  - 굽고 나면 프레임마다 손으로 다듬을 수 있습니다. (대신 움직임 설정은 사라짐)
 *  - 아래 레이어와 합치기(mergeDown)도 여기서 처리합니다.
 */
import { blendInto } from './blend';
import { celKey } from './celKey';
import { cloneBuffer, createBuffer, isBufferEmpty } from './pixels';
import { childrenOf, findLayer, removeLayer } from './project';
import { renderLayer } from './render';
import type { Layer, Project } from './types';

/** 레이어의 모든 프레임을 "보이는 그대로" 픽셀로 굽고, 움직임/효과/뼈대 설정을 지웁니다. */
export function bakeLayer(p: Project, layerId: string): boolean {
  const layer = findLayer(p, layerId);
  if (!layer || layer.kind === 'reference') return false;
  const baked: (Uint8ClampedArray | null)[] = p.frames.map((_, i) => {
    const r = renderLayer(p, layer, i, { includeHidden: true, includeGuides: true });
    if (!r) return null;
    const out = cloneBuffer(r.buf);
    const valuesOpacity = layer.opacity > 0 ? r.opacity / layer.opacity : 0;
    if (valuesOpacity < 1) for (let k = 3; k < out.length; k += 4) out[k] = out[k] * valuesOpacity;
    return isBufferEmpty(out) ? null : out;
  });
  // 그룹을 구우면 자식은 지우고 일반 레이어로 바꿉니다.
  if (layer.kind === 'group') {
    for (const child of childrenOf(p, layer.id)) removeLayer(p, child.id);
  }
  p.frames.forEach((f, i) => {
    const key = celKey(layer.id, f.id);
    const buf = baked[i];
    if (buf) p.cels[key] = buf;
    else delete p.cels[key];
  });
  layer.kind = 'pixel';
  layer.anim = null;
  layer.effects = [];
  layer.bind = null;
  layer.particles = null;
  return true;
}

/** 같은 그룹 안에서 바로 아래에 있는 레이어 */
export function siblingBelow(p: Project, layer: Layer): Layer | undefined {
  const sibs = childrenOf(p, layer.parentId).filter((l) => l.kind !== 'reference');
  const i = sibs.indexOf(layer);
  return i > 0 ? sibs[i - 1] : undefined;
}

/**
 * 아래 레이어와 합치기. 위 레이어의 블렌드/불투명도/효과/움직임이 모두 적용된 모습으로 합쳐지고,
 * 아래 레이어도 "보이는 그대로" 구워집니다. 합쳐진(아래) 레이어를 돌려줍니다.
 */
export function mergeDown(p: Project, layerId: string): Layer | null {
  const upper = findLayer(p, layerId);
  if (!upper) return null;
  const lower = siblingBelow(p, upper);
  if (!lower || lower.kind === 'group') return null;
  const results = p.frames.map((_, i) => {
    const base = renderLayer(p, lower, i, { includeHidden: true, includeGuides: true });
    const out = createBuffer(p.width, p.height);
    if (base) blendInto(out, base.buf, lower.opacity > 0 ? base.opacity / lower.opacity : 0, 'normal');
    if (upper.visible) {
      const top = renderLayer(p, upper, i, { includeHidden: true, includeGuides: true });
      if (top) blendInto(out, top.buf, Math.min(1, lower.opacity > 0 ? top.opacity / lower.opacity : top.opacity), upper.blendMode);
    }
    return isBufferEmpty(out) ? null : out;
  });
  p.frames.forEach((f, i) => {
    const key = celKey(lower.id, f.id);
    const buf = results[i];
    if (buf) p.cels[key] = buf;
    else delete p.cels[key];
  });
  lower.kind = 'pixel';
  lower.anim = null;
  lower.effects = [];
  lower.bind = null;
  lower.particles = null;
  removeLayer(p, upper.id);
  return lower;
}
