/**
 * 픽셀 버퍼 변경 버전 추적
 * ------------------------------------------------------------
 * "이 그림이 바뀌었나?" 를 빠르게 알기 위한 장치입니다.
 * 썸네일/효과/변형 결과를 캐시(저장)해 두고, 원본이 바뀐 경우에만 다시 계산합니다.
 *
 *  - 버퍼마다 고유 번호(id)를 붙입니다. (구조 변경은 새 버퍼를 만들므로 id 가 바뀜)
 *  - 픽셀을 고치면 markEdited() 로 수정 횟수를 올립니다.
 *  - WeakMap 을 쓰므로 버퍼가 사라지면 기록도 자동으로 정리됩니다.
 */
import { celKey } from './celKey';
import type { Project } from './types';

const ids = new WeakMap<object, number>();
const edits = new WeakMap<object, number>();
let nextId = 1;

export function objectId(obj: object): number {
  let id = ids.get(obj);
  if (id === undefined) {
    id = nextId++;
    ids.set(obj, id);
  }
  return id;
}

/** 픽셀이 바뀐 버퍼를 표시합니다. */
export function markEdited(buf: Uint8ClampedArray | undefined | null): void {
  if (!buf) return;
  edits.set(buf, (edits.get(buf) ?? 0) + 1);
}

/** 버퍼의 현재 버전 문자열. 없으면 '-' */
export function bufferVersion(buf: Uint8ClampedArray | undefined | null): string {
  if (!buf) return '-';
  return `${objectId(buf)}.${edits.get(buf) ?? 0}`;
}

/** 한 셀(레이어×프레임)의 버전 */
export function celVersion(p: Project, layerId: string, frameId: string): string {
  return bufferVersion(p.cels[celKey(layerId, frameId)]);
}
