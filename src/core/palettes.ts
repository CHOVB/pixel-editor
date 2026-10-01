/**
 * 기본 제공 팔레트 & 팔레트 파일 읽기/쓰기
 * ------------------------------------------------------------
 * - 유명한 픽셀아트 팔레트들을 기본으로 제공합니다. (출처: Lospec)
 * - .hex (Lospec), .gpl (GIMP), .txt (Paint.NET) 형식을 읽고 쓸 수 있습니다.
 */
import { colorToHex, hexToColor, packColor, unpackColor } from './color';
import type { Color } from './types';

export interface PalettePreset {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'endesga32',
    name: 'Endesga 32',
    colors: [
      'be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633',
      'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e',
      '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bb4', '5a6988', '3a4466',
      '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569',
    ],
  },
  {
    id: 'pico8',
    name: 'PICO-8',
    colors: [
      '000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8',
      'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa',
    ],
  },
  {
    id: 'sweetie16',
    name: 'Sweetie 16',
    colors: [
      '1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179',
      '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57',
    ],
  },
  {
    id: 'db16',
    name: 'DawnBringer 16',
    colors: [
      '140c1c', '442434', '30346d', '4e4a4e', '854c30', '346524', 'd04648', '757161',
      '597dce', 'd27d2c', '8595a1', '6daa2c', 'd2aa99', '6dc2ca', 'dad45e', 'deeed6',
    ],
  },
  {
    id: 'db32',
    name: 'DawnBringer 32',
    colors: [
      '000000', '222034', '45283c', '663931', '8f563b', 'df7126', 'd9a066', 'eec39a',
      'fbf236', '99e550', '6abe30', '37946e', '4b692f', '524b24', '323c39', '3f3f74',
      '306082', '5b6ee1', '639bff', '5fcde4', 'cbdbfc', 'ffffff', '9badb7', '847e87',
      '696a6a', '595652', '76428a', 'ac3232', 'd95763', 'd77bba', '8f974a', '8a6f30',
    ],
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    colors: ['0f380f', '306230', '8bac0f', '9bbc0f'],
  },
  {
    id: 'grayscale',
    name: 'Grayscale 8',
    colors: ['000000', '242424', '494949', '6d6d6d', '929292', 'b6b6b6', 'dbdbdb', 'ffffff'],
  },
  {
    id: '1bit',
    name: '1-bit',
    colors: ['000000', 'ffffff'],
  },
];

export const DEFAULT_PALETTE_ID = 'endesga32';

export function presetToColors(preset: PalettePreset): Color[] {
  return preset.colors.map((h) => hexToColor(h) ?? packColor(0, 0, 0));
}

export function getPreset(id: string): PalettePreset {
  return PALETTE_PRESETS.find((p) => p.id === id) ?? PALETTE_PRESETS[0];
}

/**
 * 팔레트 파일 내용을 읽어서 색 목록으로 바꿉니다.
 * 형식은 내용과 파일 이름(확장자)을 보고 자동으로 판단합니다.
 */
export function parsePaletteFile(text: string, fileName = ''): Color[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gpl') || text.startsWith('GIMP Palette')) return parseGpl(text);
  const colors: Color[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    // Paint.NET: AARRGGBB
    if (/^[0-9a-fA-F]{8}$/.test(line) && lower.endsWith('.txt')) {
      const a = parseInt(line.slice(0, 2), 16);
      const rgb = hexToColor(line.slice(2));
      if (rgb !== null) colors.push(((rgb & 0xffffff00) | a) >>> 0);
      continue;
    }
    const c = hexToColor(line);
    if (c !== null) colors.push(c);
  }
  return colors;
}

function parseGpl(text: string): Color[] {
  const colors: Color[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('GIMP') || line.includes(':')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if ([r, g, b].some((n) => Number.isNaN(n))) continue;
    colors.push(packColor(r, g, b));
  }
  return colors;
}

/** Lospec .hex 형식으로 저장 */
export function toHexFile(colors: Color[]): string {
  return colors.map((c) => colorToHex(c).slice(1)).join('\n') + '\n';
}

/** GIMP .gpl 형식으로 저장 */
export function toGplFile(colors: Color[], name: string): string {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#'];
  for (const c of colors) {
    const [r, g, b] = unpackColor(c);
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${colorToHex(c).slice(1)}`);
  }
  return lines.join('\n') + '\n';
}
