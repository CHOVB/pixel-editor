#!/usr/bin/env node
/**
 * 라이선스 키 도구 (판매자 전용)
 * ------------------------------------------------------------
 * 1) 키 쌍 만들기 (처음 한 번):
 *      node scripts/license-tool.mjs keygen ./license-private.json
 *    → 개인 키 파일이 만들어지고, 공개 키가 화면에 나옵니다.
 *      공개 키를 src/licensing/publicKey.ts 에 붙여 넣고 다시 빌드하세요.
 *    ⚠ 개인 키 파일은 절대 저장소(git)에 올리거나 남에게 주지 마세요!
 *
 * 2) 키 발급:
 *      node scripts/license-tool.mjs issue ./license-private.json "홍길동" hong@example.com pro [만료일 YYYY-MM-DD] [주문번호]
 *
 * 3) 키 확인:
 *      node scripts/license-tool.mjs verify ./license-private.json <키>
 */
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const PREFIX = 'PXE1';

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

async function keygen(file) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  writeFileSync(file, JSON.stringify({ privateKey: priv, publicKey: pub }, null, 2), { mode: 0o600 });
  console.log(`개인 키 저장: ${file}  (안전한 곳에 보관하세요)`);
  console.log('\nsrc/licensing/publicKey.ts 에 붙여 넣을 공개 키:\n');
  console.log(`export const LICENSE_PUBLIC_KEY = '${pub}';\n`);
}

async function loadPrivate(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const key = await crypto.subtle.importKey('jwk', data.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { key, publicKey: data.publicKey };
}

async function issue(file, name, email, plan = 'pro', expires, orderId) {
  if (!name || !email) throw new Error('이름과 이메일이 필요합니다.');
  const { key } = await loadPrivate(file);
  const payload = { n: name, e: email, p: plan, i: new Date().toISOString().slice(0, 10) };
  if (expires) payload.x = expires;
  if (orderId) payload.id = orderId;
  const body = `${PREFIX}.${b64url(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(body)));
  console.log(`${body}.${b64url(sig)}`);
}

async function verify(file, licenseKey) {
  const { publicKey } = await loadPrivate(file);
  const [prefix, body, sig] = licenseKey.trim().split('.');
  const pub = await crypto.subtle.importKey('spki', fromB64url(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(sig), new TextEncoder().encode(`${prefix}.${body}`));
  console.log(ok ? '✅ 올바른 키' : '❌ 잘못된 키');
  if (ok) console.log(JSON.parse(Buffer.from(fromB64url(body)).toString('utf8')));
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'keygen') await keygen(args[0] ?? './license-private.json');
  else if (cmd === 'issue') await issue(...args);
  else if (cmd === 'verify') await verify(args[0], args[1]);
  else {
    console.log('사용법: node scripts/license-tool.mjs keygen|issue|verify ...  (파일 맨 위 설명 참고)');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
