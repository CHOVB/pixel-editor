//! Codex CLI 연동 (데스크톱 앱용)
//! ------------------------------------------------------------
//! 웹 버전의 `bridge/codex-bridge.mjs` 와 같은 일을 앱 안에서 직접 합니다.
//!  - API 키를 쓰지 않습니다. 사용자가 `codex login` 으로 ChatGPT 계정에 로그인한 Codex CLI 를 실행합니다.
//!  - 작업마다 임시 폴더를 만들고, 그 안에서만 Codex 가 파일을 쓰도록 합니다 (`--sandbox workspace-write -C <폴더>`).
//!  - 결과 이미지는 base64 로 화면(웹뷰)에 돌려줍니다.
//!
//! 이 크레이트는 Tauri 에 의존하지 않아서 따로 테스트할 수 있습니다.
//!   cd src-tauri/crates/codex_core && cargo test

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const VERSION: &str = "1.0.0";
const LOG_LIMIT: usize = 6000;
const STATUS_CACHE: Duration = Duration::from_secs(30);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    pub connected: bool,
    pub bridge_version: String,
    pub codex_installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_version: Option<String>,
    pub logged_in: bool,
    pub auth_mode: String,
    pub message: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ImageInput {
    pub name: String,
    /// PNG 파일 내용 (base64)
    pub data: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct JobState {
    pub id: String,
    pub status: String,
    pub log: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct StartResult {
    pub id: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct LoginResult {
    pub started: bool,
    pub message: String,
}

struct Job {
    state: JobState,
    child: Option<Child>,
    net_wait_since: Option<Instant>,
}

pub struct Config {
    /// codex 실행 파일 (기본 "codex", 환경 변수 CODEX_BIN 으로 바꿀 수 있음)
    pub codex_bin: String,
    /// Codex 설정 폴더 (기본 ~/.codex)
    pub codex_home: PathBuf,
    /// 작업 임시 폴더들의 위치
    pub work_root: PathBuf,
    pub job_timeout: Duration,
    pub network_stall: Duration,
}

impl Config {
    pub fn from_env() -> Self {
        let home = home_dir();
        Config {
            codex_bin: std::env::var("CODEX_BIN").unwrap_or_else(|_| "codex".into()),
            codex_home: std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".codex")),
            work_root: std::env::temp_dir().join("pixel-editor-codex"),
            job_timeout: Duration::from_secs(15 * 60),
            network_stall: Duration::from_secs(90),
        }
    }
}

pub struct CodexManager {
    config: Config,
    jobs: Mutex<HashMap<String, Arc<Mutex<Job>>>>,
    counter: AtomicU64,
    status_cache: Mutex<Option<(Instant, CodexStatus)>>,
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 데스크톱 앱은 터미널의 PATH 를 물려받지 못할 때가 많아서 (특히 macOS),
/// npm/Homebrew 가 프로그램을 설치하는 흔한 위치를 PATH 에 더해 줍니다.
pub fn augmented_path() -> OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let home = home_dir();
    let mut extra = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        home.join(".npm-global/bin"),
        home.join(".local/bin"),
        home.join(".volta/bin"),
        home.join("AppData/Roaming/npm"),
    ];
    // nvm 으로 설치한 Node 들
    if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        for e in entries.flatten() {
            extra.push(e.path().join("bin"));
        }
    }
    for d in extra {
        if d.is_dir() && !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// Windows 에서는 npm 이 설치한 `codex.cmd` 를 실행하려면 cmd 를 거쳐야 합니다.
fn codex_command(bin: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.args(["/C", bin]);
        c.creation_flags(0x0800_0000); // 검은 콘솔 창을 띄우지 않음
        c.env("PATH", augmented_path());
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(bin);
        c.env("PATH", augmented_path());
        c
    }
}

/// 명령 실행 후 (종료 코드, 표준 출력 + 오류 출력). 시간 초과면 강제 종료.
fn run_capture(bin: &str, args: &[&str], timeout: Duration) -> (i32, String) {
    let child = codex_command(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return (-1, e.to_string()),
    };
    // 출력이 많아도 막히지 않도록 표준 출력/오류를 따로 읽습니다.
    fn read_in_thread<R: std::io::Read + Send + 'static>(stream: Option<R>) -> thread::JoinHandle<String> {
        thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut s) = stream {
                let _ = s.read_to_string(&mut text);
            }
            text
        })
    }
    let t_out = read_in_thread(child.stdout.take());
    let t_err = read_in_thread(child.stderr.take());
    let start = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break -1;
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => break -1,
        }
    };
    let text = format!("{}\n{}", t_out.join().unwrap_or_default(), t_err.join().unwrap_or_default());
    (code, text)
}

/// "WARNING: ..." 같은 부가 안내 줄을 빼고 남은 글
fn clean_message(text: &str) -> String {
    text.lines()
        .filter(|l| !l.trim().is_empty() && !l.trim_start().to_ascii_uppercase().starts_with("WARNING"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn safe_file_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect();
    if s.is_empty() {
        s = "image".into();
    }
    if !s.to_ascii_lowercase().ends_with(".png") {
        s.push_str(".png");
    }
    s
}

fn is_image(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png") | Some("webp") | Some("jpg") | Some("jpeg")
    )
}

/// 폴더 안(하위 포함)에서 since 이후에 생긴 가장 최근 이미지
pub fn newest_image(dir: &Path, since: SystemTime, exclude: &HashSet<PathBuf>) -> Option<PathBuf> {
    fn walk(d: &Path, depth: u32, since: SystemTime, exclude: &HashSet<PathBuf>, best: &mut Option<(SystemTime, PathBuf)>) {
        if depth > 4 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(d) else { return };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, depth + 1, since, exclude, best);
            } else if is_image(&p) && !exclude.contains(&p) {
                if let Ok(m) = e.metadata().and_then(|m| m.modified()) {
                    if m >= since && best.as_ref().map(|(t, _)| m > *t).unwrap_or(true) {
                        *best = Some((m, p));
                    }
                }
            }
        }
    }
    let mut best = None;
    walk(dir, 0, since, exclude, &mut best);
    best.map(|(_, p)| p)
}

fn append_log(state: &mut JobState, text: &str) {
    state.log.push_str(text);
    if state.log.len() > LOG_LIMIT {
        let mut cut = state.log.len() - LOG_LIMIT;
        while !state.log.is_char_boundary(cut) {
            cut += 1;
        }
        state.log = state.log[cut..].to_string();
    }
}

impl CodexManager {
    pub fn new(config: Config) -> Self {
        CodexManager { config, jobs: Mutex::new(HashMap::new()), counter: AtomicU64::new(0), status_cache: Mutex::new(None) }
    }

    /// Codex 설치/로그인 상태 (fresh=false 면 30초 동안 기억한 값을 씀)
    pub fn status(&self, fresh: bool) -> CodexStatus {
        if !fresh {
            if let Some((at, st)) = self.status_cache.lock().unwrap().as_ref() {
                if at.elapsed() < STATUS_CACHE {
                    return st.clone();
                }
            }
        }
        let bin = self.config.codex_bin.as_str();
        let (code, ver) = run_capture(bin, &["--version"], Duration::from_secs(20));
        let st = if code != 0 {
            CodexStatus {
                connected: true,
                bridge_version: VERSION.into(),
                codex_installed: false,
                codex_version: None,
                logged_in: false,
                auth_mode: "unknown".into(),
                message: "Codex CLI not found. Install: npm install -g @openai/codex".into(),
            }
        } else {
            let (lcode, text) = run_capture(bin, &["login", "status"], Duration::from_secs(20));
            let text = clean_message(&text);
            let lower = text.to_ascii_lowercase();
            let auth_mode = if lower.contains("chatgpt") {
                "chatgpt"
            } else if lower.contains("api key") {
                "apikey"
            } else {
                "unknown"
            };
            CodexStatus {
                connected: true,
                bridge_version: VERSION.into(),
                codex_installed: true,
                codex_version: Some(clean_message(&ver)),
                logged_in: lcode == 0 && !lower.contains("not logged in"),
                auth_mode: auth_mode.into(),
                message: text,
            }
        };
        *self.status_cache.lock().unwrap() = Some((Instant::now(), st.clone()));
        st
    }

    /// `codex login` 시작 (브라우저에서 ChatGPT 로그인 창이 열림)
    pub fn login(&self) -> LoginResult {
        *self.status_cache.lock().unwrap() = None;
        match codex_command(&self.config.codex_bin).arg("login").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(_) => LoginResult { started: true, message: "A browser window will open for ChatGPT sign-in.".into() },
            Err(e) => LoginResult { started: false, message: e.to_string() },
        }
    }

    fn new_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::SeqCst);
        let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        format!("{:x}-{:x}", t, n)
    }

    pub fn start_job(self: &Arc<Self>, task: String, prompt: String, images: Vec<ImageInput>) -> Result<StartResult, String> {
        if prompt.trim().is_empty() {
            return Err("prompt is required".into());
        }
        if images.len() > 6 {
            return Err("images must be an array (max 6)".into());
        }
        let st = self.status(false);
        if !st.codex_installed {
            return Err("Codex CLI 가 설치되어 있지 않아요 / Codex CLI not found → npm install -g @openai/codex".into());
        }
        if !st.logged_in {
            return Err("Codex 로그인이 필요해요 / Codex is not signed in → codex login (ChatGPT 계정)".into());
        }

        let id = self.new_id();
        let dir = self.config.work_root.join(&id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut inputs = Vec::new();
        for img in &images {
            let bytes = B64.decode(img.data.as_bytes()).map_err(|e| format!("bad image data: {e}"))?;
            let path = dir.join(safe_file_name(&img.name));
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            inputs.push(path);
        }
        std::fs::write(dir.join("TASK.md"), format!("# {task}\n\n{prompt}\n")).map_err(|e| e.to_string())?;

        let mut cmd = codex_command(&self.config.codex_bin);
        cmd.arg("exec")
            .arg("-")
            .arg("--skip-git-repo-check")
            .args(["--sandbox", "workspace-write"])
            .arg("-C")
            .arg(&dir)
            .args(["--color", "never"])
            .args(["-c", "approval_policy=\"never\""])
            .args(["--enable", "image_generation"])
            .arg("-o")
            .arg(dir.join("last-message.txt"));
        if !inputs.is_empty() {
            cmd.arg("--image");
            cmd.args(&inputs);
        }
        cmd.current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("Failed to run codex: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(prompt.as_bytes());
        }
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let mut state = JobState { id: id.clone(), status: "running".into(), log: String::new(), error: None, result: None };
        append_log(&mut state, &format!("$ codex exec (task={task}, images={})\n", inputs.len()));
        let job = Arc::new(Mutex::new(Job { state, child: Some(child), net_wait_since: None }));
        self.jobs.lock().unwrap().insert(id.clone(), job.clone());

        // 출력 읽기 (줄 단위)
        for stream in [stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)]
            .into_iter()
            .flatten()
        {
            let job = job.clone();
            thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    let mut j = job.lock().unwrap();
                    append_log(&mut j.state, &format!("{line}\n"));
                    let lower = line.to_ascii_lowercase();
                    if j.net_wait_since.is_none() && (lower.contains("waiting for network") || lower.contains("stream disconnected") || lower.contains("failed to connect")) {
                        j.net_wait_since = Some(Instant::now());
                    }
                }
            });
        }

        // 끝날 때까지 지켜보기
        let started_at = SystemTime::now() - Duration::from_secs(1);
        let timeout = self.config.job_timeout;
        let stall = self.config.network_stall;
        let codex_home = self.config.codex_home.clone();
        let exclude: HashSet<PathBuf> = inputs.into_iter().collect();
        let started = Instant::now();
        thread::spawn(move || {
            let code = loop {
                thread::sleep(Duration::from_millis(200));
                let mut guard = job.lock().unwrap();
                // 잠금 안의 Job 을 필드별로 나눠 빌려 씁니다. (child 와 state 를 함께 바꾸기 위해)
                let j = &mut *guard;
                if j.state.status != "running" {
                    if let Some(mut c) = j.child.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                    return;
                }
                let stalled = j.net_wait_since.map(|t| t.elapsed() > stall).unwrap_or(false);
                let Some(child) = j.child.as_mut() else { return };
                match child.try_wait() {
                    Ok(Some(status)) => break status.code().unwrap_or(-1),
                    Ok(None) if stalled || started.elapsed() > timeout => {
                        let _ = child.kill();
                        let _ = child.wait();
                        j.state.status = "error".into();
                        j.state.error = Some(if stalled {
                            "OpenAI 서버에 연결할 수 없어요 (인터넷/방화벽 확인) / Cannot reach OpenAI servers".into()
                        } else {
                            "시간이 너무 오래 걸려서 멈췄어요 / Timed out".into()
                        });
                        return;
                    }
                    Ok(None) => {}
                    Err(e) => {
                        j.state.status = "error".into();
                        j.state.error = Some(e.to_string());
                        return;
                    }
                }
            };
            // 출력 읽기가 끝날 시간을 조금 줍니다.
            thread::sleep(Duration::from_millis(100));
            let direct = dir.join("result.png");
            let out = if direct.is_file() {
                Some(direct)
            } else {
                newest_image(&dir, started_at, &exclude).or_else(|| newest_image(&codex_home.join("generated_images"), started_at, &exclude))
            };
            let mut j = job.lock().unwrap();
            j.child = None;
            match out.and_then(|p| std::fs::read(&p).ok().map(|b| (p, b))) {
                Some((p, bytes)) => {
                    append_log(&mut j.state, &format!("\n[app] result: {}\n", p.display()));
                    j.state.result = Some(B64.encode(bytes));
                    j.state.status = "done".into();
                }
                None => {
                    let last = std::fs::read_to_string(dir.join("last-message.txt")).unwrap_or_default();
                    j.state.status = "error".into();
                    j.state.error = Some(format!("No image was produced (exit code {code}). {}", last.trim()).trim().to_string());
                }
            }
        });
        Ok(StartResult { id })
    }

    pub fn get_job(&self, id: &str) -> Option<JobState> {
        let jobs = self.jobs.lock().unwrap();
        let job = jobs.get(id)?;
        let j = job.lock().unwrap();
        let mut s = j.state.clone();
        if s.status != "done" {
            s.result = None;
        }
        Some(s)
    }

    pub fn cancel_job(&self, id: &str) -> Option<JobState> {
        let jobs = self.jobs.lock().unwrap();
        let job = jobs.get(id)?;
        let mut j = job.lock().unwrap();
        if j.state.status == "running" {
            j.state.status = "cancelled".into();
            if let Some(c) = j.child.as_mut() {
                let _ = c.kill();
            }
        }
        Some(JobState { result: None, ..j.state.clone() })
    }

    /// 앱을 끌 때 실행 중인 작업 정리
    pub fn shutdown(&self) {
        for job in self.jobs.lock().unwrap().values() {
            let mut j = job.lock().unwrap();
            if let Some(c) = j.child.as_mut() {
                let _ = c.kill();
            }
        }
    }
}
