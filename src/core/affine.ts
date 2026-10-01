/**
 * 2D 아핀 변환 행렬
 * ------------------------------------------------------------
 * 이동/회전/크기 변경을 숫자 6개로 표현합니다.
 *
 *   [a c e]     x' = a*x + c*y + e
 *   [b d f]     y' = b*x + d*y + f
 *   [0 0 1]
 *
 * multiply(A, B) 는 "B 를 먼저 적용하고 그다음 A 를 적용" 하는 행렬입니다.
 * 키프레임 트윈, 뼈대 애니메이션, 3D 배치가 모두 이 행렬을 사용합니다.
 */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** 여러 행렬을 오른쪽부터 차례로 적용하는 행렬 (compose(A, B, C) = A·B·C) */
export function compose(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, -e, -f];
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

/** 회전 (도 단위, 화면 좌표계라 + 가 시계 방향) */
export function rotateDeg(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export function scale(sx: number, sy: number = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
  return (
    Math.abs(m[0] - 1) < eps &&
    Math.abs(m[1]) < eps &&
    Math.abs(m[2]) < eps &&
    Math.abs(m[3] - 1) < eps &&
    Math.abs(m[4]) < eps &&
    Math.abs(m[5]) < eps
  );
}

/** 정수만큼 이동하는 행렬인지 (빠른 처리용) */
export function isIntegerTranslation(m: Mat, eps = 1e-9): boolean {
  return (
    Math.abs(m[0] - 1) < eps &&
    Math.abs(m[1]) < eps &&
    Math.abs(m[2]) < eps &&
    Math.abs(m[3] - 1) < eps &&
    Math.abs(m[4] - Math.round(m[4])) < eps &&
    Math.abs(m[5] - Math.round(m[5])) < eps
  );
}

export function matKey(m: Mat): string {
  return m.map((v) => Math.round(v * 10000) / 10000).join(',');
}
