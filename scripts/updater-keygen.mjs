#!/usr/bin/env node
/**
 * 자동 업데이트 서명 키 만들기 (처음 한 번만)
 * ------------------------------------------------------------
 *   npm run updater:keygen
 *
 * 하는 일
 *  1) `tauri signer generate` 로 키 쌍을 만듭니다.
 *     - 개인 키: .secrets/updater.key  ← 절대 git 에 올리지 마세요 (.gitignore 에 들어 있음)
 *     - 공개 키: .secrets/updater.key.pub
 *  2) 공개 키를 src-tauri/tauri.conf.json 의 plugins.updater.pubkey 에 넣습니다.
 *  3) 업데이트 주소(endpoints)가 비어 있으면 git 원격 저장소 주소로 채웁니다.
 *  4) GitHub 저장소에 넣어야 할 비밀값을 안내합니다.
 *
 * 옵션
 *   --password <암호>     개인 키 암호 (생략하면 환경 변수 TAURI_SIGNING_PRIVATE_KEY_PASSWORD 또는 빈 암호)
 *   --endpoint <주소>     업데이트 정보(latest.json) 주소를 직접 지정
 *   --out <폴더>          키를 저장할 폴더 (기본 .secrets)
 *   --config <파일>       고칠 tauri.conf.json 경로 (기본 src-tauri/tauri.conf.json)
 *   --force               이미 키가 있어도 새로 만들기 (⚠ 이전 키로 서명된 앱은 더 이상 업데이트를 못 받습니다)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const force = process.argv.includes('--force');
const outDir = resolve(ROOT, arg('out', '.secrets'));
const configPath = resolve(ROOT, arg('config', 'src-tauri/tauri.conf.json'));
const password = arg('password', process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '');
const keyPath = join(outDir, 'updater.key');

/** git 원격 주소 → GitHub 릴리스의 latest.json 주소 */
export function endpointFromRemote(remote) {
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}/releases/latest/download/latest.json` : null;
}

function gitRemote() {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
}

function main() {
  if (existsSync(keyPath) && !force) {
    console.error(`이미 키가 있어요: ${keyPath}\n새로 만들려면 --force (⚠ 기존 사용자에게 업데이트가 안 갈 수 있어요)`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  // 1) 키 만들기 (tauri CLI)
  const args = ['tauri', 'signer', 'generate', '--ci', '-w', keyPath, '-f'];
  if (password) args.push('-p', password);
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0 || !existsSync(`${keyPath}.pub`)) {
    console.error('키를 만들지 못했어요. (npm install 을 먼저 했는지 확인하세요)');
    process.exit(1);
  }
  const pubkey = readFileSync(`${keyPath}.pub`, 'utf8').trim();

  // 2) 3) 설정 파일에 공개 키와 주소 넣기
  const conf = JSON.parse(readFileSync(configPath, 'utf8'));
  conf.plugins ??= {};
  conf.plugins.updater ??= {};
  conf.plugins.updater.pubkey = pubkey;
  const endpoint = arg('endpoint', null) ?? (conf.plugins.updater.endpoints?.[0] || endpointFromRemote(gitRemote()));
  if (endpoint) conf.plugins.updater.endpoints = [endpoint];
  writeFileSync(configPath, `${JSON.stringify(conf, null, 2)}\n`);

  // 4) 안내
  console.log(`
✅ 업데이트 서명 키를 만들었어요.

  개인 키: ${keyPath}   ← 안전한 곳에 백업! 잃어버리면 기존 사용자에게 업데이트를 보낼 수 없어요.
  공개 키: ${configPath} 의 plugins.updater.pubkey 에 넣었어요. (이건 git 에 올려도 돼요)
  업데이트 주소: ${endpoint ?? '(없음 – --endpoint 로 지정하세요)'}

다음 할 일 (GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret)
  1) TAURI_SIGNING_PRIVATE_KEY           = ${keyPath} 파일 내용 전체
  2) TAURI_SIGNING_PRIVATE_KEY_PASSWORD  = ${password ? '(정한 암호)' : '(비워 두기 – 암호 없음)'}
  3) tauri.conf.json 변경을 커밋하고, v1.0.1 같은 태그를 올리면 서명된 업데이트 파일과 latest.json 이 릴리스에 올라가요.
  4) 릴리스 초안을 "게시(Publish)" 하면 사용자 앱이 새 버전을 찾아요. (저장소가 비공개면 릴리스 파일을 받을 수 없으니 공개 저장소나 별도 서버를 쓰세요)
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
