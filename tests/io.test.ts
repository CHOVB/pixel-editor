import { describe, expect, it } from 'vitest';
import { packColor } from '../src/core/color';
import { buildSpriteSheet, buildSpriteSheetJson, encodeGif } from '../src/core/exporters';
import { deserializeProject, ProjectFileError, serializeProject } from '../src/core/fileFormat';
import { parsePaletteFile, toGplFile, toHexFile } from '../src/core/palettes';
import { getPixel, setPixel } from '../src/core/pixels';
import { addFrame, addTag, celKey, createProject, ensureCel } from '../src/core/project';

const red = packColor(255, 0, 0);
const halfGreen = packColor(0, 255, 0, 128);

function sampleProject() {
  const p = createProject(4, 3, { name: 'hero', palette: [red, halfGreen] });
  setPixel(ensureCel(p, p.layers[0].id, p.frames[0].id), 4, 1, 1, red);
  addFrame(p, 1);
  setPixel(ensureCel(p, p.layers[0].id, p.frames[1].id), 4, 2, 2, halfGreen);
  p.frames[1].duration = 250;
  addTag(p, 'walk', 0, 1);
  return p;
}

describe('project file', () => {
  it('saves and loads without losing pixels', async () => {
    const p = sampleProject();
    const text = await serializeProject(p);
    const loaded = await deserializeProject(text);
    expect(loaded.name).toBe('hero');
    expect([loaded.width, loaded.height]).toEqual([4, 3]);
    expect(loaded.frames.map((f) => f.duration)).toEqual([100, 250]);
    expect(loaded.tags[0]).toMatchObject({ name: 'walk', from: 0, to: 1 });
    expect(loaded.palette).toEqual([red, halfGreen]);
    const l = loaded.layers[0].id;
    expect(getPixel(loaded.cels[celKey(l, loaded.frames[0].id)], 4, 1, 1)).toBe(red);
    // 반투명 픽셀도 정확히 보존되어야 합니다.
    expect(getPixel(loaded.cels[celKey(l, loaded.frames[1].id)], 4, 2, 2)).toBe(halfGreen);
  });

  it('rejects files that are not projects', async () => {
    await expect(deserializeProject('not json')).rejects.toBeInstanceOf(ProjectFileError);
    await expect(deserializeProject('{"format":"other"}')).rejects.toBeInstanceOf(ProjectFileError);
  });
});

describe('palette files', () => {
  it('reads .hex, .gpl and paint.net files', () => {
    expect(parsePaletteFile('ff0000\n00ff00\n', 'a.hex')).toEqual([red, packColor(0, 255, 0)]);
    const gpl = toGplFile([red], 'x');
    expect(parsePaletteFile(gpl, 'x.gpl')).toEqual([red]);
    expect(parsePaletteFile('; comment\nFFFF0000\n80FF0000', 'p.txt')).toEqual([red, packColor(255, 0, 0, 128)]);
    expect(toHexFile([red])).toBe('ff0000\n');
  });
});

describe('exporters', () => {
  it('lays out a sprite sheet', () => {
    const p = sampleProject();
    const sheet = buildSpriteSheet(p, { layout: 'horizontal', columns: 1, padding: 1, scale: 2, frames: [0, 1] });
    expect([sheet.width, sheet.height]).toEqual([4 * 2 * 2 + 1, 3 * 2]);
    expect(sheet.rects[1]).toEqual({ x: 9, y: 0, w: 8, h: 6 });
    expect(getPixel(sheet.pixels, sheet.width, 2, 2)).toBe(red);
    const json = JSON.parse(buildSpriteSheetJson(p, { layout: 'horizontal', columns: 1, padding: 1, scale: 2, frames: [0, 1] }, sheet, 'hero.png'));
    expect(json.frames).toHaveLength(2);
    expect(json.frames[1].duration).toBe(250);
    expect(json.meta.frameTags[0]).toMatchObject({ name: 'walk', from: 0, to: 1 });
  });

  it('encodes a valid animated GIF', () => {
    const p = sampleProject();
    const bytes = encodeGif(p, { frames: [0, 1], scale: 1, loop: true, background: null });
    const header = String.fromCharCode(...bytes.slice(0, 6));
    expect(header).toBe('GIF89a');
    expect(bytes[bytes.length - 1]).toBe(0x3b); // GIF 끝 표시
  });
});
