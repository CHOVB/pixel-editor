import { describe, expect, it } from 'vitest';
import {
  brushOffsets,
  constrainLine,
  ellipsePoints,
  floodFillMask,
  linePoints,
  pixelPerfect,
  polygonMask,
  rectPoints,
} from '../src/core/drawing';
import { packColor } from '../src/core/color';
import { createBuffer, setPixel } from '../src/core/pixels';

const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe('linePoints', () => {
  it('includes both end points and has no gaps', () => {
    const pts = linePoints(0, 0, 7, 3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 7, y: 3 });
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });

  it('handles a single point', () => {
    expect(linePoints(3, 3, 3, 3)).toEqual([{ x: 3, y: 3 }]);
  });
});

describe('constrainLine', () => {
  it('snaps to horizontal, vertical and diagonal', () => {
    expect(constrainLine(0, 0, 10, 1)).toEqual({ x: 10, y: 0 });
    expect(constrainLine(0, 0, 1, 10)).toEqual({ x: 0, y: 10 });
    expect(constrainLine(0, 0, 6, -5)).toEqual({ x: 6, y: -6 });
  });
});

describe('rectPoints', () => {
  it('draws outline and filled rectangles', () => {
    expect(rectPoints(0, 0, 2, 2, false)).toHaveLength(8);
    expect(rectPoints(2, 2, 0, 0, true)).toHaveLength(9);
  });
});

describe('ellipsePoints', () => {
  it('stays inside its bounding box and is symmetric', () => {
    for (const [w, h] of [
      [8, 8],
      [7, 5],
      [12, 4],
      [3, 3],
    ]) {
      const pts = ellipsePoints(0, 0, w - 1, h - 1, false);
      const set = new Set(pts.map(key));
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(w);
        expect(p.y).toBeLessThan(h);
        expect(set.has(`${w - 1 - p.x},${p.y}`)).toBe(true);
        expect(set.has(`${p.x},${h - 1 - p.y}`)).toBe(true);
      }
      // 박스의 네 변에 모두 닿아야 합니다.
      expect(pts.some((p) => p.x === 0)).toBe(true);
      expect(pts.some((p) => p.x === w - 1)).toBe(true);
      expect(pts.some((p) => p.y === 0)).toBe(true);
      expect(pts.some((p) => p.y === h - 1)).toBe(true);
    }
  });

  it('filled ellipse covers the outline', () => {
    const outline = new Set(ellipsePoints(0, 0, 9, 6, false).map(key));
    const filled = new Set(ellipsePoints(0, 0, 9, 6, true).map(key));
    outline.forEach((k) => expect(filled.has(k)).toBe(true));
    expect(filled.size).toBeGreaterThan(outline.size);
  });
});

describe('brushOffsets', () => {
  it('creates square and round brushes', () => {
    expect(brushOffsets(1, 'square')).toEqual([{ x: 0, y: 0 }]);
    expect(brushOffsets(3, 'square')).toHaveLength(9);
    expect(brushOffsets(3, 'circle')).toHaveLength(5); // + 모양
    expect(brushOffsets(4, 'circle')).toHaveLength(12); // 4x4 에서 모서리 4개 제외
  });
});

describe('pixelPerfect', () => {
  it('removes L-shaped corners', () => {
    const stroke = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];
    const result = pixelPerfect(stroke).map(key);
    expect(result).toEqual(['0,0', '1,1', '2,2']);
  });

  it('keeps straight lines intact', () => {
    const line = linePoints(0, 0, 5, 0);
    expect(pixelPerfect(line)).toEqual(line);
  });
});

describe('floodFillMask', () => {
  const red = packColor(255, 0, 0);
  // 5x5 캔버스 가운데에 세로 벽을 세웁니다.
  const buf = createBuffer(5, 5);
  for (let y = 0; y < 5; y++) setPixel(buf, 5, 2, y, red);

  it('fills only the contiguous area', () => {
    const mask = floodFillMask(buf, 5, 5, 0, 0, true);
    const count = mask.reduce((a, b) => a + b, 0);
    expect(count).toBe(10); // 왼쪽 2열 x 5행
    expect(mask[0 * 5 + 3]).toBe(0);
  });

  it('fills every matching pixel when not contiguous', () => {
    const mask = floodFillMask(buf, 5, 5, 0, 0, false);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('respects a limiting mask', () => {
    const limit = new Uint8Array(25);
    limit[0] = 1;
    limit[1] = 1;
    const mask = floodFillMask(buf, 5, 5, 0, 0, true, 0, limit);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe('polygonMask', () => {
  it('fills the inside of a square path', () => {
    const mask = polygonMask(
      [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
        { x: 1, y: 4 },
      ],
      6,
      6,
    );
    expect(mask.reduce((a, b) => a + b, 0)).toBe(16);
    expect(mask[0]).toBe(0);
  });
});
