/**
 * 가려진 부분 채우기 (인페인팅) – 자동 알고리즘
 * ------------------------------------------------------------
 * 캐릭터를 파츠(팔, 머리...)로 나누면, 파츠가 덮고 있던 몸통 부분이 비어 있게 됩니다.
 * 팔을 움직이면 그 빈 곳이 보여서 어색하죠. 이 파일은 그 빈 곳을 자동으로 메웁니다.
 *
 *  1) holeMask: 잘라낸 영역 중 "몸통 안쪽"(좌우 또는 위아래가 몸통으로 둘러싸인 곳)만 골라냅니다.
 *  2) inpaint: 빈 곳의 가장자리부터 안쪽으로 한 겹씩, 주변에서 가장 많이 쓰인 색으로 채웁니다.
 *     (양파 껍질 방식 → 도트 그림의 단색 면과 잘 어울립니다)
 *
 * 더 자연스러운 결과가 필요하면 Codex(AI) 연동으로 채울 수 있습니다. (src/ai/codex.ts)
 */
import { cloneBuffer } from './pixels';

function solid(buf: Uint8ClampedArray, i: number): boolean {
  return buf[i * 4 + 3] > 0;
}

/**
 * 잘라낸 영역(partMask) 중에서, 남은 몸통(body)이 좌우 또는 위아래로 감싸고 있는 픽셀 = 채워야 할 곳
 * maxGap: 이 거리 안에 몸통이 있어야 "감싸고 있다"고 봅니다.
 */
export function holeMask(body: Uint8ClampedArray, w: number, h: number, partMask: Uint8Array, maxGap = 64): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!partMask[i] || solid(body, i)) continue;
      const hitDir = (dx: number, dy: number) => {
        for (let k = 1; k <= maxGap; k++) {
          const nx = x + dx * k;
          const ny = y + dy * k;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
          const j = ny * w + nx;
          if (solid(body, j)) return true;
          if (!partMask[j]) return false; // 바깥 투명 영역으로 나가면 몸통 밖
        }
        return false;
      };
      const horizontal = hitDir(-1, 0) && hitDir(1, 0);
      const vertical = hitDir(0, -1) && hitDir(0, 1);
      if (horizontal || vertical) out[i] = 1;
    }
  }
  return out;
}

/** mask 영역을 주변 색으로 채웁니다. (가장자리부터 안쪽으로) */
export function inpaint(src: Uint8ClampedArray, w: number, h: number, mask: Uint8Array, maxPasses = 256): Uint8ClampedArray {
  const out = cloneBuffer(src);
  const pending = new Uint8Array(w * h);
  let remaining = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] && !solid(out, i)) {
      pending[i] = 1;
      remaining++;
    }
  }
  for (let pass = 0; pass < maxPasses && remaining > 0; pass++) {
    const fills: [number, number, number, number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!pending[i]) continue;
        const votes = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (pending[j] || !solid(out, j)) continue;
            const k = j * 4;
            const c = ((out[k] << 24) | (out[k + 1] << 16) | (out[k + 2] << 8) | out[k + 3]) >>> 0;
            votes.set(c, (votes.get(c) ?? 0) + (dx === 0 || dy === 0 ? 2 : 1));
          }
        }
        if (votes.size === 0) continue;
        let best = 0;
        let bestV = -1;
        votes.forEach((v, c) => {
          if (v > bestV) {
            bestV = v;
            best = c;
          }
        });
        fills.push([i, (best >>> 24) & 255, (best >>> 16) & 255, (best >>> 8) & 255, best & 255]);
      }
    }
    if (fills.length === 0) break;
    for (const [i, r, g, b, a] of fills) {
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = a;
      pending[i] = 0;
      remaining--;
    }
  }
  return out;
}

/** AI 결과 등 다른 그림에서 mask 부분만 가져와 합칩니다. */
export function mergeMasked(base: Uint8ClampedArray, patch: Uint8ClampedArray, mask: Uint8Array): Uint8ClampedArray {
  const out = cloneBuffer(base);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    out[i * 4] = patch[i * 4];
    out[i * 4 + 1] = patch[i * 4 + 1];
    out[i * 4 + 2] = patch[i * 4 + 2];
    out[i * 4 + 3] = patch[i * 4 + 3];
  }
  return out;
}
