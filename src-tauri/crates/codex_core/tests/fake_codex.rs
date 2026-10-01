//! 가짜 codex 프로그램(셸 스크립트)으로 연동 흐름을 시험합니다. (macOS/Linux 전용)
//!  - --version / login status 출력 해석
//!  - 로그인 안 됐으면 작업 시작을 거절
//!  - exec: 표준 입력으로 지시문을 받고, 작업 폴더에 result.png 를 만들면 결과로 돌려줌
//!  - 취소
#![cfg(unix)]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use codex_core::{CodexManager, Config, ImageInput};
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

const PNG_1PX: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/// 상황(logged_in, slow)에 따라 동작하는 가짜 codex 스크립트 만들기
fn fake_codex(tag: &str, logged_in: bool, slow: bool) -> (PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("codex-core-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let script = root.join("codex");
    let login = if logged_in { "echo 'Logged in using ChatGPT'; exit 0" } else { "echo 'Not logged in'; exit 1" };
    let sleep = if slow { "sleep 30" } else { "" };
    let body = format!(
        r#"#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then {login}; fi
if [ "$1" = "login" ]; then exit 0; fi
if [ "$1" = "exec" ]; then
  dir=""; img=""; prev=""
  for a in "$@"; do
    if [ "$prev" = "-C" ]; then dir="$a"; fi
    if [ "$prev" = "--image" ]; then img="$a"; fi
    prev="$a"
  done
  cat > "$dir/prompt.txt"
  echo "working on it"
  {sleep}
  cp "$img" "$dir/result.png"
  echo "done" > "$dir/last-message.txt"
  exit 0
fi
exit 2
"#
    );
    std::fs::write(&script, body).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    (root, script)
}

fn manager(root: &PathBuf, script: &PathBuf) -> Arc<CodexManager> {
    Arc::new(CodexManager::new(Config {
        codex_bin: script.to_string_lossy().into_owned(),
        codex_home: root.join("home"),
        work_root: root.join("work"),
        job_timeout: Duration::from_secs(60),
        network_stall: Duration::from_secs(60),
    }))
}

fn wait_done(m: &CodexManager, id: &str) -> codex_core::JobState {
    let start = Instant::now();
    loop {
        let s = m.get_job(id).expect("job exists");
        if s.status != "running" || start.elapsed() > Duration::from_secs(20) {
            return s;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn status_reports_chatgpt_login() {
    let (root, script) = fake_codex("status", true, false);
    let st = manager(&root, &script).status(true);
    assert!(st.connected && st.codex_installed && st.logged_in);
    assert_eq!(st.auth_mode, "chatgpt");
    assert_eq!(st.codex_version.as_deref(), Some("codex-cli 9.9.9"));
    // 화면 쪽(TypeScript)이 기대하는 이름(camelCase)으로 나가는지
    let json = serde_json::to_string(&st).unwrap();
    assert!(json.contains("\"codexInstalled\":true") && json.contains("\"loggedIn\":true") && json.contains("\"authMode\":\"chatgpt\""));
}

#[test]
fn missing_codex_is_reported() {
    let m = CodexManager::new(Config {
        codex_bin: "/definitely/not/here/codex".into(),
        codex_home: std::env::temp_dir(),
        work_root: std::env::temp_dir().join("codex-core-missing"),
        job_timeout: Duration::from_secs(5),
        network_stall: Duration::from_secs(5),
    });
    let st = m.status(true);
    assert!(!st.codex_installed && !st.logged_in);
}

#[test]
fn refuses_jobs_when_not_logged_in() {
    let (root, script) = fake_codex("nologin", false, false);
    let m = manager(&root, &script);
    let err = m.start_job("generate".into(), "draw".into(), vec![]).unwrap_err();
    assert!(err.contains("codex login"), "{err}");
}

#[test]
fn runs_a_job_and_returns_the_image() {
    let (root, script) = fake_codex("job", true, false);
    let m = manager(&root, &script);
    let id = m
        .start_job("inpaint".into(), "fill the hole".into(), vec![ImageInput { name: "body sprite.png".into(), data: PNG_1PX.into() }])
        .unwrap()
        .id;
    let s = wait_done(&m, &id);
    assert_eq!(s.status, "done", "log: {} / error: {:?}", s.log, s.error);
    assert_eq!(B64.decode(s.result.unwrap()).unwrap(), B64.decode(PNG_1PX).unwrap());
    assert!(s.log.contains("working on it"));
    // 지시문은 표준 입력으로 전달되고, 파일 이름은 안전하게 바뀜
    let dir = root.join("work").join(&id);
    assert_eq!(std::fs::read_to_string(dir.join("prompt.txt")).unwrap(), "fill the hole");
    assert!(dir.join("body_sprite.png").is_file());
}

#[test]
fn cancels_a_running_job() {
    let (root, script) = fake_codex("cancel", true, true);
    let m = manager(&root, &script);
    let id = m.start_job("generate".into(), "slow".into(), vec![ImageInput { name: "a.png".into(), data: PNG_1PX.into() }]).unwrap().id;
    std::thread::sleep(Duration::from_millis(400));
    let s = m.cancel_job(&id).unwrap();
    assert_eq!(s.status, "cancelled");
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(m.get_job(&id).unwrap().status, "cancelled");
}
