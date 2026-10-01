#!/usr/bin/env node
/**
 * 오류 보고 받는 서버 (예제)
 * ------------------------------------------------------------
 * 앱이 보낸 오류 보고(JSON)를 받아서 파일에 한 줄씩 저장합니다.
 * 작은 VPS, Render, Fly.io, 사내 서버 등에서 그대로 실행할 수 있습니다.
 *
 *   node scripts/error-receiver.mjs
 *   PORT=8790 REPORT_FILE=./error-reports.jsonl ALLOWED_ORIGINS=https://my-editor.example.com node scripts/error-receiver.mjs
 *
 * 그리고 앱을 빌드할 때 주소를 알려 줍니다.
 *   웹:       VITE_ERROR_REPORT_URL=https://reports.example.com/report npm run build
 *   데스크톱: PIXEL_EDITOR_ERROR_REPORT_URL=https://reports.example.com/report npm run desktop:build
 *
 * 개인 정보 보호
 *  - IP 주소는 저장하지 않습니다.
 *  - 32KB 보다 큰 보고, JSON 이 아닌 보고, app 값이 다른 보고는 버립니다.
 *  - 같은 곳에서 1분에 30개 넘게 오면 잠시 막습니다. (메모리 안에서만 세고 저장하지 않음)
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? '127.0.0.1';
const FILE = process.env.REPORT_FILE ?? 'error-reports.jsonl';
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BYTES = 32 * 1024;
const RATE_LIMIT = 30;

const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();

function corsOrigin(origin) {
  if (ALLOWED.includes('*')) return '*';
  return origin && ALLOWED.includes(origin) ? origin : null;
}

/** 보고 내용 검사: 필요한 칸만 골라서 돌려줌 (모르는 칸은 버림) */
export function cleanReport(data) {
  if (!data || typeof data !== 'object' || data.app !== 'pixel-editor') return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const context = {};
  if (data.context && typeof data.context === 'object') {
    for (const [k, v] of Object.entries(data.context).slice(0, 20)) {
      if (['string', 'number', 'boolean'].includes(typeof v)) context[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
    }
  }
  return {
    receivedAt: new Date().toISOString(),
    version: str(data.version, 40),
    platform: str(data.platform, 20),
    userAgent: str(data.userAgent, 300),
    language: str(data.language, 20),
    time: str(data.time, 40),
    message: str(data.message, 1000),
    stack: str(data.stack, 8000),
    context,
  };
}

/**
 * 서버 시작. onReport 를 주면 파일 대신 그 함수로 보고를 넘깁니다. (테스트·다른 저장소 연결용)
 */
export function startServer({ port = PORT, host = HOST, file = FILE, onReport = null } = {}) {
  const server = createServer((req, res) => {
    const allow = corsOrigin(req.headers.origin);
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (allow !== '*') res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/report')) {
      res.writeHead(404).end();
      return;
    }
    const who = req.socket.remoteAddress ?? '?';
    const n = (hits.get(who) ?? 0) + 1;
    hits.set(who, n);
    if (n > RATE_LIMIT) {
      res.writeHead(429).end();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      const clean = cleanReport(data);
      if (!clean) {
        res.writeHead(400).end();
        return;
      }
      if (onReport) onReport(clean);
      else appendFileSync(file, `${JSON.stringify(clean)}\n`);
      res.writeHead(204).end();
    });
  });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  startServer();
  console.log(`오류 보고 서버: http://${HOST}:${PORT}/report  →  ${FILE}`);
}
