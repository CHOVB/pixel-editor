/**
 * 키프레임 트윈 (중간 프레임 자동 계산)
 * ------------------------------------------------------------
 * 1번 프레임에 "왼쪽", 10번 프레임에 "오른쪽" 이라고 키프레임을 찍으면
 * 2~9번 프레임의 위치를 자동으로 계산해 줍니다. (이징으로 속도감 조절)
 *
 * 키프레임은 프레임 "번호"가 아니라 프레임 "id" 에 붙어 있어서,
 * 프레임을 끼워 넣거나 순서를 바꿔도 키프레임이 따라갑니다.
 */
import { compose, rotateDeg, scale, translate, type Mat } from './affine';
import { ease, LINEAR } from './easing';
import type { Ease, Project, TransformKey, TransformTrack, TransformValues } from './types';

export const IDENTITY_TRANSFORM: TransformValues = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

export function createTrack(pivotX: number, pivotY: number): TransformTrack {
  return { keys: [], pivotX, pivotY, method: 'nearest' };
}

/** 프레임 순서대로 정렬된 키 목록 (지워진 프레임의 키는 제외) */
export function orderedKeys(p: Project, track: TransformTrack): { index: number; key: TransformKey }[] {
  const indexOf = new Map(p.frames.map((f, i) => [f.id, i]));
  return track.keys
    .map((key) => ({ index: indexOf.get(key.frameId) ?? -1, key }))
    .filter((k) => k.index >= 0)
    .sort((a, b) => a.index - b.index);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valuesOf(k: TransformValues): TransformValues {
  return { x: k.x, y: k.y, rotation: k.rotation, scaleX: k.scaleX, scaleY: k.scaleY, opacity: k.opacity };
}

/**
 * frameIndex 프레임에서의 변형 값을 계산합니다.
 * 위치는 픽셀아트답게 정수로 반올림합니다.
 */
export function evaluateTrack(p: Project, track: TransformTrack | null, frameIndex: number): TransformValues {
  if (!track || track.keys.length === 0) return { ...IDENTITY_TRANSFORM };
  const keys = orderedKeys(p, track);
  if (keys.length === 0) return { ...IDENTITY_TRANSFORM };
  let result: TransformValues;
  if (frameIndex <= keys[0].index) result = valuesOf(keys[0].key);
  else if (frameIndex >= keys[keys.length - 1].index) result = valuesOf(keys[keys.length - 1].key);
  else {
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].index <= frameIndex) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = ease(a.key.ease, (frameIndex - a.index) / (b.index - a.index));
    result = {
      x: lerp(a.key.x, b.key.x, t),
      y: lerp(a.key.y, b.key.y, t),
      rotation: lerp(a.key.rotation, b.key.rotation, t),
      scaleX: lerp(a.key.scaleX, b.key.scaleX, t),
      scaleY: lerp(a.key.scaleY, b.key.scaleY, t),
      opacity: Math.max(0, Math.min(1, lerp(a.key.opacity, b.key.opacity, t))),
    };
  }
  result.x = Math.round(result.x);
  result.y = Math.round(result.y);
  result.rotation = Math.round(result.rotation * 100) / 100;
  result.scaleX = Math.round(result.scaleX * 1000) / 1000;
  result.scaleY = Math.round(result.scaleY * 1000) / 1000;
  return result;
}

/** 변형 값 → 행렬 (중심점 기준으로 크기 → 회전 → 이동) */
export function transformMatrix(track: TransformTrack, v: TransformValues): Mat {
  return compose(
    translate(track.pivotX + v.x, track.pivotY + v.y),
    rotateDeg(v.rotation),
    scale(v.scaleX, v.scaleY),
    translate(-track.pivotX, -track.pivotY),
  );
}

export function isIdentityTransform(v: TransformValues): boolean {
  return v.x === 0 && v.y === 0 && v.rotation === 0 && v.scaleX === 1 && v.scaleY === 1 && v.opacity === 1;
}

/** 위치/회전/크기만 기본값인지 (불투명도는 행렬과 무관) */
export function isIdentityGeometry(v: TransformValues): boolean {
  return v.x === 0 && v.y === 0 && v.rotation === 0 && v.scaleX === 1 && v.scaleY === 1;
}

export function keyAt(track: TransformTrack | null, frameId: string): TransformKey | undefined {
  return track?.keys.find((k) => k.frameId === frameId);
}

/** 키프레임 추가/교체. 이미 있으면 값만 바꾸고 이징은 유지합니다. */
export function setKey(track: TransformTrack, frameId: string, values: TransformValues, keyEase?: Ease): TransformKey {
  const existing = track.keys.find((k) => k.frameId === frameId);
  if (existing) {
    Object.assign(existing, valuesOf(values));
    if (keyEase) existing.ease = keyEase;
    return existing;
  }
  const key: TransformKey = { ...valuesOf(values), frameId, ease: keyEase ?? { ...LINEAR } };
  track.keys.push(key);
  return key;
}

export function removeKey(track: TransformTrack, frameId: string): boolean {
  const before = track.keys.length;
  track.keys = track.keys.filter((k) => k.frameId !== frameId);
  return track.keys.length !== before;
}

/** 이전/다음 키프레임의 프레임 번호 (없으면 -1) */
export function neighborKeyIndex(p: Project, track: TransformTrack | null, frameIndex: number, dir: 1 | -1): number {
  if (!track) return -1;
  const keys = orderedKeys(p, track).map((k) => k.index);
  if (dir > 0) return keys.find((i) => i > frameIndex) ?? -1;
  return [...keys].reverse().find((i) => i < frameIndex) ?? -1;
}
