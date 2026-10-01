/**
 * Aseprite 파일 읽기/쓰기 테스트
 */
import { describe, expect, it } from 'vitest';
import { readAseprite, writeAseprite, zlibCompress } from '../src/core/aseprite';
import { packColor } from '../src/core/color';
import { createTrack, setKey } from '../src/core/keyframes';
import { getPixel, setPixel } from '../src/core/pixels';
import { addFrame, addLayer, addTag, celKey, createProject, ensureCel, getCel, linkCels } from '../src/core/project';
import { compositeFrame } from '../src/core/render';

const red = packColor(255, 0, 0);
const blue = packColor(0, 0, 255, 128);

describe('aseprite round trip', () => {
  it('keeps layers, groups, linked cels, tags, palette and timing', async () => {
    const p = createProject(8, 6, { name: 'hero', palette: [red, packColor(0, 255, 0)] });
    addFrame(p, 1, 150);
    addFrame(p, 2, 200);
    const base = p.layers[0];
    setPixel(ensureCel(p, base.id, p.frames[0].id), 8, 1, 1, red);
    linkCels(p, base.id, 0, [1, 2]);
    const group = addLayer(p, undefined, 'Group', 'group');
    const child = addLayer(p, undefined, 'Child');
    child.parentId = group.id;
    child.blendMode = 'multiply';
    child.opacity = 0.5;
    child.visible = false;
    setPixel(ensureCel(p, child.id, p.frames[1].id), 8, 7, 5, blue);
    addTag(p, 'walk', 0, 2);

    const bytes = await writeAseprite(p);
    expect(new DataView(bytes.buffer).getUint16(4, true)).toBe(0xa5e0);
    const q = await readAseprite(bytes, 'hero.aseprite');

    expect(q.name).toBe('hero');
    expect([q.width, q.height]).toEqual([8, 6]);
    expect(q.frames.map((f) => f.duration)).toEqual([100, 150, 200]);
    expect(q.layers.map((l) => l.name)).toEqual([base.name, 'Group', 'Child']);
    const [qb, qg, qc] = q.layers;
    expect(qg.kind).toBe('group');
    expect(qc.parentId).toBe(qg.id);
    expect(qc.blendMode).toBe('multiply');
    expect(qc.opacity).toBeCloseTo(0.5, 1);
    expect(qc.visible).toBe(false);
    // 링크 셀은 같은 버퍼를 공유
    const c0 = getCel(q, qb.id, q.frames[0].id);
    expect(c0).toBeTruthy();
    expect(getCel(q, qb.id, q.frames[2].id)).toBe(c0);
    expect(getPixel(c0 as Uint8ClampedArray, 8, 1, 1)).toBe(red);
    expect(getPixel(getCel(q, qc.id, q.frames[1].id) as Uint8ClampedArray, 8, 7, 5)).toBe(blue);
    expect(q.tags[0]).toMatchObject({ name: 'walk', from: 0, to: 2 });
    expect(q.palette).toEqual([red, packColor(0, 255, 0)]);
  });

  it('bakes keyframe motion into frames (Aseprite has no transforms)', async () => {
    const p = createProject(8, 2);
    addFrame(p, 1);
    addFrame(p, 2);
    const l = p.layers[0];
    setPixel(ensureCel(p, l.id, p.frames[0].id), 8, 0, 0, red);
    l.anim = createTrack(0, 0);
    setKey(l.anim, p.frames[0].id, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }, { kind: 'linear' });
    setKey(l.anim, p.frames[2].id, { x: 6, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }, { kind: 'linear' });
    const q = await readAseprite(await writeAseprite(p));
    for (let f = 0; f < 3; f++) {
      expect(Array.from(compositeFrame(q, f))).toEqual(Array.from(compositeFrame(p, f)));
    }
  });
});

/* 8비트 팔레트 방식 파일을 직접 만들어서 읽어 보기 (Aseprite 가 만드는 형식 그대로) */
function le(n: number, bytes: number): number[] {
  return Array.from({ length: bytes }, (_, i) => (n >>> (i * 8)) & 255);
}
function str(s: string): number[] {
  const b = Array.from(new TextEncoder().encode(s));
  return [...le(b.length, 2), ...b];
}
function chunkBytes(type: number, body: number[]): number[] {
  return [...le(body.length + 6, 4), ...le(type, 2), ...body];
}

describe('aseprite indexed (8-bit) files', () => {
  it('reads palette indices, transparent index and raw / compressed cels', async () => {
    const w = 3;
    const h = 2;
    const palette = chunkBytes(0x2019, [
      ...le(3, 4),
      ...le(0, 4),
      ...le(2, 4),
      ...new Array(8).fill(0),
      ...[0, 0, 0, 0, 0, 0],
      ...[0, 0, 255, 0, 0, 255],
      ...[0, 0, 0, 0, 255, 255],
    ]);
    const layer = chunkBytes(0x2004, [...le(3, 2), ...le(0, 2), ...le(0, 2), 0, 0, 0, 0, ...le(0, 2), 255, 0, 0, 0, ...str('Ink')]);
    // 프레임 0: 원본 그대로(raw) 셀, 프레임 1: 압축 셀
    const rawPixels = [1, 0, 2, 0, 1, 1];
    const celRaw = chunkBytes(0x2005, [...le(0, 2), ...le(0, 2), ...le(0, 2), 255, ...le(0, 2), 0, 0, 0, 0, 0, 0, 0, ...le(w, 2), ...le(h, 2), ...rawPixels]);
    const compressed = Array.from(await zlibCompress(new Uint8Array([2, 2, 2, 0, 0, 0])));
    const celZip = chunkBytes(0x2005, [...le(0, 2), ...le(0, 2), ...le(0, 2), 255, ...le(2, 2), 0, 0, 0, 0, 0, 0, 0, ...le(w, 2), ...le(h, 2), ...compressed]);
    const frame = (chunks: number[][], duration: number) => {
      const body = chunks.flat();
      return [...le(body.length + 16, 4), ...le(0xf1fa, 2), ...le(chunks.length, 2), ...le(duration, 2), 0, 0, ...le(chunks.length, 4), ...body];
    };
    const frames = [...frame([palette, layer, celRaw], 120), ...frame([celZip], 80)];
    const header = [...le(0, 4), ...le(0xa5e0, 2), ...le(2, 2), ...le(w, 2), ...le(h, 2), ...le(8, 2), ...le(1, 4), ...le(100, 2), ...le(0, 4), ...le(0, 4), 0, 0, 0, 0, ...le(3, 2), 1, 1];
    while (header.length < 128) header.push(0);
    const file = new Uint8Array([...header, ...frames]);

    const p = await readAseprite(file, 'indexed.ase');
    expect(p.frames.map((f) => f.duration)).toEqual([120, 80]);
    const f0 = p.cels[celKey(p.layers[0].id, p.frames[0].id)];
    expect(getPixel(f0, w, 0, 0)).toBe(packColor(255, 0, 0));
    expect(getPixel(f0, w, 1, 0)).toBe(0); // 0번 = 투명
    expect(getPixel(f0, w, 2, 0)).toBe(packColor(0, 0, 255));
    const f1 = p.cels[celKey(p.layers[0].id, p.frames[1].id)];
    expect(getPixel(f1, w, 1, 0)).toBe(packColor(0, 0, 255));
    expect(getPixel(f1, w, 1, 1)).toBe(0);
  });
});
