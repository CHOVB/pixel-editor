/**
 * 셀 키 만들기 (레이어 id + 프레임 id)
 * 여러 파일에서 쓰이므로 의존성이 없는 작은 파일로 분리했습니다.
 */
export function celKey(layerId: string, frameId: string): string {
  return `${layerId}|${frameId}`;
}
