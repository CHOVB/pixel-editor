/**
 * 프로젝트(문서) 데이터 구조 정의
 * ------------------------------------------------------------
 * 에디터의 "그림 데이터"가 어떤 모양으로 저장되는지 정의하는 파일입니다.
 * React/화면과는 전혀 상관없는 순수 데이터 타입만 모아 두었습니다.
 *
 *  - 레이어(Layer) × 프레임(Frame) 의 격자 구조입니다. (Aseprite와 같은 방식)
 *  - 각 칸(셀, Cel)에는 실제 픽셀 데이터(Uint8ClampedArray, RGBA)가 들어갑니다.
 *  - 비어 있는 셀은 아예 저장하지 않습니다. (메모리 절약)
 */

/** 색상: 0xRRGGBBAA 형태의 32비트 부호 없는 정수 */
export type Color = number;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0 ~ 1 사이 불투명도 */
  opacity: number;
}

export interface Frame {
  id: string;
  /** 이 프레임이 화면에 보이는 시간 (밀리초) */
  duration: number;
}

/** 애니메이션 태그: 프레임 구간에 이름을 붙입니다. 예) "걷기" 0~5 */
export interface Tag {
  id: string;
  name: string;
  /** 시작 프레임 인덱스 (포함) */
  from: number;
  /** 끝 프레임 인덱스 (포함) */
  to: number;
  /** 타임라인에 표시될 색 (CSS 색상 문자열) */
  color: string;
}

export interface Project {
  name: string;
  width: number;
  height: number;
  /** layers[0] 이 가장 아래, 마지막이 가장 위에 그려집니다. */
  layers: Layer[];
  frames: Frame[];
  /** key = `${layerId}|${frameId}`, value = width*height*4 크기의 RGBA 픽셀 */
  cels: Record<string, Uint8ClampedArray>;
  tags: Tag[];
  palette: Color[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 선택 영역: 캔버스와 같은 크기의 마스크 (1 = 선택됨) */
export interface Selection {
  mask: Uint8Array;
  bounds: Rect;
}
