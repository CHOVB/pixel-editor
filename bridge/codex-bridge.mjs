#!/usr/bin/env node
/**
 * Codex 브리지 – 에디터(브라우저)와 내 PC의 Codex CLI 를 연결하는 작은 서버
 * ------------------------------------------------------------------
 * 실행:   npm run codex-bridge
 * 준비:   1) Codex CLI 설치   npm install -g @openai/codex
 *         2) ChatGPT 계정 로그인   codex login     (API 키 필요 없음)
 *
 * 하는 일
 *  - GET  /status          Codex 설치/로그인 상태 확인
 *  - POST /login           `codex login` 실행 (브라우저에서 ChatGPT 로그인 창이 열림)
 *  - POST /jobs            작업 시작: 이미지들을 임시 폴더에 저장 → `codex exec` 실행
 *  - GET  /jobs/:id        진행 상황/결과 확인
 *  - POST /jobs/:id/cancel 작업 취소
 *
 * 보안
 *  - 127.0.0.1(내 PC)에서만 접속을 받습니다.
 *  - 허용된 주소(에디터)에서 온 요청만 처리합니다. (다른 웹사이트가 몰래 쓰지 못하게)
 *    다른 주소에서 에디터를 쓰면 CODEX_BRIDGE_ORIGINS 환경변수에 추가하세요.
 *  - Codex 는 작업마다 새로 만든 임시 폴더 안에서만 파일을 쓸 수 있습니다. (workspace-write 샌드박스)
 *
 * 외부 라이브러리 없이 Node.js 기본 기능만 사용합니다. (Node 18 이상)
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const VERSION = '1.0.0';
const HOST = '127.0.0.1';
const PORT = Number(process.env.CODEX_BRIDGE_PORT || 47811);
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const JOB_TIMEOUT_MS = Number(process.env.CODEX_JOB_TIMEOUT_MS || 15 * 60 * 1000);
const ALLOWED_ORIGINS = (
  process.env.CODEX_BRIDGE_ORIGINS ||
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,tauri://localhost,http://tauri.localhost,https://tauri.localhost'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const IS_WINDOWS = process.platform === 'win32';
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const WORK_ROOT = path.join(os.tmpdir(), 'pixel-editor-codex');

/** @type {Map<string, {id:string,status:string,log:string,error?:string,result?:string,child?:import('node:child_process').ChildProcess,dir:string,startedAt:number}>} */
const jobs = new Map();

/* ------------------------------------------------------------------ */
/* 도우미                                                               */
/* ------------------------------------------------------------------ */

function quoteWin(arg) {
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * 실행 중인 codex 멈추기.
 * Windows 에서는 셸(cmd) → codex.cmd → node → codex 로 이어져서 child.kill() 은 cmd 만 끕니다.
 * 그러면 Codex 가 계속 돌면서 결과를 만들고 ChatGPT 사용량도 계속 쓰므로 프로세스 트리 전체를 끝냅니다.
 */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WINDOWS && child.pid) {
    spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
  child.kill();
}

/** 명령 실행 후 결과 모으기 */
function run(cmd, args, { input, cwd, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(IS_WINDOWS ? quoteWin(cmd) : cmd, IS_WINDOWS ? args.map(quoteWin) : args, {
        cwd,
        shell: IS_WINDOWS,
        windowsHide: true,
        env: process.env,
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => killTree(child), timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function codexStatus() {
  const ver = await run(CODEX_BIN, ['--version']);
  if (ver.code !== 0) {
    return {
      connected: true,
      bridgeVersion: VERSION,
      codexInstalled: false,
      loggedIn: false,
      message: 'Codex CLI not found. Install: npm install -g @openai/codex',
    };
  }
  const login = await run(CODEX_BIN, ['login', 'status']);
  // "WARNING: ..." 같은 부가 안내 줄은 빼고 로그인 상태 문장만 남깁니다.
  const text = `${login.stdout}\n${login.stderr}`
    .split('\n')
    .filter((line) => line.trim() && !/^\s*WARNING\b/i.test(line))
    .join('\n');
  const loggedIn = login.code === 0 && !/not logged in/i.test(text);
  let authMode = 'unknown';
  if (/chatgpt/i.test(text)) authMode = 'chatgpt';
  else if (/api key/i.test(text)) authMode = 'apikey';
  return {
    connected: true,
    bridgeVersion: VERSION,
    codexInstalled: true,
    codexVersion: ver.stdout.trim(),
    loggedIn,
    authMode,
    message: text.trim(),
  };
}

/** 폴더 안(하위 포함)에서 since 이후에 생긴 가장 최근 PNG 찾기 */
async function newestPng(dir, since, exclude = new Set()) {
  let best = null;
  async function walk(d, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (/\.(png|webp|jpe?g)$/i.test(e.name) && !exclude.has(full)) {
        const st = await fs.stat(full).catch(() => null);
        if (st && st.mtimeMs >= since && (!best || st.mtimeMs > best.mtime)) best = { path: full, mtime: st.mtimeMs };
      }
    }
  }
  await walk(dir, 0);
  return best?.path ?? null;
}

function appendLog(job, text) {
  job.log = (job.log + text).slice(-6000);
}

/* ------------------------------------------------------------------ */
/* 작업 실행                                                             */
/* ------------------------------------------------------------------ */

/** 로그인 확인은 몇 초 걸리므로 잠깐 기억해 둡니다. */
let statusCache = { at: 0, value: null };
async function cachedStatus() {
  if (statusCache.value && Date.now() - statusCache.at < 30_000) return statusCache.value;
  const value = await codexStatus();
  statusCache = { at: Date.now(), value };
  return value;
}

/** 네트워크에 연결하지 못하고 이만큼 기다리면 작업을 멈춥니다. */
const NETWORK_STALL_MS = Number(process.env.CODEX_NETWORK_STALL_MS || 90 * 1000);

async function startJob({ task, prompt, images }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt is required');
  if (!Array.isArray(images) || images.length > 6) throw new Error('images must be an array (max 6)');
  // 로그인하지 않은 상태로 실행하면 Codex 가 계속 재시도만 하므로 미리 막습니다.
  const st = await cachedStatus();
  if (!st.codexInstalled) throw new Error('Codex CLI 가 설치되어 있지 않아요 / Codex CLI not found → npm install -g @openai/codex');
  if (!st.loggedIn) throw new Error('Codex 로그인이 필요해요 / Codex is not signed in → codex login (ChatGPT 계정)');
  const id = randomUUID();
  const dir = path.join(WORK_ROOT, id);
  await fs.mkdir(dir, { recursive: true });
  const inputPaths = [];
  for (const img of images) {
    const safe = String(img.name || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = path.join(dir, safe.endsWith('.png') ? safe : `${safe}.png`);
    await fs.writeFile(file, Buffer.from(String(img.data), 'base64'));
    inputPaths.push(file);
  }
  await fs.writeFile(path.join(dir, 'TASK.md'), `# ${task}\n\n${prompt}\n`);
  const job = { id, status: 'running', log: '', dir, startedAt: Date.now() };
  jobs.set(id, job);

  const args = [
    'exec',
    '-', // 지시문은 표준 입력으로 전달 (따옴표/줄바꿈 문제 방지)
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    '-C',
    dir,
    '--color',
    'never',
    '-c',
    'approval_policy="never"',
    '--enable',
    'image_generation',
    '-o',
    path.join(dir, 'last-message.txt'),
  ];
  if (inputPaths.length) args.push('--image', ...inputPaths);

  appendLog(job, `$ codex exec (task=${task}, images=${inputPaths.length})\n`);
  const child = spawn(IS_WINDOWS ? quoteWin(CODEX_BIN) : CODEX_BIN, IS_WINDOWS ? args.map(quoteWin) : args, {
    cwd: dir,
    shell: IS_WINDOWS,
    windowsHide: true,
    env: process.env,
  });
  job.child = child;
  const onOutput = (d) => {
    const text = String(d);
    appendLog(job, text);
    // OpenAI 서버에 연결하지 못하면 Codex 는 끝없이 재시도합니다 → 일정 시간 뒤 알려 주고 멈춤
    if (!job.netWaitTimer && /waiting for network|stream disconnected|failed to connect/i.test(text)) {
      job.netWaitTimer = setTimeout(() => {
        if (job.status !== 'running') return;
        job.status = 'error';
        job.error = 'OpenAI 서버에 연결할 수 없어요 (인터넷/방화벽 확인) / Cannot reach OpenAI servers';
        killTree(child);
      }, NETWORK_STALL_MS);
    }
  };
  child.stdout?.on('data', onOutput);
  child.stderr?.on('data', onOutput);
  child.stdin?.end(prompt);
  const timer = setTimeout(() => {
    appendLog(job, '\n[bridge] timeout – stopping codex\n');
    job.status = 'error';
    job.error = '시간이 너무 오래 걸려서 멈췄어요 / Timed out';
    killTree(child);
  }, JOB_TIMEOUT_MS);

  child.on('error', (err) => {
    clearTimeout(timer);
    clearTimeout(job.netWaitTimer);
    job.status = 'error';
    job.error = `Failed to run codex: ${err.message}`;
  });
  child.on('close', async (code) => {
    clearTimeout(timer);
    clearTimeout(job.netWaitTimer);
    if (job.status === 'cancelled' || job.status === 'error') return;
    const exclude = new Set(inputPaths);
    let out = path.join(dir, 'result.png');
    const exists = await fs.stat(out).then(() => true, () => false);
    if (!exists) out = (await newestPng(dir, job.startedAt, exclude)) || (await newestPng(path.join(CODEX_HOME, 'generated_images'), job.startedAt, exclude));
    if (out) {
      job.result = (await fs.readFile(out)).toString('base64');
      job.status = 'done';
      appendLog(job, `\n[bridge] result: ${out}\n`);
    } else {
      job.status = 'error';
      const last = await fs.readFile(path.join(dir, 'last-message.txt'), 'utf8').catch(() => '');
      job.error = `No image was produced (exit code ${code}). ${last.trim()}`.trim();
    }
  });
  return { id };
}

/* ------------------------------------------------------------------ */
/* HTTP 서버                                                             */
/* ------------------------------------------------------------------ */

function send(res, status, data, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

async function readJson(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  // 브라우저 요청은 항상 Origin 이 있습니다. 허용 목록에 없는 사이트의 요청은 거절합니다.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    send(res, 403, { error: `Origin not allowed: ${origin}. Add it to CODEX_BRIDGE_ORIGINS.` });
    return;
  }
  if (req.method === 'OPTIONS') {
    send(res, 204, {}, origin);
    return;
  }
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      send(res, 200, await codexStatus(), origin);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      const child = spawn(IS_WINDOWS ? quoteWin(CODEX_BIN) : CODEX_BIN, ['login'], { shell: IS_WINDOWS, detached: !IS_WINDOWS, stdio: 'ignore', windowsHide: false });
      child.on('error', () => undefined);
      child.unref();
      send(res, 200, { started: true, message: 'A browser window will open for ChatGPT sign-in.' }, origin);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/jobs') {
      const body = await readJson(req);
      send(res, 200, await startJob(body), origin);
      return;
    }
    const m = url.pathname.match(/^\/jobs\/([0-9a-f-]+)(\/cancel)?$/);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) {
        send(res, 404, { error: 'job not found' }, origin);
        return;
      }
      if (req.method === 'POST' && m[2]) {
        if (job.status === 'running') {
          job.status = 'cancelled';
          killTree(job.child);
        }
        send(res, 200, { id: job.id, status: job.status }, origin);
        return;
      }
      if (req.method === 'GET' && !m[2]) {
        send(res, 200, { id: job.id, status: job.status, log: job.log, error: job.error, result: job.status === 'done' ? job.result : undefined }, origin);
        return;
      }
    }
    send(res, 404, { error: 'not found' }, origin);
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) }, origin);
  }
});

server.listen(PORT, HOST, async () => {
  const st = await codexStatus();
  console.log(`\n  🎨 Pixel Editor – Codex 브리지 v${VERSION}`);
  console.log(`  주소: http://${HOST}:${PORT}`);
  console.log(`  허용된 에디터 주소: ${ALLOWED_ORIGINS.join(', ')}`);
  if (!st.codexInstalled) console.log('  ⚠ Codex CLI 가 없습니다 →  npm install -g @openai/codex');
  else if (!st.loggedIn) console.log(`  ⚠ 로그인이 필요합니다 →  codex login   (ChatGPT 계정)\n    (${st.codexVersion})`);
  else console.log(`  ✅ 준비 완료: ${st.codexVersion} / 로그인 방식: ${st.authMode}`);
  console.log('  종료하려면 Ctrl+C\n');
});

// 같은 포트에 브리지가 이미 켜져 있으면 알기 쉽게 알려 줍니다.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n  ⚠ ${PORT} 번 포트를 이미 사용 중이에요. 브리지가 이미 실행 중인지 확인하세요.`);
    console.error('    다른 포트를 쓰려면:  CODEX_BRIDGE_PORT=47812 npm run codex-bridge  (에디터의 Codex 설정에서 주소도 바꿔 주세요)\n');
    process.exit(1);
  }
  throw err;
});

// 브리지를 끌 때 실행 중인 Codex 작업도 함께 멈춥니다.
function shutdown() {
  for (const job of jobs.values()) {
    if (job.status === 'running') killTree(job.child);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
