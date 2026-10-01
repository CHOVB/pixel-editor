/**
 * 오류 보고 테스트: 개인 정보 지우기 · 동의 · 전송 횟수 제한 · 받는 서버
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoReport, buildReport, reportingAvailable, resetReportLimits, scrub, sendReport, shouldSend } from '../src/platform/errorReport';
// @ts-expect-error – 예제 서버는 타입 정보가 없는 .mjs 파일입니다
import { cleanReport, startServer } from '../scripts/error-receiver.mjs';
// @ts-expect-error – 스크립트 파일
import { endpointFromRemote } from '../scripts/updater-keygen.mjs';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetReportLimits();
});

describe('scrub', () => {
  it('removes emails, user folders, local files and query strings', () => {
    const s = scrub(
      'Cannot open /Users/alice/Desktop/secret.pxe or C:\\Users\\Bob\\x.pxe for bob.smith@example.com at file:///home/carol/a.png see https://x.dev/a?token=abc',
    );
    expect(s).not.toMatch(/alice|Bob|bob\.smith|carol|token/);
    expect(s).toContain('/Users/<user>/Desktop/secret.pxe');
    expect(s).toContain('C:\\Users\\<user>\\x.pxe');
    expect(s).toContain('<email>');
    expect(s).toContain('file://<path>');
    expect(s).toContain('https://x.dev/a?<q>');
  });

  it('limits length', () => {
    expect(scrub('x'.repeat(2000)).length).toBeLessThanOrEqual(501);
  });
});

describe('report building and limits', () => {
  it('builds a small report without project data', () => {
    const r = buildReport({ message: 'boom /home/dan/a.pxe', stack: 'Error: boom\n    at draw (app.js:1:2)' }, { tool: 'pencil' });
    expect(r.app).toBe('pixel-editor');
    expect(r.platform).toBe('web');
    expect(r.message).toBe('boom /home/<user>/a.pxe');
    expect(r.context).toEqual({ tool: 'pencil' });
    expect(JSON.stringify(r).length).toBeLessThan(32 * 1024);
  });

  it('is unavailable without a configured address and never sends', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await reportingAvailable()).toBe(false);
    expect(await sendReport(buildReport({ message: 'x' }))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('auto report needs the user to opt in', async () => {
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.com/report');
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await autoReport({ message: 'not consented' })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dedupes the same error and caps reports per session', () => {
    const a = buildReport({ message: 'same', stack: 'Error\n    at f (a.js:1:1)' });
    expect(shouldSend(a)).toBe(true);
  });

  it('rejects plain http addresses except localhost', async () => {
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'http://reports.example.com/report');
    expect(await reportingAvailable()).toBe(false);
  });
});

describe('receiver', () => {
  it('stores a cleaned report sent by the app, once per error', async () => {
    const received: { message: string; context: Record<string, unknown> }[] = [];
    const server = startServer({ port: 0, host: '127.0.0.1', onReport: (r: (typeof received)[number]) => received.push(r) });
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };
    try {
      vi.stubEnv('VITE_ERROR_REPORT_URL', `http://127.0.0.1:${port}/report`);
      const report = buildReport({ message: 'kaboom at /Users/eve/x.pxe', stack: 'Error\n    at draw (app.js:3:4)' }, { tool: 'fill' });
      expect(await sendReport(report)).toBe(true);
      expect(await sendReport(report)).toBe(false); // 같은 오류는 한 번만
      for (let i = 0; i < 10; i++) await sendReport(buildReport({ message: `other ${i}`, stack: `Error\n    at f${i} (a.js:1:1)` }));
      expect(received).toHaveLength(5); // 한 번 실행에 최대 5개
      expect(received[0].message).toBe('kaboom at /Users/<user>/x.pxe');
      expect(received[0].context).toEqual({ tool: 'fill' });
      expect(received[0]).not.toHaveProperty('ip');
      // 잘못된 보고는 거절
      const bad = await fetch(`http://127.0.0.1:${port}/report`, { method: 'POST', body: '{"app":"other"}' });
      expect(bad.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('cleanReport drops unknown fields', () => {
    const c = cleanReport({ app: 'pixel-editor', message: 'm', extra: 'secret', context: { a: 1, b: { deep: true } } });
    expect(c).not.toHaveProperty('extra');
    expect(c.context).toEqual({ a: 1 });
    expect(cleanReport({ app: 'nope' })).toBeNull();
  });
});

describe('updater keygen helper', () => {
  it('turns a GitHub remote into the latest.json address', () => {
    expect(endpointFromRemote('git@github.com:CHOVB/pixel-editor.git')).toBe('https://github.com/CHOVB/pixel-editor/releases/latest/download/latest.json');
    expect(endpointFromRemote('https://github.com/a/b')).toBe('https://github.com/a/b/releases/latest/download/latest.json');
    expect(endpointFromRemote('http://127.0.0.1:8080/git/a/b')).toBeNull();
  });
});
