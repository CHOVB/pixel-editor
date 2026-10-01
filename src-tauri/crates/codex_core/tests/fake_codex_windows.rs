//! 가짜 codex 로 연동 흐름을 시험합니다. (Windows 전용 – fake_codex.rs 의 Windows 판)
//!  - npm 이 설치하는 것과 같은 모양: `codex.cmd` → `node 가짜스크립트.mjs %*`
//!    그래서 앱이 실제로 거치는 `cmd /C codex.cmd ...` → node 경로를 그대로 지나갑니다.
//!  - 사용자 폴더에 띄어쓰기·한글이 있어도 인자가 그대로 전달되는지
//!  - 취소/시간 초과 때 codex 프로세스가 정말 멈추는지 (cmd 만 죽고 node 가 남으면 안 됨)
#![cfg(windows)]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use codex_core::{CodexManager, Config, ImageInput};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

const PNG_1PX: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/// 가짜 codex (node 스크립트 + npm 식 .cmd 껍데기). bin_dir 에 만들고 codex.cmd 경로를 돌려줌.
/// exec 는 작업 폴더에 pid.txt / args.json / prompt.txt 를 남기고, slow 면 4초 뒤에 result.png 를 씀.
fn fake_codex(bin_dir: &Path, logged_in: bool, slow: bool) -> PathBuf {
    std::fs::create_dir_all(bin_dir).unwrap();
    let login = if logged_in { "console.log('Logged in using ChatGPT'); process.exit(0);" } else { "console.log('Not logged in'); process.exit(1);" };
    let delay = if slow { 4000 } else { 0 };
    let js = format!(
        r#"import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
if (a[0] === '--version') {{ console.log('codex-cli 9.9.9'); process.exit(0); }}
if (a[0] === 'login' && a[1] === 'status') {{ {login} }}
if (a[0] === 'login') process.exit(0);
if (a[0] === 'exec') {{
  const dir = a[a.indexOf('-C') + 1];
  const imgs = a.includes('--image') ? a.slice(a.indexOf('--image') + 1) : [];
  fs.writeFileSync(path.join(dir, 'pid.txt'), String(process.pid));
  fs.writeFileSync(path.join(dir, 'args.json'), JSON.stringify(a));
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  fs.writeFileSync(path.join(dir, 'prompt.txt'), Buffer.concat(chunks));
  console.log('working on it');
  await new Promise((r) => setTimeout(r, {delay}));
  if (imgs[0]) fs.copyFileSync(imgs[0], path.join(dir, 'result.png'));
  fs.writeFileSync(path.join(dir, 'last-message.txt'), 'done');
  process.exit(0);
}}
process.exit(2);
"#
    );
    std::fs::write(bin_dir.join("fake-codex.mjs"), js).unwrap();
    let cmd = bin_dir.join("codex.cmd");
    std::fs::write(&cmd, "@echo off\r\nnode \"%~dp0fake-codex.mjs\" %*\r\n").unwrap();
    cmd
}

fn test_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("codex-core-wintest-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn manager(bin: &Path, work_root: PathBuf, job_timeout: Duration) -> Arc<CodexManager> {
    Arc::new(CodexManager::new(Config {
        codex_bin: bin.to_string_lossy().into_owned(),
        codex_home: work_root.join("home"),
        work_root,
        job_timeout,
        network_stall: Duration::from_secs(60),
    }))
}

fn wait_done(m: &CodexManager, id: &str) -> codex_core::JobState {
    let start = Instant::now();
    loop {
        let s = m.get_job(id).expect("job exists");
        if s.status != "running" || start.elapsed() > Duration::from_secs(30) {
            return s;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn wait_for_file(p: &Path, max: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < max {
        if p.is_file() && std::fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

fn process_alive(pid: u32) -> bool {
    let out = Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\""))
}

fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
}

#[test]
fn status_reports_chatgpt_login() {
    let root = test_root("status");
    let bin = fake_codex(&root.join("bin"), true, false);
    let st = manager(&bin, root.join("work"), Duration::from_secs(60)).status(true);
    assert!(st.connected && st.codex_installed && st.logged_in, "{st:?}");
    assert_eq!(st.auth_mode, "chatgpt");
    assert_eq!(st.codex_version.as_deref(), Some("codex-cli 9.9.9"));
}

#[test]
fn missing_codex_is_reported() {
    let root = test_root("missing");
    let m = manager(&root.join("nope").join("codex.cmd"), root.join("work"), Duration::from_secs(5));
    let st = m.status(true);
    assert!(!st.codex_installed && !st.logged_in, "{st:?}");
}

#[test]
fn refuses_jobs_when_not_logged_in() {
    let root = test_root("nologin");
    let bin = fake_codex(&root.join("bin"), false, false);
    let err = manager(&bin, root.join("work"), Duration::from_secs(60)).start_job("generate".into(), "draw".into(), vec![]).unwrap_err();
    assert!(err.contains("codex login"), "{err}");
}

/// 사용자 이름에 띄어쓰기·한글이 있는 흔한 Windows 환경 (작업 폴더 = %TEMP% 아래)
#[test]
fn runs_a_job_in_a_folder_with_spaces_and_korean() {
    let root = test_root("job");
    let bin = fake_codex(&root.join("bin"), true, false);
    let work = root.join("홍 길동").join("pixel-editor-codex");
    let m = manager(&bin, work.clone(), Duration::from_secs(60));
    let id = m
        .start_job("inpaint".into(), "fill the hole\n구멍 채우기 \"따옴표\" & | < > ^ %PATH%".into(), vec![ImageInput { name: "body sprite.png".into(), data: PNG_1PX.into() }])
        .unwrap()
        .id;
    let s = wait_done(&m, &id);
    let dir = work.join(&id);
    let args = std::fs::read_to_string(dir.join("args.json")).unwrap_or_default();
    assert_eq!(s.status, "done", "log: {} / error: {:?} / args: {args}", s.log, s.error);
    assert_eq!(B64.decode(s.result.unwrap()).unwrap(), B64.decode(PNG_1PX).unwrap());
    assert!(s.log.contains("working on it"));
    // 지시문은 표준 입력으로 그대로, 인자는 cmd 를 거쳐도 그대로 도착해야 함
    assert_eq!(std::fs::read_to_string(dir.join("prompt.txt")).unwrap(), "fill the hole\n구멍 채우기 \"따옴표\" & | < > ^ %PATH%");
    let args: Vec<String> = serde_json::from_str(&args).unwrap();
    assert!(args.contains(&"approval_policy=\"never\"".to_string()), "{args:?}");
    assert!(args.contains(&dir.to_string_lossy().into_owned()), "{args:?}");
    assert!(args.contains(&dir.join("body_sprite.png").to_string_lossy().into_owned()), "{args:?}");
}

/// CODEX_BIN 을 띄어쓰기 있는 경로로 지정한 경우
#[test]
fn runs_a_job_when_codex_bin_path_has_spaces() {
    let root = test_root("binspace");
    let bin = fake_codex(&root.join("Program Files").join("codex cli"), true, false);
    let work = root.join("my work");
    let m = manager(&bin, work.clone(), Duration::from_secs(60));
    assert!(m.status(true).logged_in, "status with spaced bin path: {:?}", m.status(true));
    let id = m.start_job("generate".into(), "draw".into(), vec![ImageInput { name: "a.png".into(), data: PNG_1PX.into() }]).unwrap().id;
    let s = wait_done(&m, &id);
    assert_eq!(s.status, "done", "log: {} / error: {:?}", s.log, s.error);
}

/// 취소하면 codex(node) 프로세스까지 멈춰야 함 – cmd.exe 만 죽으면 결과가 계속 만들어지고 ChatGPT 사용량도 계속 씀
#[test]
fn cancel_stops_the_codex_process_itself() {
    let root = test_root("cancel");
    let bin = fake_codex(&root.join("bin"), true, true);
    let work = root.join("work");
    let m = manager(&bin, work.clone(), Duration::from_secs(60));
    let id = m.start_job("generate".into(), "slow".into(), vec![ImageInput { name: "a.png".into(), data: PNG_1PX.into() }]).unwrap().id;
    let dir = work.join(&id);
    assert!(wait_for_file(&dir.join("pid.txt"), Duration::from_secs(10)), "fake codex never started");
    let pid: u32 = std::fs::read_to_string(dir.join("pid.txt")).unwrap().trim().parse().unwrap();

    assert_eq!(m.cancel_job(&id).unwrap().status, "cancelled");
    std::thread::sleep(Duration::from_millis(1000));
    let alive = process_alive(pid);
    std::thread::sleep(Duration::from_millis(4500));
    let result_written = dir.join("result.png").is_file();
    kill_tree(pid);

    assert_eq!(m.get_job(&id).unwrap().status, "cancelled");
    assert!(!alive && !result_written, "codex (node pid {pid}) kept running after cancel: alive 1s later = {alive}, wrote result.png = {result_written}");
}

/// 시간 초과도 같은 방식으로 멈춰야 함
#[test]
fn timeout_stops_the_codex_process_itself() {
    let root = test_root("timeout");
    let bin = fake_codex(&root.join("bin"), true, true);
    let work = root.join("work");
    let m = manager(&bin, work.clone(), Duration::from_secs(2));
    let id = m.start_job("generate".into(), "slow".into(), vec![ImageInput { name: "a.png".into(), data: PNG_1PX.into() }]).unwrap().id;
    let dir = work.join(&id);
    assert!(wait_for_file(&dir.join("pid.txt"), Duration::from_secs(10)), "fake codex never started");
    let pid: u32 = std::fs::read_to_string(dir.join("pid.txt")).unwrap().trim().parse().unwrap();

    let s = wait_done(&m, &id);
    std::thread::sleep(Duration::from_millis(500));
    let alive = process_alive(pid);
    std::thread::sleep(Duration::from_millis(3000));
    let result_written = dir.join("result.png").is_file();
    kill_tree(pid);

    assert_eq!(s.status, "error", "{:?}", s.error);
    assert!(!alive && !result_written, "codex (node pid {pid}) kept running after timeout: alive = {alive}, wrote result.png = {result_written}");
}
