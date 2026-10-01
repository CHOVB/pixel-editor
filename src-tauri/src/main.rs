//! Pixel Editor 데스크톱 앱 (Tauri 2)
//! ------------------------------------------------------------
//! 웹 버전과 같은 화면(dist/)을 창에 띄우고, 브라우저가 할 수 없는 일만 Rust 명령으로 제공합니다.
//!  1) Codex 연동: 브리지 없이 앱이 직접 `codex` CLI(ChatGPT 로그인)를 실행 → crates/codex_core
//!  2) 파일 열기/저장: 운영체제의 파일 대화상자 + 같은 파일에 다시 저장(Ctrl+S)
//!
//! 화면 쪽에서는 src/ai/codex.ts, src/platform/desktop.ts 가 이 명령들을 부릅니다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use codex_core::{CodexManager, CodexStatus, Config, ImageInput, JobState, LoginResult, StartResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
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

fn main() {
    let codex: Codex = Arc::new(CodexManager::new(Config::from_env()));
    let for_exit = codex.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(codex)
        .manage(Granted::default())
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
            desktop_launch_file
        ])
        .setup(|app| {
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
