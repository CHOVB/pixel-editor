//! Pixel Editor 데스크톱 앱 (Tauri 2)
//! ------------------------------------------------------------
//! 웹 버전과 같은 화면(dist/)을 창에 띄우고, 브라우저가 할 수 없는 일만 Rust 명령으로 제공합니다.
//!  1) Codex 연동: 브리지 없이 앱이 직접 `codex` CLI(ChatGPT 로그인)를 실행 → crates/codex_core
//!  2) 파일 열기/저장: 운영체제의 파일 대화상자 + 같은 파일에 다시 저장(Ctrl+S)
//!  3) 자동 업데이트: tauri.conf.json 에 업데이트 공개 키가 있을 때만 켜짐 (docs/RELEASE.md)
//!  4) 오류 보고: 사용자가 동의했고, 빌드할 때 보고 주소를 정한 경우에만 전송
//!
//! 화면 쪽에서는 src/ai/codex.ts, src/platform/desktop.ts 가 이 명령들을 부릅니다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use codex_core::{CodexManager, CodexStatus, Config, ImageInput, JobState, LoginResult, StartResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_dialog::DialogExt;

/* ------------------------------------------------------------------ */
/* Codex                                                                */
/* ------------------------------------------------------------------ */

type Codex = Arc<CodexManager>;

/// 오래 걸리는 일은 화면이 멈추지 않도록 별도 스레드에서 실행합니다.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn codex_status(codex: State<'_, Codex>) -> Result<CodexStatus, String> {
    let c = codex.inner().clone();
    blocking(move || c.status(true)).await
}

#[tauri::command]
async fn codex_login(codex: State<'_, Codex>) -> Result<LoginResult, String> {
    let c = codex.inner().clone();
    blocking(move || c.login()).await
}

#[tauri::command]
async fn codex_job_start(codex: State<'_, Codex>, task: String, prompt: String, images: Vec<ImageInput>) -> Result<StartResult, String> {
    let c = codex.inner().clone();
    blocking(move || c.start_job(task, prompt, images)).await?
}

#[tauri::command]
fn codex_job_get(codex: State<'_, Codex>, id: String) -> Result<JobState, String> {
    codex.get_job(&id).ok_or_else(|| "job not found".to_string())
}

#[tauri::command]
fn codex_job_cancel(codex: State<'_, Codex>, id: String) -> Result<JobState, String> {
    codex.cancel_job(&id).ok_or_else(|| "job not found".to_string())
}

/* ------------------------------------------------------------------ */
/* 파일                                                                 */
/* ------------------------------------------------------------------ */

/// 사용자가 대화상자에서 고른 파일만 쓰기를 허용합니다. (화면 쪽에서 아무 경로나 쓰지 못하게)
#[derive(Default)]
struct Granted(Mutex<HashSet<PathBuf>>);

#[derive(Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Serialize)]
struct SavedFile {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct OpenedFile {
    name: String,
    path: String,
    /// 파일 내용 (base64)
    data: String,
}

/// 읽어도 되는 파일 종류 (최근 파일 다시 열기용)
const READABLE: &[&str] = &["pxe", "json", "aseprite", "ase", "png", "gif", "jpg", "jpeg", "webp", "bmp", "hex", "gpl", "txt"];

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn read_file(path: &Path) -> Result<OpenedFile, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !READABLE.contains(&ext.as_str()) {
        return Err(format!("unsupported file type: .{ext}"));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(OpenedFile { name: file_name(path), path: path.to_string_lossy().into_owned(), data: B64.encode(bytes) })
}

#[tauri::command]
async fn desktop_save(app: tauri::AppHandle, granted: State<'_, Granted>, suggested_name: String, data: String, filters: Vec<Filter>) -> Result<Option<SavedFile>, String> {
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    let mut dialog = app.dialog().file().set_file_name(&suggested_name);
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|e| e.trim_start_matches('.')).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.save_file(move |p| {
        let _ = tx.send(p);
    });
    let picked = blocking(move || rx.recv().ok().flatten()).await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    granted.0.lock().unwrap().insert(path.clone());
    Ok(Some(SavedFile { name: file_name(&path), path: path.to_string_lossy().into_owned() }))
}

#[tauri::command]
async fn desktop_open(app: tauri::AppHandle, granted: State<'_, Granted>, filters: Vec<Filter>) -> Result<Option<OpenedFile>, String> {
    let mut dialog = app.dialog().file();
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|e| e.trim_start_matches('.')).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.pick_file(move |p| {
        let _ = tx.send(p);
    });
    let picked = blocking(move || rx.recv().ok().flatten()).await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let file = read_file(&path)?;
    granted.0.lock().unwrap().insert(path);
    Ok(Some(file))
}

/// 최근 파일 다시 열기 (정해진 종류의 파일만)
#[tauri::command]
fn desktop_read(granted: State<'_, Granted>, path: String) -> Result<OpenedFile, String> {
    let p = PathBuf::from(&path);
    let file = read_file(&p)?;
    granted.0.lock().unwrap().insert(p);
    Ok(file)
}

/// 이미 열었거나 저장한 파일에 다시 저장 (Ctrl+S)
#[tauri::command]
fn desktop_write(granted: State<'_, Granted>, path: String, data: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !granted.0.lock().unwrap().contains(&p) {
        return Err("this file was not opened or saved in this session".into());
    }
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(&p, bytes).map_err(|e| e.to_string())
}

/// 앱을 .pxe 파일 더블클릭으로 열었을 때 그 파일 경로
#[tauri::command]
fn desktop_launch_file(granted: State<'_, Granted>) -> Option<String> {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'))?;
    let p = PathBuf::from(&arg);
    if p.is_file() {
        granted.0.lock().unwrap().insert(p);
        Some(arg)
    } else {
        None
    }
}

/* ------------------------------------------------------------------ */
/* 자동 업데이트                                                         */
/* ------------------------------------------------------------------ */

/// 업데이트 기능이 켜졌는지 (공개 키 + 주소가 설정되어 플러그인이 등록된 경우)
#[derive(Default)]
struct UpdaterReady(AtomicBool);

/// 다운로드 진행 상황 (받은 바이트, 전체 바이트)
#[derive(Default)]
struct UpdateProgress(Mutex<(u64, Option<u64>)>);

#[derive(Serialize)]
struct UpdateInfo {
    /// 업데이트 기능이 설정되어 있는지
    configured: bool,
    /// 지금 버전
    current: String,
    /// 새 버전이 있는지
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}

/// tauri.conf.json 의 plugins.updater 에 공개 키와 주소가 들어 있는지
fn updater_configured(config: &tauri::Config) -> bool {
    let Some(u) = config.plugins.0.get("updater") else { return false };
    let has_key = u.get("pubkey").and_then(|k| k.as_str()).map(|k| !k.trim().is_empty()).unwrap_or(false);
    let has_url = u.get("endpoints").and_then(|e| e.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
    has_key && has_url
}

fn update_info(app: &tauri::AppHandle, ready: bool) -> UpdateInfo {
    UpdateInfo { configured: ready, current: app.package_info().version.to_string(), available: false, version: None, notes: None, date: None }
}

#[tauri::command]
fn update_status(app: tauri::AppHandle, ready: State<'_, UpdaterReady>) -> UpdateInfo {
    update_info(&app, ready.0.load(Ordering::SeqCst))
}

#[tauri::command]
async fn update_check(app: tauri::AppHandle, ready: State<'_, UpdaterReady>) -> Result<UpdateInfo, String> {
    let mut info = update_info(&app, ready.0.load(Ordering::SeqCst));
    if !info.configured {
        return Ok(info);
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    if let Some(u) = update {
        info.available = true;
        info.version = Some(u.version.clone());
        info.notes = u.body.clone();
        info.date = u.date.map(|d| d.to_string());
    }
    Ok(info)
}

/// 새 버전을 받아서 설치합니다. (Windows 는 설치 프로그램이 앱을 닫고 설치함)
/// 끝나면 화면에서 update_restart 로 다시 시작합니다.
#[tauri::command]
async fn update_install(app: tauri::AppHandle, ready: State<'_, UpdaterReady>, progress: State<'_, UpdateProgress>) -> Result<bool, String> {
    if !ready.0.load(Ordering::SeqCst) {
        return Err("updater is not configured".into());
    }
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    *progress.0.lock().unwrap() = (0, None);
    let handle = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                let p = handle.state::<UpdateProgress>();
                let mut g = p.0.lock().unwrap();
                g.0 += chunk as u64;
                g.1 = total;
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn update_progress(progress: State<'_, UpdateProgress>) -> (u64, Option<u64>) {
    *progress.0.lock().unwrap()
}

#[tauri::command]
fn update_restart(app: tauri::AppHandle) {
    app.restart();
}

/* ------------------------------------------------------------------ */
/* 오류 보고 (선택)                                                       */
/* ------------------------------------------------------------------ */

/// 빌드할 때 `PIXEL_EDITOR_ERROR_REPORT_URL` 환경 변수로 정합니다. 화면 쪽에서 주소를 바꿀 수 없습니다.
const ERROR_REPORT_URL: Option<&str> = option_env!("PIXEL_EDITOR_ERROR_REPORT_URL");
const ERROR_REPORT_MAX_BYTES: usize = 32 * 1024;

fn error_report_url() -> Option<&'static str> {
    let url = ERROR_REPORT_URL?.trim();
    let ok = url.starts_with("https://") || url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
    ok.then_some(url)
}

#[tauri::command]
fn error_report_available() -> bool {
    error_report_url().is_some()
}

#[tauri::command]
async fn error_report_send(report: serde_json::Value) -> Result<(), String> {
    let url = error_report_url().ok_or("error reporting is not configured")?;
    let body = report.to_string();
    if body.len() > ERROR_REPORT_MAX_BYTES {
        return Err("report too large".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let res = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("server answered {}", res.status()))
    }
}

fn main() {
    let codex: Codex = Arc::new(CodexManager::new(Config::from_env()));
    let for_exit = codex.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(codex)
        .manage(Granted::default())
        .manage(UpdaterReady::default())
        .manage(UpdateProgress::default())
        .invoke_handler(tauri::generate_handler![
            codex_status,
            codex_login,
            codex_job_start,
            codex_job_get,
            codex_job_cancel,
            desktop_save,
            desktop_open,
            desktop_read,
            desktop_write,
            desktop_launch_file,
            update_status,
            update_check,
            update_install,
            update_progress,
            update_restart,
            error_report_available,
            error_report_send
        ])
        .setup(|app| {
            // 자동 업데이트: 공개 키와 주소가 설정된 경우에만 켭니다. (실패해도 앱은 그대로 실행)
            if updater_configured(app.config()) {
                match app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                    Ok(()) => app.state::<UpdaterReady>().0.store(true, Ordering::SeqCst),
                    Err(e) => eprintln!("updater disabled: {e}"),
                }
            }
            // 개발 중에는 창 제목에 표시
            if cfg!(debug_assertions) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_title("Pixel Editor (dev)");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pixel Editor")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                for_exit.shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(updater: serde_json::Value) -> tauri::Config {
        let mut c: tauri::Config = serde_json::from_value(serde_json::json!({ "identifier": "com.example.test" })).unwrap();
        c.plugins.0.insert("updater".into(), updater);
        c
    }

    #[test]
    fn updater_needs_key_and_endpoint() {
        let empty: tauri::Config = serde_json::from_value(serde_json::json!({ "identifier": "com.example.test" })).unwrap();
        assert!(!updater_configured(&empty));
        assert!(!updater_configured(&config_with(serde_json::json!({ "pubkey": "", "endpoints": ["https://x/latest.json"] }))));
        assert!(!updater_configured(&config_with(serde_json::json!({ "pubkey": "abc", "endpoints": [] }))));
        assert!(updater_configured(&config_with(serde_json::json!({ "pubkey": "abc", "endpoints": ["https://x/latest.json"] }))));
    }

    /// 업데이트 전체 흐름 시험: 새 버전 찾기 → 파일 받기 → 서명 확인.
    /// 실제 키와 시험용 서버가 필요해서 기본으로는 건너뜁니다. 실행 방법은 docs/RELEASE.md 참고:
    ///   UPDATER_TEST_PUBKEY=... UPDATER_TEST_ENDPOINT=http://127.0.0.1:8787/latest.json cargo test -- --ignored
    #[test]
    #[ignore = "needs UPDATER_TEST_PUBKEY and UPDATER_TEST_ENDPOINT"]
    fn updater_finds_and_verifies_a_signed_update() {
        let pubkey = std::env::var("UPDATER_TEST_PUBKEY").expect("UPDATER_TEST_PUBKEY");
        let endpoint: tauri::Url = std::env::var("UPDATER_TEST_ENDPOINT").expect("UPDATER_TEST_ENDPOINT").parse().unwrap();
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().plugins.0.insert("updater".into(), serde_json::json!({ "pubkey": pubkey, "endpoints": [endpoint] }));
        assert!(updater_configured(ctx.config()));
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(ctx).unwrap();
        tauri::async_runtime::block_on(async {
            let update = app.handle().updater().unwrap().check().await.unwrap().expect("a newer version on the test server");
            assert_eq!(update.version, "9.9.9");
            let bytes = update.download(|_, _| {}, || {}).await.expect("signature must verify");
            assert!(!bytes.is_empty());
        });
    }

    #[test]
    fn shipped_config_is_valid_json_with_updater_section() {
        let raw = include_str!("../tauri.conf.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        assert!(v["plugins"]["updater"]["endpoints"].is_array());
    }
}
