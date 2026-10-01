/**
 * 뼈 만들기 도구(J) / 자세 도구(P)
 * ------------------------------------------------------------
 * [뼈 만들기]
 *  - 드래그: 누른 곳에서 뗀 곳까지 뼈가 생깁니다.
 *  - 다른 뼈의 끝에서 시작하면 그 뼈의 "자식" 뼈가 됩니다. (팔 → 팔뚝 → 손)
 *  - 뼈를 클릭하면 선택됩니다. Shift: 15° 단위로 맞추기
 *
 * [자세]
 *  - 뼈를 끌면 시작점을 축으로 돌아갑니다. (FK)
 *  - IK 가 켜져 있으면 뼈 끝을 끌 때 부모 뼈까지 함께 굽혀집니다. (손끝을 끌면 팔 전체)
 *  - Shift+끌기: 뼈를 통째로 이동 (몸통 위치 옮기기)
 *  - 바뀐 자세는 현재 프레임에 키프레임으로 자동 저장됩니다.
 */
import { apply, IDENTITY, invert, multiply, type Mat } from '../core/affine';
import { boneEndpoints, evaluateBone, findBone, poseWorld, restWorld, solveIK, type BonePose } from '../core/skeleton';
import type { Bone, Point, Project } from '../core/types';
import { requestRender } from '../editor/renderBus';
import { tr } from '../i18n';
import { beginStructureEdit, endStructureEdit, type StructureEditToken } from '../store/actions';
import { addBoneAction, selectBone, writePoseKeys } from '../store/boneActions';
import { getState } from '../store/editorStore';
import type { Tool, ToolOverlay, ToolPointer } from './types';

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 포인터 근처의 뼈 찾기 (현재 자세 기준) */
export function hitBone(p: Project, frameIndex: number, pt: Point, zoom: number): { bone: Bone; nearTip: boolean } | null {
  const world = poseWorld(p, frameIndex);
  let best: { bone: Bone; nearTip: boolean; d: number } | null = null;
  const tol = 6 / zoom;
  for (const b of p.bones) {
    const m = world.get(b.id);
    if (!m) continue;
    const { head, tail } = boneEndpoints(m, b);
    const d = distToSegment(pt, head, tail);
    if (d <= tol && (!best || d < best.d)) {
      best = { bone: b, nearTip: Math.hypot(pt.x - tail.x, pt.y - tail.y) <= Math.max(tol * 1.5, b.length * 0.3), d };
    }
  }
  return best ? { bone: best.bone, nearTip: best.nearTip } : null;
}

export class BoneCreateTool implements Tool {
  private start: Point | null = null;
  private current: Point = { x: 0, y: 0 };
  private parentId: string | null = null;
  private clickedBone: string | null = null;

  begin(e: ToolPointer): void {
    const s = getState();
    const p = s.project;
    const pt = { x: e.fx, y: e.fy };
    // 기존 뼈의 끝에서 시작하면 자식 뼈로 이어 붙입니다.
    const world = poseWorld(p, s.currentFrame);
    let start = { x: Math.round(pt.x * 2) / 2, y: Math.round(pt.y * 2) / 2 };
    this.parentId = null;
    for (const b of p.bones) {
      const tail = boneEndpoints(world.get(b.id) as Mat, b).tail;
      if (Math.hypot(tail.x - pt.x, tail.y - pt.y) <= 6 / e.zoom) {
        this.parentId = b.id;
        start = tail;
        break;
      }
    }
    const hit = hitBone(p, s.currentFrame, pt, e.zoom);
    this.clickedBone = hit && !this.parentId ? hit.bone.id : null;
    this.start = start;
    this.current = start;
  }

  move(e: ToolPointer): void {
    if (!this.start) return;
    let x = e.fx;
    let y = e.fy;
    if (e.shift) {
      const ang = Math.atan2(y - this.start.y, x - this.start.x);
      const snapped = (Math.round(((ang * 180) / Math.PI) / 15) * 15 * Math.PI) / 180;
      const len = Math.hypot(x - this.start.x, y - this.start.y);
      x = this.start.x + Math.cos(snapped) * len;
      y = this.start.y + Math.sin(snapped) * len;
    }
    this.current = { x, y };
    requestRender();
  }

  end(): void {
    const start = this.start;
    this.start = null;
    if (!start) return;
    const len = Math.hypot(this.current.x - start.x, this.current.y - start.y);
    if (len < 1.5) {
      // 클릭: 뼈 선택
      selectBone(this.clickedBone ?? this.parentId);
      requestRender();
      return;
    }
    const s = getState();
    const p = s.project;
    // 자식 뼈는 "기본 자세" 기준으로 만들어야 하므로, 현재 자세의 좌표를 부모의 기본 자세 좌표로 되돌립니다.
    let head = start;
    let tail = this.current;
    if (this.parentId) {
      const parent = findBone(p, this.parentId);
      const world = poseWorld(p, s.currentFrame).get(this.parentId);
      if (parent && world) {
        // 현재 자세의 점 → 부모 뼈 기준 → 부모의 기본 자세 위치
        const toRest = multiply(restWorld(parent), invert(world));
        head = apply(toRest, head.x, head.y);
        tail = apply(toRest, tail.x, tail.y);
      }
    }
    const rotation = (Math.atan2(tail.y - head.y, tail.x - head.x) * 180) / Math.PI;
    addBoneAction(head.x, head.y, rotation, Math.hypot(tail.x - head.x, tail.y - head.y), this.parentId);
    requestRender();
  }

  cancel(): void {
    this.start = null;
    requestRender();
  }

  overlay(): ToolOverlay | null {
    if (!this.start) return null;
    return { kind: 'boneDraft', from: this.start, to: this.current };
  }
}

interface PoseDrag {
  token: StructureEditToken;
  boneId: string;
  mode: 'rotate' | 'ik' | 'translate';
  startPt: Point;
  startPose: BonePose;
  startAngle: number;
  changed: boolean;
}

export class PoseTool implements Tool {
  private drag: PoseDrag | null = null;

  begin(e: ToolPointer): void {
    const s = getState();
    const p = s.project;
    const pt = { x: e.fx, y: e.fy };
    const hit = hitBone(p, s.currentFrame, pt, e.zoom);
    if (!hit) {
      selectBone(null);
      return;
    }
    selectBone(hit.bone.id);
    const world = poseWorld(p, s.currentFrame).get(hit.bone.id) as Mat;
    const head = apply(world, 0, 0);
    const mode: PoseDrag['mode'] = e.shift ? 'translate' : s.ikEnabled && hit.nearTip && hit.bone.parentId ? 'ik' : 'rotate';
    this.drag = {
      token: beginStructureEdit(),
      boneId: hit.bone.id,
      mode,
      startPt: pt,
      startPose: evaluateBone(p, hit.bone, s.currentFrame),
      startAngle: Math.atan2(pt.y - head.y, pt.x - head.x),
      changed: false,
    };
  }

  move(e: ToolPointer): void {
    const drag = this.drag;
    if (!drag) return;
    const s = getState();
    const p = s.project;
    const bone = findBone(p, drag.boneId);
    if (!bone) return;
    const pt = { x: e.fx, y: e.fy };
    if (drag.mode === 'ik') {
      const overrides = solveIK(p, s.currentFrame, bone.id, pt, Math.max(2, s.ikChain));
      // 체인에 속한 뼈만 기록
      const chain: string[] = [];
      let cur: Bone | undefined = bone;
      while (cur && chain.length < Math.max(2, s.ikChain)) {
        chain.push(cur.id);
        cur = findBone(p, cur.parentId);
      }
      for (const id of chain) {
        const pose = overrides.get(id);
        if (pose) overrides.set(id, { ...pose, rotation: Math.round(pose.rotation) });
      }
      writePoseKeys(overrides, chain);
    } else if (drag.mode === 'rotate') {
      const world = poseWorld(p, s.currentFrame).get(bone.id) as Mat;
      const head = apply(world, 0, 0);
      const angle = Math.atan2(pt.y - head.y, pt.x - head.x);
      let deg = drag.startPose.rotation + ((angle - drag.startAngle) * 180) / Math.PI;
      deg = e.ctrl ? deg : Math.round(deg);
      if (e.alt) deg = Math.round(deg / 15) * 15;
      writePoseKeys(new Map([[bone.id, { ...drag.startPose, rotation: deg }]]));
    } else {
      // 이동: 화면 이동량을 "이 뼈의 기본 방향" 좌표로 바꿔서 기록
      const parent = findBone(p, bone.parentId);
      const parentWorld = parent ? (poseWorld(p, s.currentFrame).get(parent.id) ?? IDENTITY) : IDENTITY;
      const restLocal = parent ? multiply(invert(restWorld(parent)), restWorld(bone)) : restWorld(bone);
      const full = multiply(parentWorld, restLocal);
      const inv = invert([full[0], full[1], full[2], full[3], 0, 0]);
      const d = apply(inv, pt.x - drag.startPt.x, pt.y - drag.startPt.y);
      writePoseKeys(new Map([[bone.id, { ...drag.startPose, x: Math.round(drag.startPose.x + d.x), y: Math.round(drag.startPose.y + d.y) }]]));
    }
    drag.changed = true;
    requestRender();
  }

  end(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.changed) endStructureEdit(tr('history.pose'), drag.token);
    requestRender();
  }

  cancel(): void {
    this.drag = null;
  }
}
