import { describe, expect, it } from 'vitest';
import { colorDistance, colorToHex, hexToColor, hsvToRgb, packColor, rgbToHsv, unpackColor, withAlpha } from '../src/core/color';

describe('color', () => {
  it('packs and unpacks RGBA', () => {
    const c = packColor(255, 128, 0, 200);
    expect(unpackColor(c)).toEqual([255, 128, 0, 200]);
    expect(c).toBeGreaterThan(0);
  });

  it('converts hex strings', () => {
    expect(hexToColor('#ff8000')).toBe(packColor(255, 128, 0, 255));
    expect(hexToColor('f80')).toBe(packColor(255, 136, 0, 255));
    expect(hexToColor('#ff800080')).toBe(packColor(255, 128, 0, 128));
    expect(hexToColor('nope')).toBeNull();
    expect(hexToColor('#12345')).toBeNull();
    expect(colorToHex(packColor(255, 128, 0))).toBe('#ff8000');
    expect(colorToHex(packColor(255, 128, 0, 128))).toBe('#ff800080');
    expect(colorToHex(packColor(1, 2, 3), true)).toBe('#010203ff');
  });

  it('round-trips HSV', () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [12, 200, 77],
      [0, 0, 0],
      [255, 255, 255],
      [90, 40, 210],
    ]) {
      const { h, s, v } = rgbToHsv(r, g, b);
      expect(hsvToRgb(h, s, v)).toEqual([r, g, b]);
    }
  });

  it('measures distance and changes alpha', () => {
    expect(colorDistance(packColor(0, 0, 0), packColor(10, 3, 0))).toBe(10);
    expect(unpackColor(withAlpha(packColor(1, 2, 3, 255), 7))).toEqual([1, 2, 3, 7]);
  });
});
