/**
 * 셀(픽셀 버퍼) 변경 버전 추적
 * ------------------------------------------------------------
 * 썸네일을 "바뀐 프레임만" 다시 그리기 위한 장치입니다.
 * 프레임이 100장이어도 방금 그린 프레임 하나만 새로 계산하므로 빠릅니다.
 *
 *  - 버퍼마다 고유 번호(id)를 붙입니다. (구조 변경은 새 버퍼를 만들므로 id 가 바뀜)
 *  - 픽셀을 고치면 markEdited() 로 수정 횟수를 올립니다.
 *  - WeakMap 을 쓰므로 버퍼가 사라지면 기록도 자동으로 정리됩니다.
 */
import { celKey } from '../core/project';
import type { Project } from '../core/types';

const ids = new WeakMap<Uint8ClampedArray, number>();
const edits = new WeakMap<Uint8ClampedArray, number>();
let nextId = 1;

function bufferId(buf: Uint8ClampedArray): number {
  let id = ids.get(buf);
  if (id === undefined) {
    id = nextId++;
    ids.set(buf, id);
  }
  return id;
}

/** 픽셀이 바뀐 버퍼를 표시합니다. */
export function markEdited(buf: Uint8ClampedArray | undefined): void {
  if (!buf) return;
  edits.set(buf, (edits.get(buf) ?? 0) + 1);
}

/** 버퍼의 현재 버전 문자열. 없으면 '-' */
export function bufferVersion(buf: Uint8ClampedArray | undefined): string {
  if (!buf) return '-';
  return `${bufferId(buf)}.${edits.get(buf) ?? 0}`;
}

/** 한 셀(레이어×프레임)의 버전 */
export function celVersion(p: Project, layerId: string, frameId: string): string {
  return bufferVersion(p.cels[celKey(layerId, frameId)]);
}

/** 한 프레임 합성 결과의 버전 (보이는 레이어, 불투명도, 각 셀 버전, 크기를 모두 반영) */
export function frameVersion(p: Project, frameIndex: number): string {
  const frame = p.frames[frameIndex];
  if (!frame) return 'none';
  let key = `${p.width}x${p.height}`;
  for (const l of p.layers) {
    key += `|${l.id}:${l.visible ? 1 : 0}:${l.opacity}:${celVersion(p, l.id, frame.id)}`;
  }
  return key;
}
