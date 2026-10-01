/**
 * Codex 연동 (ChatGPT 계정 로그인 사용 – API 키 없음)
 * ------------------------------------------------------------
 * 웹 브라우저는 보안상 내 PC의 프로그램(codex)을 직접 실행할 수 없습니다.
 * 그래서 내 PC에서 작은 "Codex 브리지" 프로그램을 실행해 두고, 에디터는 그 브리지에 일을 맡깁니다.
 *
 *   에디터 ──(이미지+지시문)──▶ Codex 브리지(localhost) ──▶ `codex exec` (내 ChatGPT 로그인)
 *          ◀──────(결과 이미지)──────────────────────────────┘
 *
 *  - 브리지 실행:  npm run codex-bridge   (bridge/codex-bridge.mjs)
 *  - 로그인:       codex login            (ChatGPT 계정으로 로그인, 한 번만)
 *  - 데스크톱 앱(Tauri)에서는 브리지 없이 앱이 codex 를 직접 실행합니다. (같은 함수 사용)
 *
 * Codex 의 내장 이미지 생성/편집 도구(image_gen)가 그림을 만들고,
 * 결과는 에디터의 "도트 정리" 기능으로 진짜 도트(1칸=1픽셀)로 다듬어서 사용합니다.
 */
import { bytesToBase64, base64ToBytes } from '../core/fileFormat';
import { loadPrefs, savePrefs } from '../store/prefs';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:47811';

export interface CodexStatus {
  /** 브리지(또는 데스크톱 앱 기능)에 연결되었는지 */
  connected: boolean;
  bridgeVersion?: string;
  codexInstalled: boolean;
  codexVersion?: string;
  loggedIn: boolean;
  /** 'chatgpt' = ChatGPT 계정 로그인, 'apikey' = API 키 로그인 */
  authMode?: 'chatgpt' | 'apikey' | 'unknown';
  message?: string;
}

export interface CodexImage {
  name: string;
  png: Blob;
}

export interface CodexJobInput {
  task: 'inpaint' | 'inbetween' | 'generate' | 'polish';
  prompt: string;
  images: CodexImage[];
}

export interface CodexJobState {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  log: string;
  error?: string;
  /** 결과 PNG (base64) */
  result?: string;
}

/* ------------------------------------------------------------------ */
/* 전송 방식: 데스크톱(Tauri) 이면 앱 명령, 아니면 HTTP 브리지              */
/* ------------------------------------------------------------------ */

interface TauriWindow {
  __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function tauri(): TauriWindow['__TAURI_INTERNALS__'] | undefined {
  return typeof window !== 'undefined' ? (window as unknown as TauriWindow).__TAURI_INTERNALS__ : undefined;
}

export function isDesktopApp(): boolean {
  return !!tauri();
}

export function bridgeUrl(): string {
  return (loadPrefs().codexBridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
}

export function setBridgeUrl(url: string): void {
  savePrefs({ codexBridgeUrl: url.trim() || DEFAULT_BRIDGE_URL });
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${bridgeUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function call<T>(command: string, args: Record<string, unknown>, httpPath: string, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const t = tauri();
  if (t) return (await t.invoke(command, args)) as T;
  return http<T>(httpPath, method === 'GET' ? undefined : { method, body: JSON.stringify(args) });
}

/* ------------------------------------------------------------------ */
/* 공개 함수                                                             */
/* ------------------------------------------------------------------ */

export async function getCodexStatus(): Promise<CodexStatus> {
  try {
    return await call<CodexStatus>('codex_status', {}, '/status', 'GET');
  } catch (err) {
    return { connected: false, codexInstalled: false, loggedIn: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** ChatGPT 계정 로그인 시작 (브라우저 창이 열립니다) */
export async function startCodexLogin(): Promise<{ started: boolean; message?: string }> {
  return call('codex_login', {}, '/login');
}

async function blobToBase64(b: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await b.arrayBuffer()));
}

/**
 * Codex 작업 실행. 끝날 때까지 기다렸다가 결과 이미지를 돌려줍니다.
 * onLog: 진행 로그(일부)를 받아 화면에 보여줄 때 사용
 */
export async function runCodexJob(input: CodexJobInput, onLog?: (log: string) => void, signal?: AbortSignal): Promise<Blob> {
  const images = await Promise.all(input.images.map(async (img) => ({ name: img.name, data: await blobToBase64(img.png) })));
  const { id } = await call<{ id: string }>('codex_job_start', { task: input.task, prompt: input.prompt, images }, '/jobs');
  for (;;) {
    if (signal?.aborted) {
      await call('codex_job_cancel', { id }, `/jobs/${id}/cancel`).catch(() => undefined);
      throw new DOMException('cancelled', 'AbortError');
    }
    await new Promise((r) => setTimeout(r, 1500));
    const state = await call<CodexJobState>('codex_job_get', { id }, `/jobs/${id}`, 'GET');
    onLog?.(state.log);
    if (state.status === 'done' && state.result) {
      return new Blob([base64ToBytes(state.result) as BlobPart], { type: 'image/png' });
    }
    if (state.status === 'error' || state.status === 'cancelled') throw new Error(state.error || state.status);
  }
}

/* ------------------------------------------------------------------ */
/* 작업별 지시문 (Codex 에게 보내는 프롬프트)                              */
/* ------------------------------------------------------------------ */

export function inpaintPrompt(scale: number, w: number, h: number, extra: string): string {
  return [
    'You are assisting a pixel-art animation editor. Work only inside the current directory.',
    '',
    'Attached images:',
    `1. body.png — one layer of a pixel-art character, upscaled x${scale} (every ${scale}x${scale} block is ONE sprite pixel). The magenta (#FF00FF) area is where another body part used to cover this layer; that area is now missing.`,
    '2. mask.png — white = the exact area to repaint, black = keep unchanged.',
    '3. part.png — the part that was cut out (it will move during animation). Context only.',
    '',
    'Task: use your built-in image generation/editing tool (image_gen) to repaint ONLY the white mask area of body.png',
    'with the hidden body/clothing that would naturally be behind the removed part. Continue the existing shapes, outlines,',
    `shading and colors. Keep the exact same pixel-art style, palette and ${scale}px block grid. Do not change anything outside the mask.`,
    'Keep the background transparent (no magenta left in the result).',
    extra ? `Extra instructions from the artist: ${extra}` : '',
    '',
    `Output: save the final image as ./result.png. Prefer exactly ${w}x${h} pixels; any size with the same aspect ratio is acceptable.`,
    'When done, reply with one short sentence.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function inbetweenPrompt(scale: number, frameW: number, frameH: number, count: number, extra: string): string {
  return [
    'You are assisting a pixel-art animation editor. Work only inside the current directory.',
    '',
    `Attached: start.png and end.png — two key frames of a pixel-art animation, upscaled x${scale} (every ${scale}x${scale} block is ONE sprite pixel).`,
    '',
    `Task: use your built-in image generation tool (image_gen) to draw ${count} in-between frame(s) that smoothly animate from start.png to end.png`,
    '(natural motion arcs, same character, same proportions, same palette, same pixel-art style and block grid, transparent background).',
    `Place the ${count} frame(s) left-to-right in ONE horizontal strip image with no gaps; each frame is ${frameW}x${frameH} pixels.`,
    extra ? `Extra instructions from the artist: ${extra}` : '',
    '',
    `Output: save the strip as ./result.png (${frameW * count}x${frameH} preferred; same aspect ratio is acceptable). Reply with one short sentence when done.`,
  ].join('\n');
}

export function generatePrompt(description: string, sizeHint: number): string {
  return [
    'You are assisting a pixel-art editor. Work only inside the current directory.',
    '',
    `Task: use your built-in image generation tool (image_gen) to create a clean pixel-art sprite: ${description}`,
    `Style: true pixel art with a clear, consistent pixel grid (as if drawn at about ${sizeHint}x${sizeHint} pixels and scaled up with nearest-neighbor),`,
    'limited palette, crisp 1px outlines, no anti-aliasing, no blur, transparent background, single centered character/object, no text.',
    '',
    'Output: save the image as ./result.png. Reply with one short sentence when done.',
  ].join('\n');
}

/** AI 다듬기: 뼈대로 만든 프레임들을 손으로 그린 도트처럼 다시 그리기 */
export function polishPrompt(o: { count: number; cols: number; rows: number; cellW: number; cellH: number; scale: number; extra: string }): string {
  const W = o.cols * o.cellW * o.scale;
  const H = o.rows * o.cellH * o.scale;
  return [
    'You are assisting a pixel-art animation editor. Work only inside the current directory.',
    '',
    'Attached images:',
    `1. frames.png — ${o.count} animation frames of ONE pixel-art character in a ${o.cols}x${o.rows} grid (left-to-right, top-to-bottom).`,
    `   Each cell is ${o.cellW}x${o.cellH} sprite pixels, upscaled x${o.scale} (every ${o.scale}x${o.scale} block is ONE sprite pixel). Unused cells are empty.`,
    '   The frames come from a cut-out puppet rig: poses and timing are correct, but rotated limbs have jagged or broken pixels,',
    '   stiff joints and slightly inconsistent outlines.',
    '2. character.png — the original hand-drawn character at the same scale. It is the identity reference (palette, outfit, proportions, face).',
    '',
    'Task: use your built-in image generation/editing tool (image_gen) to redraw EVERY frame as clean, hand-drawn pixel art of this character.',
    'Rules:',
    '- Keep each frame\'s pose, position inside its cell, size and silhouette almost exactly the same (frames must line up as an animation).',
    '- Keep the character identical to character.png: same palette, outfit, proportions and outline color. No new objects, effects, shadows or background.',
    '- Fix rotation artifacts: smooth jagged limbs, clean 1px outlines, natural elbows and knees, consistent shading from frame to frame.',
    '- Very subtle natural follow-through (hair, cloth) is welcome; do not invent new poses.',
    `- Keep exactly the same ${o.cols}x${o.rows} grid, cell size and ${o.scale}px block grid, with a fully transparent background.`,
    o.extra ? `Extra instructions from the artist: ${o.extra}` : '',
    '',
    `Output: save the image as ./result.png (${W}x${H} preferred; the same aspect ratio is acceptable). Reply with one short sentence when done.`,
  ].join('\n');
}
