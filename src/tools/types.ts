/**
 * 도구(Tool) 공통 규칙
 * ------------------------------------------------------------
 * 모든 도구는 begin(누름) → move(끌기) → end(뗌) 세 가지 함수를 가집니다.
 * 캔버스 컴포넌트가 마우스/펜 입력을 "픽셀 좌표"로 바꿔서 도구에 전달합니다.
 */
import type { Point } from '../core/types';

export interface ToolPointer {
  /** 픽셀 좌표 (정수) */
  x: number;
  y: number;
  /** 픽셀 좌표 (소수 포함) – 변형 손잡이처럼 정밀한 위치가 필요할 때 */
  fx: number;
  fy: number;
  /** 현재 확대 배율 (손잡이 크기 계산용) */
  zoom: number;
  /** 0 = 왼쪽 버튼, 2 = 오른쪽 버튼 */
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** 캔버스 위에 덧그릴 미리보기 (선택 사각형, 올가미 경로, 변형 상자 등) */
export type ToolOverlay =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'path'; points: Point[] }
  | { kind: 'transform'; corners: Point[]; rotateHandle: Point; pivot: Point; active: string | null }
  | { kind: 'boneDraft'; from: Point; to: Point };

export interface Tool {
  begin(e: ToolPointer): void;
  move(e: ToolPointer): void;
  end(e: ToolPointer): void;
  /** Esc 키 등으로 작업 취소 */
  cancel?(): void;
  overlay?(): ToolOverlay | null;
  /** 마우스를 누르지 않고 움직일 때 (손잡이 하이라이트 등) */
  hover?(e: ToolPointer): void;
  /** 이 도구가 "레이어 원본 좌표"로 그리는지 (움직인 레이어에 그릴 때 좌표 변환) */
  layerSpace?: boolean;
}
