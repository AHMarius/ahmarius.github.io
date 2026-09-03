pub mod build;
pub mod content;
pub mod git;
pub mod import;

use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub use git::GitStatusSummary;

// ---------- Errors ----------

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Git could not be started. Is Git installed on this system?")]
    GitMissing,
    #[error("Git error: {0}")]
    Git(String),
    #[error("{0}")]
    Command(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

// ---------- Path & slug safety ----------

/// Validate a slug for use as a directory or file name component.
/// Rejects path separators, `.`/`..`, absolute paths, and non-safe characters.
pub fn ensure_safe_slug(input: &str) -> AppResult<String> {
    let slug = input.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::Validation("Slug must not be empty.".into()));
    }
    if slug == "." || slug == ".." {
        return Err(AppError::Validation(format!("Invalid slug: {}", slug)));
    }
    if slug.contains('/') || slug.contains('\\') || slug.starts_with('.') {
        return Err(AppError::Validation(format!("Unsafe slug: {}", slug)));
    }
    if slug.starts_with('/') || Path::new(&slug).is_absolute() {
        return Err(AppError::Validation(format!("Slug must be relative: {}", slug)));
    }
    for ch in slug.chars() {
        if !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
            return Err(AppError::Validation(format!(
                "Slug contains unsupported character '{}'.",
                ch
            )));
        }
    }
    Ok(slug)
}

/// Resolve `rel` (a slash-separated relative path) inside `repo`, rejecting
/// absolute escapes, parent traversal, and symlink escapes.
///
/// The target itself need not exist yet (e.g. a soon-to-be-created post or
/// assets dir), but every existing ancestor is canonicalized and verified to
/// stay within the repository root.
pub fn resolve_in_repo(repo: &Path, rel: &str) -> AppResult<PathBuf> {
    let repo_canon = repo
        .canonicalize()
        .map_err(|_| AppError::Validation("Repository path does not exist.".into()))?;

    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(AppError::Validation(format!("Path must be relative: {}", rel)));
    }

    let mut parts = Vec::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(s) => parts.push(s.to_os_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::Validation("Path traversal is not allowed.".into()));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::Validation(format!("Unsafe path: {}", rel)));
            }
        }
    }

    let mut result = repo_canon.clone();
    for part in parts {
        result.push(&part);
        if result.exists() {
            let canon = result
                .canonicalize()
                .map_err(|_| AppError::Validation(format!("Cannot resolve path inside repo: {}", rel)))?;
            if !canon.starts_with(&repo_canon) {
                return Err(AppError::Validation("Path escaped the repository.".into()));
            }
            result = canon;
        }
    }
    Ok(result)
}

// ---------- State ----------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WindowStatePrefs {
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Preferences {
    #[serde(default)]
    pub repo_path: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub sidebar_width: Option<f64>,
    #[serde(default)]
    pub last_editor_mode: Option<String>,
    #[serde(default)]
    pub last_opened: Option<String>,
    #[serde(default)]
    pub window_state: Option<WindowStatePrefs>,
}

struct AppState {
    prefs: Mutex<Preferences>,
    prefs_path: PathBuf,
    recovery_dir: PathBuf,
}

fn default_config_dir() -> PathBuf {
    std::env::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("ahmarius-content-studio")
}

fn load_prefs(path: &Path) -> Preferences {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_prefs(prefs: &Preferences, path: &Path) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(prefs) {
        let _ = std::fs::write(path, json);
    }
}

// ---------- Repo resolution ----------

/// Find the ahmarius.github.io repository root automatically when the user has
/// not configured an explicit path. Checks, in order:
///   1. An explicit path (settings or per-command fallback).
///   2. The current working directory if it is inside the site repo.
///   3. The parent/ancestors of the current working directory.
///   4. Common development locations under the user's home.
fn auto_detect_repo() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.clone());
        for anc in cwd.ancestors().skip(1) {
            candidates.push(anc.to_path_buf());
        }
    }
    let home = std::env::home_dir()?;
    let mut known: Vec<PathBuf> = vec![
        home.join("ahmarius.github.io"),
        home.join("WebstormProjects").join("ahmarius.github.io"),
        home.join("projects").join("ahmarius.github.io"),
        home.join("Developer").join("ahmarius.github.io"),
        home.join("dev").join("ahmarius.github.io"),
    ];
    if let Ok(existing) = std::fs::read_dir(home.join("WebstormProjects")) {
        for entry in existing.flatten() {
            let p = entry.path();
            if p.is_dir() && p.file_name().map(|n| n == "ahmarius.github.io").unwrap_or(false) {
                known.push(p);
            }
        }
    }
    candidates.extend(known);

    for cand in candidates {
        if git::repo_valid(&cand) {
            // `cand` may be any directory inside the worktree (e.g. the app's
            // own subfolder). Resolve it to the Git worktree root so content
            // and the site build always target the ahmarius.github.io root.
            if let Some(toplevel) = git::git_toplevel(&cand) {
                return Some(toplevel);
            }
            return Some(cand);
        }
    }
    None
}

fn repo_for(state: &AppState, fallback: Option<String>) -> Result<PathBuf, AppError> {
    let p = state.prefs.lock().unwrap();
    let explicit = fallback
        .filter(|s| !s.trim().is_empty())
        .or_else(|| p.repo_path.clone().filter(|s| !s.trim().is_empty()));
    if let Some(path) = explicit {
        let pb = PathBuf::from(path);
        if pb.join(".git").exists() || git::repo_valid(&pb) {
            return Ok(pb);
        }
        return Err(AppError::Validation(
            "The configured path is not a Git repository. Check Settings.".into(),
        ));
    }
    auto_detect_repo().ok_or_else(|| {
        AppError::Validation(
            "Could not locate the ahmarius.github.io repository automatically. Open Settings and set the repository path.".into(),
        )
    })
}

fn with_repo<T>(
    app: &tauri::AppHandle,
    fallback: Option<String>,
    f: impl FnOnce(&PathBuf) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let repo = repo_for(&state, fallback)?;
    f(&repo)
}

// ---------- Commands ----------

#[tauri::command]
fn get_prefs(state: tauri::State<'_, AppState>) -> Preferences {
    state.prefs.lock().unwrap().clone()
}

#[tauri::command]
fn set_prefs(app: tauri::AppHandle, prefs: Preferences) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    {
        let mut p = state.prefs.lock().unwrap();
        *p = prefs.clone();
    }
    save_prefs(&prefs, &state.prefs_path);
    Ok(())
}

// ---------- Recovery (autosave / crash recovery) ----------

#[derive(Serialize, Debug, Clone)]
struct RecoveryEntry {
    key: String,
    saved_at: String,
    prelude: String,
    bytes: usize,
}

fn recovery_snapshot_path(state: &AppState, key: &str) -> PathBuf {
    // Key is an opaque identifier (e.g. "post:page/slug"); hash it to a safe filename.
    let hash = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        key.hash(&mut h);
        h.finish()
    };
    state.recovery_dir.join(format!("{hash:016x}.json"))
}

#[tauri::command]
fn save_recovery(app: tauri::AppHandle, key: String, content: String) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let path = recovery_snapshot_path(&state, &key);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let entry = serde_json::json!({
        "key": key,
        "saved_at": chrono::Local::now().to_rfc3339(),
        "content": content,
    });
    std::fs::write(&path, serde_json::to_vec(&entry).unwrap_or_default())?;
    Ok(())
}

#[tauri::command]
fn load_recovery(app: tauri::AppHandle, key: String) -> Result<Option<String>, AppError> {
    let state = app.state::<AppState>();
    let path = recovery_snapshot_path(&state, &key);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| AppError::Command(e.to_string()))?;
    Ok(v.get("content").and_then(|c| c.as_str()).map(|s| s.to_string()))
}

#[tauri::command]
fn clear_recovery(app: tauri::AppHandle, key: String) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let path = recovery_snapshot_path(&state, &key);
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
fn list_recovery(app: tauri::AppHandle) -> Result<Vec<RecoveryEntry>, AppError> {
    let state = app.state::<AppState>();
    let _ = std::fs::create_dir_all(&state.recovery_dir);
    let mut out = vec![];
    for entry in std::fs::read_dir(&state.recovery_dir)?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let (Some(key), Some(content)) = (
                    v.get("key").and_then(|k| k.as_str()),
                    v.get("content").and_then(|c| c.as_str()),
                ) {
                    let prelude = content
                        .chars()
                        .take(80)
                        .collect::<String>()
                        .replace('\n', " ");
                    out.push(RecoveryEntry {
                        key: key.to_string(),
                        saved_at: v
                            .get("saved_at")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string(),
                        prelude,
                        bytes: content.len(),
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    Ok(out)
}

#[tauri::command]
fn scan_content(app: tauri::AppHandle, repo_path: Option<String>) -> Result<Vec<content::ContentNode>, AppError> {
    with_repo(&app, repo_path, |repo| content::content_tree(repo))
}

#[tauri::command]
fn list_pages(app: tauri::AppHandle, repo_path: Option<String>) -> Result<Vec<content::PageRow>, AppError> {
    with_repo(&app, repo_path, |repo| content::list_pages(repo))
}

#[tauri::command]
fn list_posts(app: tauri::AppHandle, repo_path: Option<String>) -> Result<Vec<content::PostRow>, AppError> {
    with_repo(&app, repo_path, |repo| content::list_posts(repo))
}

#[tauri::command]
fn read_page(app: tauri::AppHandle, slug: String) -> Result<serde_json::Value, AppError> {
    with_repo(&app, None, |repo| content::read_page(repo, &slug))
}

#[tauri::command]
fn create_page(app: tauri::AppHandle, page: content::PageInput) -> Result<content::PageRow, AppError> {
    with_repo(&app, None, |repo| content::create_page(repo, &page))
}

#[tauri::command]
fn update_page(app: tauri::AppHandle, page: content::PageInput) -> Result<(), AppError> {
    with_repo(&app, None, |repo| content::update_page(repo, &page))
}

#[tauri::command]
fn delete_page(app: tauri::AppHandle, slug: String) -> Result<(), AppError> {
    with_repo(&app, None, |repo| content::delete_page(repo, &slug))
}

#[tauri::command]
fn read_post(app: tauri::AppHandle, page_slug: String, post_slug: String) -> Result<serde_json::Value, AppError> {
    with_repo(&app, None, |repo| content::read_post(repo, &page_slug, &post_slug))
}

#[tauri::command]
fn write_post(app: tauri::AppHandle, input: content::PostInput) -> Result<String, AppError> {
    with_repo(&app, None, |repo| content::write_post(repo, &input))
}

#[tauri::command]
fn delete_post(app: tauri::AppHandle, page_slug: String, post_slug: String) -> Result<(), AppError> {
    with_repo(&app, None, |repo| {
        content::delete_post(repo, &page_slug, &post_slug)
    })
}

#[tauri::command]
fn import_asset(
    app: tauri::AppHandle,
    page_slug: String,
    post_slug: String,
    source_path: String,
    original_name: String,
) -> Result<import::ImportAssetResult, AppError> {
    with_repo(&app, None, |repo| {
        import::import_asset(repo, &page_slug, &post_slug, &source_path, &original_name)
    })
}

#[tauri::command]
fn import_pdf(app: tauri::AppHandle, source_path: String) -> Result<import::PdfImportResult, AppError> {
    with_repo(&app, None, |repo| import::import_pdf(repo, &source_path))
}

#[tauri::command]
fn scan_media(app: tauri::AppHandle) -> Result<Vec<content::MediaFile>, AppError> {
    with_repo(&app, None, |repo| content::scan_media(repo))
}

#[tauri::command]
fn delete_media(app: tauri::AppHandle, rel_path: String) -> Result<(), AppError> {
    with_repo(&app, None, |repo| content::delete_media(repo, &rel_path))
}

#[tauri::command]
fn build_site(app: tauri::AppHandle) -> Result<build::BuildResult, AppError> {
    with_repo(&app, None, |repo| build::build_site(repo))
}

#[tauri::command]
fn git_status(app: tauri::AppHandle) -> Result<GitStatusSummary, AppError> {
    with_repo(&app, None, |repo| git::git_status(repo))
}

#[tauri::command]
fn git_diff_summary(app: tauri::AppHandle, staged: bool) -> Result<Vec<git::DiffFile>, AppError> {
    with_repo(&app, None, |repo| git::git_diff_summary(repo, staged))
}

#[tauri::command]
fn git_stage_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), AppError> {
    with_repo(&app, None, |repo| git::git_stage_paths(repo, &paths))
}

#[tauri::command]
fn git_commit(app: tauri::AppHandle, message: String) -> Result<String, AppError> {
    with_repo(&app, None, |repo| git::git_commit(repo, &message))
}

#[tauri::command]
fn git_push(app: tauri::AppHandle, branch: String) -> Result<String, AppError> {
    with_repo(&app, None, |repo| git::git_push(repo, &branch))
}

#[tauri::command]
fn git_last_commit(app: tauri::AppHandle) -> Result<String, AppError> {
    with_repo(&app, None, |repo| git::git_last_commit(repo))
}

#[tauri::command]
fn git_auth_status(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    with_repo(&app, None, |repo| git::git_auth_status(repo))
}

#[tauri::command]
fn check_repo(repo_path: String) -> Result<serde_json::Value, AppError> {
    let path = PathBuf::from(&repo_path);
    let exists = path.join("package.json").exists() && path.join("content").is_dir() && path.join("assets").is_dir();
    Ok(serde_json::json!({
        "is_repo": git::repo_valid(&path),
        "looks_like_site": exists,
        "path": path.display().to_string(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| default_config_dir());
            let path = dir.join("prefs.json");
            let prefs = load_prefs(&path);
            let recovery_dir = dir.join("recovery");
            app.manage(AppState {
                recovery_dir,
                prefs: Mutex::new(prefs),
                prefs_path: path,
            });

            // Restore persisted window state, if any.
            if let Some(ws) = app
                .state::<AppState>()
                .prefs
                .lock()
                .unwrap()
                .window_state
                .clone()
            {
                for window in app.webview_windows().values() {
                    let _ = window.set_size(tauri::LogicalSize::new(
                        ws.width.unwrap_or(1280.0),
                        ws.height.unwrap_or(820.0),
                    ));
                    if let (Some(x), Some(y)) = (ws.x, ws.y) {
                        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                    }
                }
                if ws.maximized {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.maximize();
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::WindowEvent;
            // Persist window geometry on resize/move (and when maximized state changes,
            // which surfaces through a Resized event with the window maximized).
            let app = window.app_handle();
            let state = app.state::<AppState>();
            match event {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                    let mut p = state.prefs.lock().unwrap();
                    let ws = p.window_state.get_or_insert_with(WindowStatePrefs::default);
                    if let (Ok(inner), Ok(pos)) = (window.inner_size(), window.outer_position()) {
                        ws.width = Some(inner.width as f64);
                        ws.height = Some(inner.height as f64);
                        ws.x = Some(pos.x as f64);
                        ws.y = Some(pos.y as f64);
                    }
                    ws.maximized = window.is_maximized().unwrap_or(false);
                    let snap = p.clone();
                    drop(p);
                    save_prefs(&snap, &state.prefs_path);
                }
                WindowEvent::CloseRequested { .. } => {
                    let mut p = state.prefs.lock().unwrap();
                    let ws = p.window_state.get_or_insert_with(WindowStatePrefs::default);
                    if let (Ok(inner), Ok(pos)) = (window.inner_size(), window.outer_position()) {
                        ws.width = Some(inner.width as f64);
                        ws.height = Some(inner.height as f64);
                        ws.x = Some(pos.x as f64);
                        ws.y = Some(pos.y as f64);
                    }
                    ws.maximized = window.is_maximized().unwrap_or(false);
                    let snap = p.clone();
                    drop(p);
                    save_prefs(&snap, &state.prefs_path);
                }
                _ => {}
            }
            let _ = app;
        })
        .invoke_handler(tauri::generate_handler![
            get_prefs,
            set_prefs,
            save_recovery,
            load_recovery,
            clear_recovery,
            list_recovery,
            scan_content,
            list_pages,
            list_posts,
            read_page,
            create_page,
            update_page,
            delete_page,
            read_post,
            write_post,
            delete_post,
            import_asset,
            import_pdf,
            scan_media,
            delete_media,
            build_site,
            git_status,
            git_diff_summary,
            git_stage_paths,
            git_commit,
            git_push,
            git_last_commit,
            git_auth_status,
            check_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "studio-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn slug_rejects_path_traversal() {
        assert!(ensure_safe_slug("../evil").is_err());
        assert!(ensure_safe_slug("a/b").is_err());
        assert!(ensure_safe_slug("/abs").is_err());
        assert!(ensure_safe_slug("..").is_err());
        assert!(ensure_safe_slug("").is_err());
    }

    #[test]
    fn slug_normalizes_but_rejects_spaces() {
        assert_eq!(ensure_safe_slug("gpu-port").unwrap(), "gpu-port");
        assert_eq!(ensure_safe_slug("Gpu_Port").unwrap(), "gpu_port");
        assert!(ensure_safe_slug("has space").is_err());
    }

    #[test]
    fn resolve_inside_repo_ok() {
        let repo = unique_dir("repo");
        fs::create_dir_all(repo.join("content/pages/fluid")).unwrap();
        let got = resolve_in_repo(&repo, "content/pages/fluid").unwrap();
        assert!(got.starts_with(repo.canonicalize().unwrap()));
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn resolve_rejects_traversal_and_absolute() {
        let repo = unique_dir("repo2");
        assert!(resolve_in_repo(&repo, "../outside").is_err());
        assert!(resolve_in_repo(&repo, "/etc/passwd").is_err());
        assert!(resolve_in_repo(&repo, "a/../../b").is_err());
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn resolve_inside_repo_ok_for_nonexistent_tail() {
        let repo = unique_dir("repo3");
        // Parent exists, tail doesn't: must still resolve (for new posts/assets).
        fs::create_dir_all(repo.join("content/pages")).unwrap();
        let got = resolve_in_repo(&repo, "content/pages/new-post").unwrap();
        assert!(got.starts_with(repo.canonicalize().unwrap()));
        fs::remove_dir_all(&repo).ok();
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let repo = unique_dir("repo4");
        fs::create_dir_all(repo.join("content")).unwrap();
        // Symlink inside repo pointing outside.
        let outside = unique_dir("outside");
        let link = repo.join("content/escape");
        symlink(&outside, &link).unwrap();
        assert!(resolve_in_repo(&repo, "content/escape").is_err());
        fs::remove_dir_all(&repo).ok();
        fs::remove_dir_all(&outside).ok();
    }
}
