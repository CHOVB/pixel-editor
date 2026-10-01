/**
 * 라이선스 키 확인 (상용 판매용)
 * ------------------------------------------------------------
 * 키 모양:  PXE1.<내용(base64url)>.<서명(base64url)>
 *  - 내용: {"n":"이름","e":"이메일","p":"pro","i":"2026-10-01","x":"만료일(선택)","id":"주문번호"}
 *  - 서명: 판매자만 가진 "개인 키"(ECDSA P-256)로 "PXE1.<내용>" 을 서명한 값
 *
 * 프로그램 안에는 "공개 키"만 들어 있어서, 인터넷 없이도 키가 진짜인지 확인할 수 있고
 * 공개 키로는 새 키를 만들 수 없습니다. (키 발급: scripts/license-tool.mjs)
 *
 * ※ 이 모듈은 기능을 막지 않습니다. 정품 표시/평가판 안내에만 사용합니다.
 */
import { LICENSE_PUBLIC_KEY } from './publicKey';

export const LICENSE_PREFIX = 'PXE1';
const STORAGE_KEY = 'pixel-editor:license';

export type LicensePlan = 'personal' | 'pro' | 'team';

export interface LicenseInfo {
  name: string;
  email: string;
  plan: LicensePlan;
  issued: string;
  expires?: string;
  orderId?: string;
}

export type LicenseCheck =
  | { valid: true; info: LicenseInfo }
  | { valid: false; reason: 'format' | 'signature' | 'expired' | 'unsupported' };

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64urlToBytes(spkiBase64) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

/**
 * 키 확인. publicKey 를 주면 그 공개 키로 확인합니다. (테스트용)
 * now 를 주면 그 날짜 기준으로 만료를 확인합니다.
 */
export async function verifyLicenseKey(key: string, publicKey = LICENSE_PUBLIC_KEY, now = new Date()): Promise<LicenseCheck> {
  const parts = key.trim().replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return { valid: false, reason: 'format' };
  if (typeof crypto === 'undefined' || !crypto.subtle) return { valid: false, reason: 'unsupported' };
  let payload: { n?: string; e?: string; p?: string; i?: string; x?: string; id?: string };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[1])));
  } catch {
    return { valid: false, reason: 'format' };
  }
  try {
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importPublicKey(publicKey),
      base64urlToBytes(parts[2]) as BufferSource,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return { valid: false, reason: 'signature' };
  } catch {
    return { valid: false, reason: 'signature' };
  }
  if (payload.x && new Date(`${payload.x}T23:59:59Z`) < now) return { valid: false, reason: 'expired' };
  const plan: LicensePlan = payload.p === 'team' || payload.p === 'personal' ? payload.p : 'pro';
  return {
    valid: true,
    info: { name: payload.n ?? '', email: payload.e ?? '', plan, issued: payload.i ?? '', expires: payload.x, orderId: payload.id },
  };
}

export function loadStoredKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key.trim());
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장할 수 없으면 이번 실행 동안만 유지됩니다.
  }
}

/** 저장된 키를 확인해서 정품 정보 반환 (없거나 잘못되면 null) */
export async function currentLicense(): Promise<LicenseInfo | null> {
  const key = loadStoredKey();
  if (!key) return null;
  const r = await verifyLicenseKey(key);
  return r.valid ? r.info : null;
}
