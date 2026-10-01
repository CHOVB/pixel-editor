/**
 * 3·4·5단계 도우미 기능 테스트
 *  - 외곽선 / 정리, 효과 스택, AI 도트 이미지 정리(격자 찾기 + 축소), 가려진 부분 채우기,
 *    VFX 추천, 파티클, 걷기 중간 프레임, 번역 누락 검사
 */
import { describe, expect, it } from 'vitest';
import { addOutline, fillPinholes, removeOrphans } from '../src/core/cleanup';
import { packColor } from '../src/core/color';
import { applyEffects, EFFECT_PRESETS, EFFECTS } from '../src/core/effects';
import { generateInbetweens } from '../src/core/inbetween';
import { holeMask, inpaint } from '../src/core/inpaint';
import { createBuffer, getPixel, setPixel } from '../src/core/pixels';
import { createParticleSettings, PARTICLE_PRESET_IDS, renderParticles } from '../src/core/particles';
import { detectGrid, fixPixelArt, mergeSimilarColors, sliceFrames } from '../src/core/pixelfix';
import { createProject } from '../src/core/project';
import { analyzeFrames, drawVfx, suggestVfx, VFX_KINDS, VFX_LENGTH } from '../src/core/vfx';
import { en } from '../src/i18n/en';
import { ko } from '../src/i18n/ko';

const red = packColor(255, 0, 0);
const white = packColor(255, 255, 255);
const dark = packColor(20, 20, 30);

function countOpaque(buf: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++;
  return n;
}

function countColor(buf: Uint8ClampedArray, color: number): number {
  let n = 0;
  for (let i = 0; i < buf.length; i += 4) {
    if (((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0 === color) n++;
  }
  return n;
}

function fillRect(buf: Uint8ClampedArray, w: number, x0: number, y0: number, rw: number, rh: number, c: number): void {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) setPixel(buf, w, x, y, c);
}

describe('outline & cleanup', () => {
  it('adds a 1px white border around a sprite', () => {
    const w = 7;
    const src = createBuffer(w, w);
    setPixel(src, w, 3, 3, red);
    const plus = addOutline(src, w, w, white, 1, 'outside', false, false);
    expect(countColor(plus, white)).toBe(4);
    expect(getPixel(plus, w, 3, 3)).toBe(red);
    const box = addOutline(src, w, w, white, 1, 'outside', true, false);
    expect(countColor(box, white)).toBe(8);
    const thick = addOutline(src, w, w, white, 2, 'outside', true, false);
    expect(countColor(thick, white)).toBe(24);
  });

  it('inside outline recolors the edge without growing the sprite', () => {
    const w = 8;
    const src = createBuffer(w, w);
    fillRect(src, w, 2, 2, 4, 4, red);
    const out = addOutline(src, w, w, dark, 1, 'inside', false, false);
    expect(countOpaque(out)).toBe(16);
    expect(countColor(out, dark)).toBe(12);
    expect(getPixel(out, w, 3, 3)).toBe(red);
  });

  it('removes stray single pixels and fills pinholes', () => {
    const w = 9;
    const src = createBuffer(w, w);
    fillRect(src, w, 1, 1, 5, 5, red);
    setPixel(src, w, 3, 3, 0); // 구멍
    setPixel(src, w, 8, 8, white); // 외톨이 점
    const filled = fillPinholes(src, w, w);
    expect(getPixel(filled, w, 3, 3)).toBe(red);
    const { buf, count } = removeOrphans(src, w, w);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(getPixel(buf, w, 8, 8) >>> 0 & 255).toBe(0);
  });

  it('effect stack: white border preset matches the outline helper', () => {
    const w = 7;
    const src = createBuffer(w, w);
    setPixel(src, w, 3, 3, red);
    const preset = EFFECT_PRESETS.find((p) => p.id === 'whiteBorder')!;
    const p = createProject(w, w);
    const out = applyEffects(src, w, w, [{ id: 'e1', type: preset.type, enabled: true, params: preset.params }], { frameIndex: 0, project: p });
    expect(countColor(out, white)).toBe(8);
    // 끈 효과는 적용되지 않음
    const off = applyEffects(src, w, w, [{ id: 'e1', type: preset.type, enabled: false, params: preset.params }], { frameIndex: 0, project: p });
    expect(off).toEqual(src);
  });

  it('motion effects (sway/breathe/bob) change over frames but keep the sprite', () => {
    const w = 16;
    const src = createBuffer(w, w);
    fillRect(src, w, 6, 2, 3, 12, red);
    const p = createProject(w, w);
    for (let i = 1; i < 8; i++) p.frames.push({ id: `f${i}`, duration: 100 });
    for (const type of ['sway', 'bob']) {
      const fx = [{ id: 'm', type, enabled: true, params: { amplitude: 2 } }];
      const frames = [0, 2, 4, 6].map((frameIndex) => applyEffects(src, w, w, fx, { frameIndex, project: p }));
      const distinct = new Set(frames.map((f) => Array.from(f).join(',')));
      expect(distinct.size).toBeGreaterThan(1);
      for (const f of frames) expect(countColor(f, red)).toBeGreaterThan(20);
    }
  });
});

describe('AI pixel image cleanup', () => {
  /** 8×8 도트 그림을 6배로 키운 "AI 가 만든 것 같은" 이미지 */
  function makeUpscaled() {
    const small = createBuffer(8, 8);
    const colors = [red, white, dark, packColor(40, 160, 90), packColor(250, 200, 40)];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPixel(small, 8, x, y, colors[(x * 3 + y * 5 + ((x * y) % 3)) % colors.length]);
    const s = 6;
    const big = createBuffer(8 * s, 8 * s);
    for (let y = 0; y < 8 * s; y++) for (let x = 0; x < 8 * s; x++) setPixel(big, 8 * s, x, y, getPixel(small, 8, Math.floor(x / s), Math.floor(y / s)));
    return { small, big, size: 8 * s };
  }

  it('detects the dot size of an upscaled sprite', () => {
    const { big, size } = makeUpscaled();
    const g = detectGrid(big, size, size);
    expect(g.cellW).toBeCloseTo(6, 0);
    expect(g.cellH).toBeCloseTo(6, 0);
    expect(g.confidence).toBeGreaterThan(0.3);
  });

  it('shrinks it back to 1 dot = 1 pixel without changing colors', () => {
    const { small, big, size } = makeUpscaled();
    const r = fixPixelArt(big, size, size, { mode: 'auto', removeBg: false, colors: 0, cleanup: false });
    expect([r.width, r.height]).toEqual([8, 8]);
    expect(Array.from(r.pixels)).toEqual(Array.from(small));
  });

  it('fixed size mode outputs the requested sprite size and reduces colors', () => {
    const { big, size } = makeUpscaled();
    const r = fixPixelArt(big, size, size, { mode: 'size', targetW: 16, targetH: 16, removeBg: false, colors: 3, cleanup: false });
    expect([r.width, r.height]).toEqual([16, 16]);
    expect(r.colorCount).toBeLessThanOrEqual(3);
  });

  it('removes a flat background', () => {
    const w = 30;
    const img = createBuffer(w, w);
    fillRect(img, w, 0, 0, w, w, white);
    fillRect(img, w, 10, 10, 10, 10, red);
    const r = fixPixelArt(img, w, w, { mode: 'size', targetW: 30, targetH: 30, removeBg: true, colors: 0, cleanup: false });
    expect(countColor(r.pixels, white)).toBe(0);
    expect(countColor(r.pixels, red)).toBe(100);
  });

  it('merges noisy near-identical shades into one color', () => {
    const w = 10;
    const img = createBuffer(w, w);
    for (let i = 0; i < w * w; i++) {
      const n = (i * 7) % 9 - 4; // -4 ~ +4 얼룩
      setPixel(img, w, i % w, Math.floor(i / w), i < 50 ? packColor(80 + n, 200 - n, 120 + n) : packColor(30 + n, 30, 40 - n));
    }
    const merged = mergeSimilarColors(img, 24);
    const colors = new Set<number>();
    for (let i = 0; i < w * w; i++) colors.add(getPixel(merged, w, i % w, Math.floor(i / w)));
    expect(colors.size).toBe(2);
  });

  it('slices a sheet into frames', () => {
    const { big, size } = makeUpscaled();
    const { frames, frameW, frameH } = sliceFrames(big, size, size, 4, 2);
    expect(frames).toHaveLength(8);
    expect([frameW, frameH]).toEqual([12, 24]);
  });
});

describe('fill hidden area after splitting a part', () => {
  it('finds the hole inside the body and fills it with body colors', () => {
    const w = 12;
    const body = createBuffer(w, w);
    fillRect(body, w, 1, 1, 10, 10, red);
    // 팔(가운데 4×4)을 떼어냄
    const part = new Uint8Array(w * w);
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) {
      part[y * w + x] = 1;
      setPixel(body, w, x, y, 0);
    }
    const hole = holeMask(body, w, w, part);
    expect(hole.reduce((a, b) => a + b, 0)).toBe(16);
    const filled = inpaint(body, w, w, hole);
    expect(countColor(filled, red)).toBe(100);
  });

  it('fills only behind the body, not where the arm stuck out into empty space', () => {
    const w = 12;
    const body = createBuffer(w, w);
    fillRect(body, w, 1, 1, 6, 10, red); // 몸통: x 1~6
    const part = new Uint8Array(w * w);
    // 팔: x 5~11 (몸통 위에 겹친 x 5~6 + 몸통 밖으로 뻗은 x 7~11)
    for (let y = 4; y < 8; y++) for (let x = 5; x < 12; x++) {
      part[y * w + x] = 1;
      setPixel(body, w, x, y, 0);
    }
    const hole = holeMask(body, w, w, part);
    expect(hole.reduce((a, b) => a + b, 0)).toBe(8);
    for (let y = 4; y < 8; y++) for (let x = 7; x < 12; x++) expect(hole[y * w + x]).toBe(0);
    const filled = inpaint(body, w, w, hole);
    expect(countColor(filled, red)).toBe(60);
  });
});

describe('VFX suggestions', () => {
  it('suggests sparkle at the top of a jump and dust on landing', () => {
    const w = 32;
    const ys = [20, 14, 10, 14, 20, 20];
    const frames = ys.map((y) => {
      const b = createBuffer(w, w);
      fillRect(b, w, 14, y, 4, 4, red);
      return b;
    });
    const s = suggestVfx(analyzeFrames(frames, w, w));
    expect(s.some((v) => v.kind === 'sparkle' && v.frame === 2)).toBe(true);
    expect(s.some((v) => v.kind === 'dust' && v.frame === 4)).toBe(true);
  });

  it('draws every VFX kind for every step', () => {
    for (const kind of VFX_KINDS) {
      for (let step = 0; step < VFX_LENGTH[kind]; step++) {
        const buf = drawVfx(kind, step, 48, 48, { x: 24, y: 24 }, 0);
        expect(buf.length).toBe(48 * 48 * 4);
      }
      expect(countOpaque(drawVfx(kind, 0, 48, 48, { x: 24, y: 24 }, 0))).toBeGreaterThan(0);
    }
  });
});

describe('particles', () => {
  it('renders the same frame identically (deterministic) and animates over time', () => {
    const p = createProject(48, 48);
    for (const id of PARTICLE_PRESET_IDS) {
      const s = createParticleSettings(id, p);
      const a = renderParticles(s, 48, 48, 5);
      const b = renderParticles(s, 48, 48, 5);
      expect(a).toEqual(b);
      const c = renderParticles(s, 48, 48, 9);
      expect(Array.from(c).join(',')).not.toBe(Array.from(a).join(','));
    }
  });
});

describe('walk in-between', () => {
  it('keeps the body still while the leg moves', () => {
    const w = 16;
    const h = 12;
    const a = createBuffer(w, h);
    const b = createBuffer(w, h);
    fillRect(a, w, 4, 1, 6, 6, red);
    fillRect(b, w, 4, 1, 6, 6, red);
    const leg = packColor(40, 60, 200);
    fillRect(a, w, 5, 7, 1, 4, leg);
    fillRect(b, w, 9, 7, 1, 4, leg);
    const frames = generateInbetweens(a, b, w, h, { count: 3, method: 'morph', ease: { kind: 'linear' }, smoothing: 2, fillHoles: false });
    for (const f of frames) {
      expect(countColor(f, red)).toBe(36);
      expect(countColor(f, leg)).toBe(4);
    }
  });
});

describe('translations', () => {
  it('has Korean and English text for every effect, preset, particle and VFX', () => {
    const keys: string[] = [];
    for (const def of EFFECTS) {
      keys.push(`effect.${def.type}`);
      for (const prm of def.params) {
        keys.push(`fxParam.${prm.key}`);
        for (const o of prm.options ?? []) keys.push(`fxOpt.${o}`);
      }
    }
    for (const preset of EFFECT_PRESETS) keys.push(`fxPreset.${preset.id}`, `fxPresetTip.${preset.id}`);
    for (const id of PARTICLE_PRESET_IDS) keys.push(`particlePreset.${id}`);
    for (const k of VFX_KINDS) keys.push(`vfx.${k}`);
    for (const r of ['landing', 'impact', 'fastSwing', 'fastMove', 'apex', 'manual']) keys.push(`vfxReason.${r}`);
    const missingKo = keys.filter((k) => !(k in ko));
    const missingEn = keys.filter((k) => !(k in en));
    expect(missingKo).toEqual([]);
    expect(missingEn).toEqual([]);
  });
});
