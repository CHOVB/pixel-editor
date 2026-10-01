/**
 * 레이어 좌표 ↔ 화면(그림) 좌표 변환
 * ------------------------------------------------------------
 * 키프레임으로 움직였거나 뼈대에 붙은 레이어는 "원본 그림" 과 "보이는 위치" 가 다릅니다.
 * 움직인 레이어 위에 그릴 때, 마우스 위치를 원본 좌표로 되돌려서 정확한 곳에 그리기 위해 사용합니다.
 */
import { IDENTITY, multiply, type Mat } from './affine';
import { evaluateTrack, isIdentityGeometry, transformMatrix } from './keyframes';
import { skinMatrices } from './skeleton';
import type { Layer, Project } from './types';

/** 원본 → 보이는 위치 행렬 (뼈대 rigid 연결 + 키프레임 변형) */
export function layerMatrix(p: Project, layer: Layer, frameIndex: number): Mat {
  let m: Mat = IDENTITY;
  if (layer.bind?.boneId) {
    const skin = skinMatrices(p, frameIndex).get(layer.bind.boneId);
    if (skin) m = skin;
  }
  const v = evaluateTrack(p, layer.anim, frameIndex);
  if (layer.anim && !isIdentityGeometry(v)) m = multiply(transformMatrix(layer.anim, v), m);
  return m;
}

/** 키프레임 변형만의 행렬 */
export function tweenMatrix(p: Project, layer: Layer, frameIndex: number): Mat {
  const v = evaluateTrack(p, layer.anim, frameIndex);
  if (!layer.anim || isIdentityGeometry(v)) return IDENTITY;
  return transformMatrix(layer.anim, v);
}
