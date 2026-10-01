/**
 * 프로젝트(문서) 데이터 구조 정의 (v2)
 * ------------------------------------------------------------
 * 에디터의 "그림 데이터"가 어떤 모양으로 저장되는지 정의하는 파일입니다.
 * React/화면과는 전혀 상관없는 순수 데이터 타입만 모아 두었습니다.
 *
 *  - 레이어(Layer) × 프레임(Frame) 의 격자 구조입니다. (Aseprite와 같은 방식)
 *  - 각 칸(셀, Cel)에는 실제 픽셀 데이터(Uint8ClampedArray, RGBA)가 들어갑니다.
 *  - 비어 있는 셀은 아예 저장하지 않습니다. (메모리 절약)
 *  - "링크된 셀": 여러 프레임이 같은 버퍼(같은 객체)를 함께 씁니다. 한 번 고치면 모두 바뀝니다.
 *
 * v2 에서 추가된 것
 *  - 레이어 종류(픽셀/그룹/레퍼런스/파티클), 그룹(부모-자식), 블렌드 모드, 밑그림 레이어
 *  - 키프레임 변형 애니메이션(트윈), 비파괴 효과(Effect) 목록
 *  - 뼈대(Bone) 애니메이션과 레이어 연결(BoneBinding)
 *  - 외부 파일 자료(Asset): 레퍼런스(밑그림) 이미지
 */

/** 색상: 0xRRGGBBAA 형태의 32비트 부호 없는 정수 */
export type Color = number;

/**
 * 레이어 종류
 *  - pixel: 일반 그림 레이어
 *  - group: 여러 레이어를 묶는 폴더
 *  - reference: 밑그림용 이미지 (내보내기에서 제외)
 *  - particles: 비/눈/불꽃 같은 2D 파티클 효과
 */
export type LayerKind = 'pixel' | 'group' | 'reference' | 'particles';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'add'
  | 'subtract'
  | 'difference'
  | 'hardLight';

/* ------------------------------------------------------------------ */
/* 키프레임 애니메이션                                                   */
/* ------------------------------------------------------------------ */

export type EaseKind = 'linear' | 'step' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back' | 'bounce' | 'elastic' | 'bezier';

/** 움직임의 "느낌" (천천히 시작, 튕기기 등) */
export interface Ease {
  kind: EaseKind;
  /** kind 가 'bezier' 일 때 사용하는 곡선 조절점 [x1, y1, x2, y2] (CSS cubic-bezier 와 같음) */
  bezier?: [number, number, number, number];
}

/** 레이어 변형 값 */
export interface TransformValues {
  /** 이동 (픽셀) */
  x: number;
  y: number;
  /** 회전 (도, 시계 방향 +) */
  rotation: number;
  /** 크기 (1 = 100%) */
  scaleX: number;
  scaleY: number;
  /** 불투명도 배율 (0~1) */
  opacity: number;
}

/** 특정 프레임에 찍은 키프레임. ease 는 "이 키에서 다음 키까지" 의 움직임 느낌입니다. */
export interface TransformKey extends TransformValues {
  frameId: string;
  ease: Ease;
}

/** 회전/확대할 때 픽셀을 다시 계산하는 방법 */
export type ResampleMethod = 'nearest' | 'rotsprite';

export interface TransformTrack {
  keys: TransformKey[];
  /** 회전/확대의 중심점 (그림 좌표) */
  pivotX: number;
  pivotY: number;
  method: ResampleMethod;
}

/* ------------------------------------------------------------------ */
/* 효과 / 연결 / 특수 레이어                                             */
/* ------------------------------------------------------------------ */

export type EffectParamValue = number | string | boolean;

/**
 * 효과 값 키프레임: 특정 프레임에서의 숫자 설정값들.
 * 예) 1번 프레임 "하얗게 100%" → 4번 프레임 "하얗게 0%" 로 찍으면 번쩍였다가 서서히 사라집니다.
 */
export interface EffectKey {
  frameId: string;
  /** 숫자 설정값만 저장합니다 (색/선택 같은 값은 키 없이 그대로) */
  values: Record<string, number>;
  /** 이 키에서 다음 키까지의 변화 느낌 */
  ease: Ease;
}

/** 비파괴 효과: 원본 픽셀은 그대로 두고 화면/내보내기 때만 적용됩니다. */
export interface Effect {
  id: string;
  /** 효과 종류 (core/effects.ts 의 EFFECTS 에 등록된 이름) */
  type: string;
  enabled: boolean;
  params: Record<string, EffectParamValue>;
  /** 효과 값 키프레임 (없거나 비어 있으면 params 값을 모든 프레임에 그대로 사용) */
  keys?: EffectKey[];
}

export interface ReferenceData {
  assetId: string;
  x: number;
  y: number;
  /** 1 = 원본 크기 */
  scale: number;
  /** true 면 그림 위에, false 면 그림 뒤에 표시 */
  front: boolean;
}

export interface BoneBinding {
  boneId: string | null;
  /** rigid: 뼈를 따라 통째로 움직임 / mesh: 격자 메시로 휘어짐(여러 뼈 영향) */
  mode: 'rigid' | 'mesh';
  meshCols: number;
  meshRows: number;
}

export interface ParticleSettings {
  preset: string;
  /** 발생 위치(중심)와 영역 크기 */
  x: number;
  y: number;
  areaW: number;
  areaH: number;
  /** 프레임당 생성 개수 (소수 가능) */
  rate: number;
  /** 시작할 때 한 번에 터지는 개수 */
  burst: number;
  /** 수명 (프레임) */
  lifetime: number;
  lifetimeVar: number;
  speed: number;
  speedVar: number;
  /** 발사 방향 (도, 0 = 오른쪽, -90 = 위) */
  angle: number;
  spread: number;
  gravityX: number;
  gravityY: number;
  /** 공기 저항 0~1 */
  drag: number;
  size: number;
  sizeEnd: number;
  /** 수명에 따라 바뀌는 색 (HEX 문자열 목록) */
  colors: string[];
  fade: boolean;
  seed: number;
  /** true 면 처음부터 이미 진행 중인 상태로 시작 (반복 애니메이션용) */
  prewarm: boolean;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0 ~ 1 사이 불투명도 */
  opacity: number;
  kind: LayerKind;
  blendMode: BlendMode;
  /** 그룹 안에 있으면 그룹 레이어의 id */
  parentId: string | null;
  /** 그룹이 펼쳐져 있는지 (타임라인 표시용) */
  expanded: boolean;
  /**
   * 밑그림(스케치) 레이어: 화면에는 보이지만 내보내기/미리보기/썸네일에서는 제외됩니다.
   * 러프 스케치를 그리고 그 위에 깔끔하게 따라 그릴 때 사용합니다.
   */
  guide: boolean;
  /** 키프레임 변형 애니메이션 (없으면 null) */
  anim: TransformTrack | null;
  effects: Effect[];
  bind: BoneBinding | null;
  reference: ReferenceData | null;
  particles: ParticleSettings | null;
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

/* ------------------------------------------------------------------ */
/* 뼈대                                                                  */
/* ------------------------------------------------------------------ */

/** 뼈 키프레임: 기본 자세에서 얼마나 바뀌었는지 */
export interface BoneKey {
  frameId: string;
  /** 회전 변화량 (도) */
  rotation: number;
  /** 이동 변화량 (픽셀, 부모 뼈 기준) */
  x: number;
  y: number;
  /** 길이 방향 크기 */
  scale: number;
  ease: Ease;
}

export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  /** 기본 자세에서 뼈 시작점 (그림 좌표) */
  x: number;
  y: number;
  /** 기본 자세에서의 방향 (도, 0 = 오른쪽) */
  rotation: number;
  length: number;
  color: string;
  keys: BoneKey[];
}

/** 프로젝트에 포함된 외부 파일 (레퍼런스 이미지 등) */
export interface Asset {
  id: string;
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface Project {
  name: string;
  width: number;
  height: number;
  /** layers[0] 이 가장 아래, 마지막이 가장 위에 그려집니다. (그룹 안의 순서도 이 배열 순서) */
  layers: Layer[];
  frames: Frame[];
  /** key = `${layerId}|${frameId}`, value = width*height*4 크기의 RGBA 픽셀 */
  cels: Record<string, Uint8ClampedArray>;
  tags: Tag[];
  palette: Color[];
  bones: Bone[];
  assets: Record<string, Asset>;
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
