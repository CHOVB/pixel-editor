#!/usr/bin/env node
/**
 * 출시용 Tauri 설정 덧붙이기 (GitHub Actions 에서 사용)
 * ------------------------------------------------------------
 *   node scripts/release/tauri-release-config.mjs release-config.json
 *   → tauri build --config release-config.json
 *
 * 저장소에 넣어 둔 비밀값/변수가 있을 때만 해당 기능을 켭니다. 없으면 그냥 건너뜁니다.
 * (그래서 인증서가 아직 없어도 출시 작업은 실패하지 않고, 서명 없는 설치 파일이 만들어집니다)
 *
 *  환경 변수                         켜지는 것
 *  ───────────────────────────────  ─────────────────────────────────────────────
 *  HAS_UPDATER_KEY=true              업데이트 파일(.sig, latest.json) 만들기
 *  TAURI_UPDATER_PUBKEY              앱에 넣을 업데이트 공개 키 (tauri.conf.json 보다 우선)
 *  TAURI_UPDATER_ENDPOINT            업데이트 정보 주소 (latest.json)
 *  WINDOWS_CERTIFICATE_THUMBPRINT    Windows 서명 (PFX 인증서를 가져온 뒤 지문)
 *  WINDOWS_TIMESTAMP_URL             서명 시간 도장 서버 (기본 DigiCert)
 *  AZURE_SIGNING_ENDPOINT/ACCOUNT/PROFILE   Windows 서명 (Azure Trusted Signing)
 *
 * 비밀값 자체(개인 키, 인증서 암호)는 이 파일에 쓰지 않습니다. 결과 파일에는 공개 정보만 들어갑니다.
 */
import { writeFileSync } from 'node:fs';

/** 환경 변수 → 덧붙일 설정과 사람이 읽을 요약 */
export function releaseConfig(env) {
  const config = {};
  const notes = [];
  const set = (path, value) => {
    let o = config;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path[path.length - 1]] = value;
  };
  const v = (name) => (env[name] ?? '').trim();

  // 자동 업데이트
  if (v('HAS_UPDATER_KEY') === 'true') {
    set(['bundle', 'createUpdaterArtifacts'], true);
    notes.push('updater artifacts: on');
  } else notes.push('updater artifacts: off (no TAURI_SIGNING_PRIVATE_KEY secret)');
  if (v('TAURI_UPDATER_PUBKEY')) {
    set(['plugins', 'updater', 'pubkey'], v('TAURI_UPDATER_PUBKEY'));
    notes.push('updater pubkey: from repository variable');
  }
  if (v('TAURI_UPDATER_ENDPOINT')) {
    if (!/^https:\/\//.test(v('TAURI_UPDATER_ENDPOINT'))) throw new Error('TAURI_UPDATER_ENDPOINT must start with https://');
    set(['plugins', 'updater', 'endpoints'], [v('TAURI_UPDATER_ENDPOINT')]);
    notes.push(`updater endpoint: ${v('TAURI_UPDATER_ENDPOINT')}`);
  }

  // Windows 코드 서명 (둘 중 하나)
  if (v('WINDOWS_CERTIFICATE_THUMBPRINT')) {
    set(['bundle', 'windows', 'certificateThumbprint'], v('WINDOWS_CERTIFICATE_THUMBPRINT'));
    set(['bundle', 'windows', 'digestAlgorithm'], 'sha256');
    set(['bundle', 'windows', 'timestampUrl'], v('WINDOWS_TIMESTAMP_URL') || 'http://timestamp.digicert.com');
    notes.push('windows signing: PFX certificate');
  } else if (v('AZURE_SIGNING_ENDPOINT') && v('AZURE_SIGNING_ACCOUNT') && v('AZURE_SIGNING_PROFILE')) {
    const cmd = `trusted-signing-cli -e ${v('AZURE_SIGNING_ENDPOINT')} -a ${v('AZURE_SIGNING_ACCOUNT')} -c ${v('AZURE_SIGNING_PROFILE')} -d "Pixel Editor" %1`;
    set(['bundle', 'windows', 'signCommand'], cmd);
    notes.push('windows signing: Azure Trusted Signing');
  } else notes.push('windows signing: off (no certificate configured)');

  return { config, notes };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? 'release-config.json';
  const { config, notes } = releaseConfig(process.env);
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${out}`);
  for (const n of notes) console.log(`  - ${n}`);
}
