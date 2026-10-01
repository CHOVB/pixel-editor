/**
 * 파일 관련 동작: 새로 만들기 / 열기 / 저장 / 가져오기 / 내보내기 / 자동 저장
 * ------------------------------------------------------------
 */
import { buildSpriteSheet, buildSpriteSheetJson, encodeGif, type GifOptions, type SpriteSheetOptions } from '../core/exporters';
import { deserializeProject, PROJECT_EXTENSION, serializeProject } from '../core/fileFormat';
import { parsePaletteFile, toGplFile, toHexFile } from '../core/palettes';
import { blitBuffer, createBuffer, upscaleInteger } from '../core/pixels';
import { addLayer, celKey, createProject, MAX_CANVAS_SIZE, nextLayerName } from '../core/project';
import { compositeFrame } from '../core/render';
import type { Color } from '../core/types';
import { tr } from '../i18n';
import { bufferToPngBlob, decodeImageFile } from '../platform/canvas';
import { openFileDialog, saveBlob, type FileTypeOption, type WritableHandle } from '../platform/fileio';
import { kvDelete, kvGet, kvSet } from '../platform/storage';
import { commitStructure, notify, replaceProject, setPaletteColors } from '../store/actions';
import { getState, setState } from '../store/editorStore';
import { openGifAsProject } from './importActions';

const PROJECT_TYPES: FileTypeOption[] = [
  { description: 'Pixel Editor Project', accept: { 'application/json': [PROJECT_EXTENSION] } },
];
const OPEN_TYPES: FileTypeOption[] = [
  {
    description: 'Pixel Editor Project / Image',
    accept: {
      'application/json': [PROJECT_EXTENSION],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'image/bmp': ['.bmp'],
    },
  },
];
const IMAGE_TYPES: FileTypeOption[] = [
  {
    description: 'Image',
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'image/bmp': ['.bmp'],
    },
  },
];
const PNG_TYPES: FileTypeOption[] = [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }];
const GIF_TYPES: FileTypeOption[] = [{ description: 'GIF Animation', accept: { 'image/gif': ['.gif'] } }];
const JSON_TYPES: FileTypeOption[] = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

/** 지금 열려 있는 파일의 핸들 (Ctrl+S 덮어쓰기용) */
let currentHandle: WritableHandle | null = null;

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function safeName(): string {
  return (getState().project.name || 'untitled').replace(/[\\/:*?"<>|]/g, '_');
}

/* ------------------------------------------------------------------ */
/* 저장되지 않은 변경 확인                                              */
/* ------------------------------------------------------------------ */

/** 저장 안 된 작업이 있으면 확인 창을 띄우고, 확인하면 run 을 실행합니다. */
export function confirmDiscard(run: () => void): void {
  if (!getState().dirty) {
    run();
    return;
  }
  setState({
    dialog: {
      id: 'confirm',
      payload: { message: tr('confirm.discard'), confirmLabel: tr('confirm.discardOk'), onConfirm: run },
    },
  });
}

/* ------------------------------------------------------------------ */
/* 새로 만들기 / 열기 / 저장                                            */
/* ------------------------------------------------------------------ */

export function newProject(width: number, height: number, background: Color | null, name?: string): void {
  const s = getState();
  const project = createProject(width, height, {
    name: name || tr('project.untitled'),
    background,
    palette: s.project.palette,
    layerName: `${tr('layer.defaultName')} 1`,
  });
  currentHandle = null;
  replaceProject(project, null);
}

export async function openFile(): Promise<void> {
  const result = await openFileDialog([PROJECT_EXTENSION, '.json', 'image/*'], OPEN_TYPES);
  if (!result) return;
  await openFileObject(result.file, result.handle);
}

/**
 * 파일 객체(열기 대화상자, 드래그&드롭)를 열기
 * opts.direct=true 면 큰 이미지도 "AI 도트 정리" 를 거치지 않고 그대로 엽니다.
 */
export async function openFileObject(file: File, handle: WritableHandle | null = null, opts: { direct?: boolean } = {}): Promise<void> {
  const lower = file.name.toLowerCase();
  try {
    // 확장자가 바뀌었거나 없어도 내용이 '{' 로 시작하면 프로젝트 파일로 봅니다.
    const head = (await file.slice(0, 32).text()).trimStart();
    if (lower.endsWith(PROJECT_EXTENSION) || lower.endsWith('.json') || head.startsWith('{')) {
      const project = await deserializeProject(await file.text());
      currentHandle = handle;
      replaceProject(project, file.name);
      notify(tr('toast.opened', { name: file.name }), 'success');
      return;
    }
    // 움직이는 GIF 는 프레임별로 나눠서 엽니다.
    if (lower.endsWith('.gif') || file.type === 'image/gif') {
      if (await openGifAsProject(file)) return;
    }
    const image = await decodeImageFile(file);
    // 큰 이미지(대부분 AI 가 만든 도트 그림)는 "AI 도트 정리" 로 여는 것을 추천합니다.
    if (!opts.direct && Math.max(image.width, image.height) > 256) {
      setState({ dialog: { id: 'pixelFixer', payload: { file } } });
      return;
    }
    if (image.width > MAX_CANVAS_SIZE || image.height > MAX_CANVAS_SIZE) {
      notify(tr('toast.imageTooLarge', { max: MAX_CANVAS_SIZE }), 'error');
      return;
    }
    const project = createProject(image.width, image.height, {
      name: baseName(file.name),
      palette: getState().project.palette,
      layerName: `${tr('layer.defaultName')} 1`,
    });
    project.cels[celKey(project.layers[0].id, project.frames[0].id)] = new Uint8ClampedArray(image.pixels);
    currentHandle = null;
    replaceProject(project, null);
    notify(tr('toast.opened', { name: file.name }), 'success');
  } catch (err) {
    console.error(err);
    notify(tr('toast.openFailed'), 'error');
  }
}

export async function saveProject(saveAs = false): Promise<void> {
  const s = getState();
  try {
    const text = await serializeProject(s.project);
    const blob = new Blob([text], { type: 'application/json' });
    const suggested = s.fileName ?? `${safeName()}${PROJECT_EXTENSION}`;
    const result = await saveBlob(blob, suggested, PROJECT_TYPES, saveAs ? null : currentHandle);
    if (!result) return;
    currentHandle = result.handle;
    setState({ fileName: result.name, dirty: false });
    notify(tr('toast.saved', { name: result.name }), 'success');
  } catch (err) {
    console.error(err);
    notify(tr('toast.saveFailed'), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 가져오기                                                             */
/* ------------------------------------------------------------------ */

/** 이미지를 현재 프레임의 새 레이어로 가져오기 */
export async function importImageAsLayer(): Promise<void> {
  const result = await openFileDialog(['image/*'], IMAGE_TYPES);
  if (!result) return;
  await importImageFileAsLayer(result.file);
}

export async function importImageFileAsLayer(file: File): Promise<void> {
  try {
    const image = await decodeImageFile(file);
    const s = getState();
    const p = s.project;
    const buf = createBuffer(p.width, p.height);
    blitBuffer(image.pixels, image.width, image.height, buf, p.width, p.height, 0, 0);
    commitStructure(tr('history.importImage'), (proj) => {
      const idx = proj.layers.findIndex((l) => l.id === s.currentLayerId);
      const layer = addLayer(proj, idx + 1, baseName(file.name) || nextLayerName(proj, tr('layer.defaultName')));
      proj.cels[celKey(layer.id, proj.frames[s.currentFrame].id)] = buf;
      return { layerId: layer.id };
    });
    if (image.width > p.width || image.height > p.height) notify(tr('toast.imageCropped'));
    else notify(tr('toast.imported', { name: file.name }), 'success');
  } catch (err) {
    console.error(err);
    notify(tr('toast.openFailed'), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 내보내기                                                             */
/* ------------------------------------------------------------------ */

export async function exportPngFrame(frameIndex: number, scale: number): Promise<void> {
  const p = getState().project;
  const image = upscaleInteger(compositeFrame(p, frameIndex), p.width, p.height, scale);
  const blob = await bufferToPngBlob(image, p.width * scale, p.height * scale);
  const suffix = p.frames.length > 1 ? `_${frameIndex + 1}` : '';
  const result = await saveBlob(blob, `${safeName()}${suffix}.png`, PNG_TYPES);
  if (result) notify(tr('toast.exported', { name: result.name }), 'success');
}

export async function exportSpriteSheet(opts: SpriteSheetOptions, withJson: boolean): Promise<void> {
  const p = getState().project;
  const sheet = buildSpriteSheet(p, opts);
  const blob = await bufferToPngBlob(sheet.pixels, sheet.width, sheet.height);
  const result = await saveBlob(blob, `${safeName()}_sheet.png`, PNG_TYPES);
  if (!result) return;
  if (withJson) {
    const json = buildSpriteSheetJson(p, opts, sheet, result.name);
    await saveBlob(new Blob([json], { type: 'application/json' }), `${baseName(result.name)}.json`, JSON_TYPES);
  }
  notify(tr('toast.exported', { name: result.name }), 'success');
}

export async function exportGif(opts: GifOptions): Promise<void> {
  const p = getState().project;
  const bytes = encodeGif(p, opts);
  const blob = new Blob([bytes as BlobPart], { type: 'image/gif' });
  const result = await saveBlob(blob, `${safeName()}.gif`, GIF_TYPES);
  if (result) notify(tr('toast.exported', { name: result.name }), 'success');
}

/* ------------------------------------------------------------------ */
/* 팔레트 파일                                                          */
/* ------------------------------------------------------------------ */

export async function importPaletteFile(): Promise<void> {
  const result = await openFileDialog(['.hex', '.gpl', '.txt'], [
    { description: 'Palette', accept: { 'text/plain': ['.hex', '.gpl', '.txt'] } },
  ]);
  if (!result) return;
  const colors = parsePaletteFile(await result.file.text(), result.file.name);
  if (colors.length === 0) {
    notify(tr('toast.paletteEmpty'), 'error');
    return;
  }
  setPaletteColors(colors.slice(0, 256), tr('history.loadPalette'));
  notify(tr('toast.paletteImported', { count: colors.length }), 'success');
}

export async function exportPaletteFile(format: 'hex' | 'gpl'): Promise<void> {
  const p = getState().project;
  const text = format === 'hex' ? toHexFile(p.palette) : toGplFile(p.palette, p.name);
  const result = await saveBlob(new Blob([text], { type: 'text/plain' }), `${safeName()}.${format}`, [
    { description: 'Palette', accept: { 'text/plain': [`.${format}`] } },
  ]);
  if (result) notify(tr('toast.exported', { name: result.name }), 'success');
}

/* ------------------------------------------------------------------ */
/* 자동 저장                                                            */
/* ------------------------------------------------------------------ */

const AUTOSAVE_KEY = 'autosave';
const AUTOSAVE_INTERVAL = 15000;

export interface AutosaveRecord {
  text: string;
  savedAt: number;
  name: string;
  width: number;
  height: number;
}

let lastAutosaveVersion = -1;
let autosaveTimer: ReturnType<typeof setInterval> | null = null;

export function startAutosave(): void {
  if (autosaveTimer) return;
  autosaveTimer = setInterval(() => {
    void autosaveNow();
  }, AUTOSAVE_INTERVAL);
}

export async function autosaveNow(): Promise<void> {
  const s = getState();
  if (!s.dirty || s.docVersion === lastAutosaveVersion) return;
  try {
    const text = await serializeProject(s.project);
    const record: AutosaveRecord = {
      text,
      savedAt: Date.now(),
      name: s.project.name,
      width: s.project.width,
      height: s.project.height,
    };
    await kvSet(AUTOSAVE_KEY, record);
    lastAutosaveVersion = s.docVersion;
  } catch (err) {
    console.warn('자동 저장 실패', err);
  }
}

export async function loadAutosaveInfo(): Promise<AutosaveRecord | undefined> {
  try {
    return await kvGet<AutosaveRecord>(AUTOSAVE_KEY);
  } catch {
    return undefined;
  }
}

export async function restoreAutosave(): Promise<boolean> {
  const record = await loadAutosaveInfo();
  if (!record) return false;
  try {
    const project = await deserializeProject(record.text);
    currentHandle = null;
    replaceProject(project, null);
    setState({ dirty: true });
    notify(tr('toast.restored'), 'success');
    return true;
  } catch (err) {
    console.error(err);
    notify(tr('toast.openFailed'), 'error');
    return false;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await kvDelete(AUTOSAVE_KEY);
  } catch {
    // 무시
  }
}
