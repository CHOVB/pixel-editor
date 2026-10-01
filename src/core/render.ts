/**
 * 렌더링 파이프라인 (레이어 → 한 장의 그림)
 * ------------------------------------------------------------
 * 각 레이어는 아래 순서로 처리된 뒤, 블렌드 모드에 맞춰 아래에서 위로 겹쳐집니다.
 *
 *   ① 원본 얻기   픽셀 셀 / 그룹(자식 합성) / 파티클 / 3D 모델
 *   ② 뼈대 연결   (4단계) 뼈를 따라 움직이거나 메시로 휘어짐
 *   ③ 키프레임    위치/회전/크기 트윈 (nearest 또는 RotSprite)
 *   ④ 효과        (3단계) 외곽선, 팔레트 맞추기, 디더링 ...
 *   ⑤ 합성        불투명도 × 블렌드 모드
 *
 * 계산 결과는 캐시(저장)해 두고, 원본이나 설정이 바뀐 경우에만 다시 계산합니다.
 * 화면 표시, 썸네일, 미리보기, PNG/GIF 내보내기가 모두 이 파일을 사용합니다.
 */
import { isIdentity, matKey, type Mat } from './affine';
import { blendInto } from './blend';
import { celKey } from './celKey';
import { applyEffects, effectsKey } from './effects';
import { evaluateTrack, isIdentityGeometry, transformMatrix } from './keyframes';
import { renderParticles } from './particles';
import { createBuffer, fillBuffer } from './pixels';
import { childrenOf, sourceFrameId } from './project';
import { transformBuffer } from './resample';
import { applyBinding, bindingKey } from './skeleton';
import type { Color, Layer, Project } from './types';
import { bufferVersion } from './versions';

/* ------------------------------------------------------------------ */
/* 외부 렌더러 등록 (3D 처럼 브라우저 기능이 필요한 레이어)               */
/* ------------------------------------------------------------------ */

export interface SourceResult {
  buf: Uint8ClampedArray;
  /** 캐시 구분용 키 (내용이 같으면 같은 키) */
  key: string;
}

/* ------------------------------------------------------------------ */
/* 캐시                                                                 */
/* ------------------------------------------------------------------ */

const CACHE_LIMIT = 400;
const cache = new Map<string, Uint8ClampedArray>();

function cacheGet(key: string): Uint8ClampedArray | undefined {
  const v = cache.get(key);
  if (v) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet(key: string, value: Uint8ClampedArray): void {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
}

export function clearRenderCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* 레이어 하나 렌더링                                                    */
/* ------------------------------------------------------------------ */

export interface CompositeOptions {
  /** 숨긴 레이어도 포함할지 (기본 false) */
  includeHidden?: boolean;
  /** 밑그림(스케치) 레이어도 포함할지 (기본 false: 내보내기/썸네일에서는 제외, 캔버스 화면에서만 true) */
  includeGuides?: boolean;
  /** 배경색 (기본: 투명) */
  background?: Color | null;
  /** 효과를 끄고 원본만 보기 */
  skipEffects?: boolean;
}

function layerSource(p: Project, layer: Layer, frameIndex: number, opts: CompositeOptions): SourceResult | null {
  switch (layer.kind) {
    case 'pixel': {
      const fid = sourceFrameId(p, layer, frameIndex);
      if (!fid) return null;
      const buf = p.cels[celKey(layer.id, fid)];
      return buf ? { buf, key: bufferVersion(buf) } : null;
    }
    case 'group': {
      const out = createBuffer(p.width, p.height);
      const key = compositeChildren(p, layer.id, frameIndex, opts, out);
      return { buf: out, key: `g(${key})` };
    }
    case 'reference':
      return null;
    case 'particles': {
      if (!layer.particles) return null;
      const key = `pt:${JSON.stringify(layer.particles)}@${frameIndex}`;
      const cacheKey = `${layer.id}|${p.width}x${p.height}|${key}`;
      let buf = cacheGet(cacheKey);
      if (!buf) {
        buf = renderParticles(layer.particles, p.width, p.height, frameIndex);
        cacheSet(cacheKey, buf);
      }
      return { buf, key };
    }
    default:
      return null;
  }
}

export interface RenderedLayer {
  buf: Uint8ClampedArray;
  opacity: number;
  key: string;
}

/** 레이어 하나를 ①~④ 단계까지 처리한 결과 */
export function renderLayer(p: Project, layer: Layer, frameIndex: number, opts: CompositeOptions = {}): RenderedLayer | null {
  const src = layerSource(p, layer, frameIndex, opts);
  if (!src) return null;
  const w = p.width;
  const h = p.height;
  let buf = src.buf;
  let key = `${layer.id}|${w}x${h}|${src.key}`;

  // ② 뼈대 연결
  if (layer.bind && layer.bind.boneId) {
    const bkey = bindingKey(p, layer, frameIndex);
    if (bkey) {
      key += `|b${bkey}`;
      const cached = cacheGet(key);
      if (cached) buf = cached;
      else {
        buf = applyBinding(p, layer, frameIndex, buf);
        cacheSet(key, buf);
      }
    }
  }

  // ③ 키프레임 변형
  const values = evaluateTrack(p, layer.anim, frameIndex);
  if (layer.anim && !isIdentityGeometry(values)) {
    const m: Mat = transformMatrix(layer.anim, values);
    if (!isIdentity(m)) {
      key += `|t${matKey(m)}:${layer.anim.method}`;
      const cached = cacheGet(key);
      if (cached) buf = cached;
      else {
        buf = transformBuffer(buf, w, h, m, layer.anim.method);
        cacheSet(key, buf);
      }
    }
  }

  // ④ 효과
  if (!opts.skipEffects && layer.effects.some((e) => e.enabled)) {
    key += `|e${effectsKey(layer.effects, frameIndex, p)}`;
    const cached = cacheGet(key);
    if (cached) buf = cached;
    else {
      buf = applyEffects(buf, w, h, layer.effects, { project: p, frameIndex });
      cacheSet(key, buf);
    }
  }

  return { buf, opacity: layer.opacity * values.opacity, key };
}

/** parentId 의 자식들을 out 위에 합성합니다. 반환값: 결과를 구분하는 키 */
function compositeChildren(p: Project, parentId: string | null, frameIndex: number, opts: CompositeOptions, out: Uint8ClampedArray): string {
  let key = '';
  for (const child of childrenOf(p, parentId)) {
    if (child.kind === 'reference') continue;
    if (child.guide && !opts.includeGuides) continue;
    if (!child.visible && !opts.includeHidden) continue;
    const r = renderLayer(p, child, frameIndex, opts);
    if (!r) continue;
    blendInto(out, r.buf, r.opacity, child.blendMode);
    key += `${r.key}*${r.opacity}*${child.blendMode};`;
  }
  return key;
}

/** 한 프레임 전체를 합성합니다. */
export function compositeFrame(p: Project, frameIndex: number, options: CompositeOptions = {}): Uint8ClampedArray {
  const out = createBuffer(p.width, p.height);
  if (options.background != null) fillBuffer(out, options.background);
  if (!p.frames[frameIndex]) return out;
  compositeChildren(p, null, frameIndex, options, out);
  return out;
}

/** 썸네일용: 레이어 하나만 처리된 모습 (없으면 null) */
export function renderSingleLayer(p: Project, layer: Layer, frameIndex: number): Uint8ClampedArray | null {
  return renderLayer(p, layer, frameIndex, { includeHidden: true })?.buf ?? null;
}
