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
  /** 0 = 왼쪽 버튼, 2 = 오른쪽 버튼 */
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** 캔버스 위에 덧그릴 미리보기 (선택 사각형, 올가미 경로 등) */
export type ToolOverlay =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'path'; points: Point[] };

export interface Tool {
  begin(e: ToolPointer): void;
  move(e: ToolPointer): void;
  end(e: ToolPointer): void;
  /** Esc 키 등으로 작업 취소 */
  cancel?(): void;
  overlay?(): ToolOverlay | null;
}
