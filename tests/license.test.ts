/**
 * 라이선스 키 확인 테스트 (테스트 안에서 키 쌍을 새로 만들어 발급/확인)
 */
import { describe, expect, it } from 'vitest';
import { verifyLicenseKey } from '../src/licensing/license';

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function makeIssuer() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  const issue = async (payload: Record<string, string>) => {
    const body = `PXE1.${b64url(new TextEncoder().encode(JSON.stringify(payload)))}`;
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(body)));
    return `${body}.${b64url(sig)}`;
  };
  return { pub, issue };
}

describe('license keys', () => {
  it('accepts a correctly signed key', async () => {
    const { pub, issue } = await makeIssuer();
    const key = await issue({ n: '홍길동', e: 'hong@example.com', p: 'pro', i: '2026-10-01', id: 'A-1' });
    const r = await verifyLicenseKey(key, pub);
    expect(r).toEqual({ valid: true, info: { name: '홍길동', email: 'hong@example.com', plan: 'pro', issued: '2026-10-01', expires: undefined, orderId: 'A-1' } });
  });

  it('rejects tampered, foreign, expired and malformed keys', async () => {
    const { pub, issue } = await makeIssuer();
    const other = await makeIssuer();
    const key = await issue({ n: 'A', e: 'a@a.com', p: 'personal', i: '2026-01-01' });
    // 내용을 바꾸면 서명이 맞지 않음
    const [prefix, , sig] = key.split('.');
    const forged = `${prefix}.${b64url(new TextEncoder().encode(JSON.stringify({ n: 'A', e: 'a@a.com', p: 'team', i: '2026-01-01' })))}.${sig}`;
    expect(await verifyLicenseKey(forged, pub)).toEqual({ valid: false, reason: 'signature' });
    // 다른 판매자의 키
    expect(await verifyLicenseKey(key, other.pub)).toEqual({ valid: false, reason: 'signature' });
    // 만료
    const old = await issue({ n: 'A', e: 'a@a.com', p: 'pro', i: '2025-01-01', x: '2025-12-31' });
    expect(await verifyLicenseKey(old, pub, new Date('2026-06-01'))).toEqual({ valid: false, reason: 'expired' });
    expect((await verifyLicenseKey(old, pub, new Date('2025-06-01'))).valid).toBe(true);
    // 형식
    expect(await verifyLicenseKey('hello', pub)).toEqual({ valid: false, reason: 'format' });
    expect(await verifyLicenseKey('PXE1.@@@.abc', pub)).toEqual({ valid: false, reason: 'format' });
  });

  it('ignores spaces and line breaks pasted with the key', async () => {
    const { pub, issue } = await makeIssuer();
    const key = await issue({ n: 'B', e: 'b@b.com', p: 'pro', i: '2026-10-01' });
    const messy = ` ${key.slice(0, 30)}\n${key.slice(30)} `;
    expect((await verifyLicenseKey(messy, pub)).valid).toBe(true);
  });
});
