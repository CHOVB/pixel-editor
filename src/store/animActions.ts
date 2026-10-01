/**
 * 애니메이션 관련 명령
 * ------------------------------------------------------------
 *  - 키프레임(트윈): 레이어를 움직이고/돌리고/키우는 값을 프레임마다 기록
 *  - 링크 셀: 여러 프레임이 같은 그림을 공유
 *  - 자동 중간 프레임 생성(인비트윈)
 *  - 여러 프레임의 색 한 번에 바꾸기
 */
import { colorDistance } from '../core/color';
import { generateInbetweens, type InbetweenOptions } from '../core/inbetween';
import {
  createTrack,
  evaluateTrack,
  IDENTITY_TRANSFORM,
  keyAt,
  neighborKeyIndex,
  removeKey,
  setKey,
} from '../core/keyframes';
import { contentBounds, createBuffer, getPixel, isBufferEmpty, setPixel } from '../core/pixels';
import { addFrame, celKey, findLayer, getCel, linkCels, sourceFrameId, unlinkCel } from '../core/project';
import type { Color, Ease, Layer, Project, ResampleMethod, TransformValues } from '../core/types';
import { tr } from '../i18n';
import { commitStructure, currentLayer, gotoFrame, notify, selectedFrames } from './actions';
import { getState as S, setState } from './editorStore';

/* ------------------------------------------------------------------ */
/* 키프레임                                                             */
/* ------------------------------------------------------------------ */

/** 레이어 그림의 가운데 (회전 중심 기본값) */
export function layerContentCenter(p: Project, layer: Layer, frameIndex: number): { x: number; y: number } {
  const fid = sourceFrameId(p, layer, frameIndex);
  const cel = fid ? getCel(p, layer.id, fid) : undefined;
  const b = cel ? contentBounds(cel, p.width, p.height) : null;
  if (!b) return { x: p.width / 2, y: p.height / 2 };
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** 레이어에 움직임 트랙이 없으면 만들어 줍니다. (프로젝트를 직접 수정) */
export function ensureTrack(p: Project, layer: Layer, frameIndex: number): NonNullable<Layer['anim']> {
  if (!layer.anim) {
    const c = layerContentCenter(p, layer, frameIndex);
    layer.anim = createTrack(Math.round(c.x), Math.round(c.y));
  }
  return layer.anim;
}

/** 현재 프레임의 변형 값 */
export function currentTransform(layer: Layer | undefined = currentLayer()): TransformValues {
  const s = S();
  if (!layer) return { ...IDENTITY_TRANSFORM };
  return evaluateTrack(s.project, layer.anim, s.currentFrame);
}

/** 현재 프레임에 키프레임을 찍습니다. (값을 바꾸면 자동으로 키가 생김) */
export function setTransformKeyAction(values: Partial<TransformValues>, layerId = S().currentLayerId): void {
  const s = S();
  commitStructure(tr('history.keyframe'), (p) => {
    const layer = findLayer(p, layerId);
    if (!layer || layer.kind === 'reference') return false;
    const base = evaluateTrack(p, layer.anim, s.currentFrame);
    const track = ensureTrack(p, layer, s.currentFrame);
    setKey(track, p.frames[s.currentFrame].id, { ...base, ...values });
  });
}

/** 키프레임 추가/삭제 토글 */
export function toggleKeyframeAction(): void {
  const s = S();
  const layer = currentLayer();
  if (!layer) return;
  const frameId = s.project.frames[s.currentFrame].id;
  if (keyAt(layer.anim, frameId)) {
    commitStructure(tr('history.keyframeRemove'), (p) => {
      const l = findLayer(p, layer.id);
      if (!l?.anim) return false;
      return removeKey(l.anim, frameId);
    });
  } else {
    setTransformKeyAction({});
  }
}

export function setKeyEaseAction(frameId: string, ease: Ease): void {
  commitStructure(tr('history.keyframeEase'), (p) => {
    const layer = findLayer(p, S().currentLayerId);
    const key = keyAt(layer?.anim ?? null, frameId);
    if (!key) return false;
    key.ease = ease;
  });
}

export function setTrackMethodAction(method: ResampleMethod): void {
  commitStructure(tr('history.keyframe'), (p) => {
    const layer = findLayer(p, S().currentLayerId);
    if (!layer) return false;
    ensureTrack(p, layer, S().currentFrame).method = method;
  });
}

export function setPivotAction(x: number, y: number): void {
  commitStructure(tr('history.pivot'), (p) => {
    const layer = findLayer(p, S().currentLayerId);
    if (!layer) return false;
    const t = ensureTrack(p, layer, S().currentFrame);
    t.pivotX = x;
    t.pivotY = y;
  });
}

export function centerPivotAction(): void {
  const s = S();
  const layer = currentLayer();
  if (!layer) return;
  const c = layerContentCenter(s.project, layer, s.currentFrame);
  setPivotAction(Math.round(c.x), Math.round(c.y));
}

export function clearAnimationAction(): void {
  commitStructure(tr('history.clearAnimation'), (p) => {
    const layer = findLayer(p, S().currentLayerId);
    if (!layer?.anim) return false;
    layer.anim = null;
  });
}

/** 이전(-1)/다음(+1) 키프레임으로 이동 */
export function gotoNeighborKey(dir: 1 | -1): void {
  const s = S();
  const layer = currentLayer();
  const idx = neighborKeyIndex(s.project, layer?.anim ?? null, s.currentFrame, dir);
  if (idx >= 0) gotoFrame(idx);
}

/* ------------------------------------------------------------------ */
/* 링크 셀                                                               */
/* ------------------------------------------------------------------ */

/**
 * 링크: 선택 범위의 첫 프레임 그림을 나머지 프레임과 공유합니다.
 * 범위가 없으면 현재 프레임을 바로 앞 프레임과 공유합니다.
 */
export function linkCelsAction(): void {
  const s = S();
  const [a, b] = selectedFrames();
  commitStructure(tr('history.linkCels'), (p) => {
    if (a === b) {
      if (a === 0) return false;
      linkCels(p, s.currentLayerId, a - 1, [a]);
    } else {
      const targets = [];
      for (let i = a + 1; i <= b; i++) targets.push(i);
      linkCels(p, s.currentLayerId, a, targets);
    }
  });
}

export function unlinkCelAction(): void {
  const s = S();
  const [a, b] = selectedFrames();
  commitStructure(tr('history.unlinkCels'), (p) => {
    let changed = false;
    for (let i = a; i <= b; i++) changed = unlinkCel(p, s.currentLayerId, i) || changed;
    return changed;
  });
}

/** 현재 레이어의 선택 프레임 셀을 비웁니다. */
export function clearCelsAction(): void {
  const s = S();
  const [a, b] = selectedFrames();
  commitStructure(tr('history.clear'), (p) => {
    let changed = false;
    for (let i = a; i <= b; i++) {
      const key = celKey(s.currentLayerId, p.frames[i].id);
      if (p.cels[key]) {
        delete p.cels[key];
        changed = true;
      }
    }
    return changed;
  });
}

/* ------------------------------------------------------------------ */
/* 자동 중간 프레임 생성                                                  */
/* ------------------------------------------------------------------ */

/** 자동 중간 프레임 대화상자 열기 (선택 범위 또는 현재 프레임과 다음 프레임) */
export function openInbetweenDialog(): void {
  const n = S().project.frames.length;
  const [a, b] = selectedFrames();
  const from = a === b ? Math.min(a, Math.max(0, n - 2)) : a;
  const to = a === b ? Math.min(n - 1, from + 1) : b;
  setState({ dialog: { id: 'inbetween', payload: { from, to } } });
}

export interface InbetweenRequest extends InbetweenOptions {
  from: number;
  to: number;
  /** 돌아오는 동작(B → A)도 만들기 → 걷기처럼 반복되는 동작 */
  roundTrip: boolean;
  /** 'all' = 모든 그림 레이어 / 'current' = 현재 레이어만 */
  scope: 'all' | 'current';
}

function celOrEmpty(p: Project, layer: Layer, frameIndex: number): Uint8ClampedArray | null {
  const fid = sourceFrameId(p, layer, frameIndex);
  return fid ? (getCel(p, layer.id, fid) ?? null) : null;
}

/** A → B 사이에 중간 프레임을 끼워 넣습니다. 끼워 넣은 프레임 수를 돌려줍니다. */
function insertInbetweens(p: Project, req: InbetweenRequest, fromIndex: number, toIndex: number, insertAt: number): number {
  const layers = p.layers.filter((l) => l.kind === 'pixel' && !l.guide && (req.scope === 'all' || l.id === S().currentLayerId));
  const generated = new Map<string, (Uint8ClampedArray | null)[]>();
  for (const layer of layers) {
    const a = celOrEmpty(p, layer, fromIndex);
    const b = celOrEmpty(p, layer, toIndex);
    if (!a && !b) continue;
    if (a && a === b) {
      generated.set(layer.id, new Array(req.count).fill(a));
      continue;
    }
    const empty = createBuffer(p.width, p.height);
    const frames = generateInbetweens(a ?? empty, b ?? empty, p.width, p.height, req);
    generated.set(
      layer.id,
      frames.map((f) => (isBufferEmpty(f) ? null : f)),
    );
  }
  const duration = p.frames[fromIndex].duration;
  const sourceFrame = p.frames[fromIndex];
  for (let i = 0; i < req.count; i++) {
    const frame = addFrame(p, insertAt + i, duration);
    for (const layer of p.layers) {
      const list = generated.get(layer.id);
      if (list) {
        const buf = list[i];
        if (buf) p.cels[celKey(layer.id, frame.id)] = buf;
      } else if (layer.kind === 'pixel') {
        // 처리하지 않은 레이어는 출발 프레임 그림을 그대로 공유해서 계속 보이게 합니다.
        const cel = getCel(p, layer.id, sourceFrame.id);
        if (cel) p.cels[celKey(layer.id, frame.id)] = cel;
      }
    }
  }
  return req.count;
}

export function inbetweenAction(req: InbetweenRequest): void {
  const a = Math.min(req.from, req.to);
  const b = Math.max(req.from, req.to);
  if (a === b) {
    notify(tr('toast.inbetweenNeedTwo'), 'error');
    return;
  }
  commitStructure(tr('history.inbetween'), (p) => {
    const added = insertInbetweens(p, req, a, b, a + 1);
    const newB = b + added;
    if (req.roundTrip) insertInbetweens(p, req, newB, a, newB + 1);
    return { frame: a + 1 };
  });
  notify(tr('toast.inbetweenDone', { count: req.roundTrip ? req.count * 2 : req.count }), 'success');
}

/* ------------------------------------------------------------------ */
/* 색 바꾸기 (여러 프레임/레이어)                                          */
/* ------------------------------------------------------------------ */

export interface ReplaceColorRequest {
  from: Color;
  to: Color;
  tolerance: number;
  layers: 'current' | 'all';
  frames: 'current' | 'range' | 'all';
}

export function replaceColorAction(req: ReplaceColorRequest): void {
  const s = S();
  let count = 0;
  commitStructure(tr('history.replaceColor'), (p) => {
    const [ra, rb] = selectedFrames();
    const frameIdx =
      req.frames === 'all' ? p.frames.map((_, i) => i) : req.frames === 'range' ? Array.from({ length: rb - ra + 1 }, (_, i) => ra + i) : [s.currentFrame];
    const layers = p.layers.filter((l) => l.kind === 'pixel' && (req.layers === 'all' || l.id === s.currentLayerId));
    const memo = new Map<Uint8ClampedArray, Uint8ClampedArray>();
    for (const layer of layers) {
      for (const i of frameIdx) {
        const key = celKey(layer.id, p.frames[i].id);
        const cel = p.cels[key];
        if (!cel) continue;
        let out = memo.get(cel);
        if (!out) {
          out = new Uint8ClampedArray(cel);
          for (let y = 0; y < p.height; y++) {
            for (let x = 0; x < p.width; x++) {
              const c = getPixel(out, p.width, x, y);
              if ((c & 255) === 0) continue;
              if (c === req.from || (req.tolerance > 0 && colorDistance(c, req.from) <= req.tolerance)) {
                setPixel(out, p.width, x, y, req.to);
                count++;
              }
            }
          }
          memo.set(cel, out);
        }
        p.cels[key] = out;
      }
    }
    return count > 0;
  });
  notify(tr('toast.replacedColors', { count }), count > 0 ? 'success' : 'info');
}
