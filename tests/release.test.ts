/**
 * 출시 설정(서명 · 자동 업데이트) 만들기 테스트
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error – 스크립트 파일 (.mjs)
import { releaseConfig } from '../scripts/release/tauri-release-config.mjs';

describe('release config', () => {
  it('adds nothing secret-dependent when no secrets are configured', () => {
    const { config, notes } = releaseConfig({});
    expect(config).toEqual({});
    expect(notes.join('\n')).toContain('windows signing: off');
  });

  it('turns on updater artifacts, pubkey and endpoint', () => {
    const { config } = releaseConfig({ HAS_UPDATER_KEY: 'true', TAURI_UPDATER_PUBKEY: 'PUB', TAURI_UPDATER_ENDPOINT: 'https://x.dev/latest.json' });
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins.updater).toEqual({ pubkey: 'PUB', endpoints: ['https://x.dev/latest.json'] });
  });

  it('refuses a non-https update address', () => {
    expect(() => releaseConfig({ TAURI_UPDATER_ENDPOINT: 'http://x.dev/latest.json' })).toThrow(/https/);
  });

  it('uses a PFX thumbprint first, otherwise Azure Trusted Signing', () => {
    const pfx = releaseConfig({ WINDOWS_CERTIFICATE_THUMBPRINT: 'AB12', AZURE_SIGNING_ENDPOINT: 'e', AZURE_SIGNING_ACCOUNT: 'a', AZURE_SIGNING_PROFILE: 'p' }).config;
    expect(pfx.bundle.windows).toEqual({ certificateThumbprint: 'AB12', digestAlgorithm: 'sha256', timestampUrl: 'http://timestamp.digicert.com' });
    const azure = releaseConfig({ AZURE_SIGNING_ENDPOINT: 'https://wus2.codesigning.azure.net', AZURE_SIGNING_ACCOUNT: 'acct', AZURE_SIGNING_PROFILE: 'prof' }).config;
    expect(azure.bundle.windows.signCommand).toBe('trusted-signing-cli -e https://wus2.codesigning.azure.net -a acct -c prof -d "Pixel Editor" %1');
  });

  it('never writes private values into the config', () => {
    const { config } = releaseConfig({ HAS_UPDATER_KEY: 'true', TAURI_SIGNING_PRIVATE_KEY: 'SECRET', WINDOWS_CERTIFICATE_PASSWORD: 'PW' });
    expect(JSON.stringify(config)).not.toMatch(/SECRET|PW/);
  });
});
