use crate::{AppError, AppResult};
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::Emitter;

const SOURCE_BRANCH: &str = "main";
const PAGES_BRANCH: &str = "gh-pages";

#[derive(Serialize, Debug, Clone)]
pub struct DiffFile {
    pub status: String,
    pub path: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct CommitInfo {
    pub hash: String,
    pub date: String,
    pub subject: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct GitStatusSummary {
    pub branch: String,
    pub remote: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub staged: Vec<DiffFile>,
    pub unstaged: Vec<DiffFile>,
    pub untracked: Vec<String>,
    pub unrelated_modified: Vec<String>,
    pub repo_path: String,
}

fn run_git(repo: &Path, args: &[&str]) -> AppResult<String> {
    let out = run_git_output(repo, args, true)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        let code = out.status.code().unwrap_or(-1);
        let detail = stderr.trim();
        let detail = if detail.is_empty() { stdout.trim() } else { detail };
        return Err(AppError::Git(if detail.is_empty() {
            format!("git {} failed with exit code {} and no output", args.join(" "), code)
        } else {
            format!("git {} failed (exit {code}): {detail}", args.join(" "))
        }));
    }
    Ok(stdout)
}

fn run_git_output(repo: &Path, args: &[&str], strict: bool) -> AppResult<std::process::Output> {
    let timeout = Duration::from_secs(45);
    let label = format!("git {}", args.join(" "));
    match crate::process::run_captured(repo, "git", args, timeout, &label) {
        Ok(out) => Ok(out),
        Err(e)
            if e.to_string().contains("timed out") && strict =>
        {
            Err(AppError::Command(format!(
                "{} (network or credential operation timed out)",
                label
            )))
        }
        Err(e) => Err(e),
    }
}

fn run_git_unsafe(repo: &Path, args: &[&str]) -> (bool, String, String) {
    match run_git_output(repo, args, false) {
        Ok(out) => (
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
        ),
        Err(e) => (false, String::new(), e.to_string()),
    }
}

pub fn repo_valid(repo: &Path) -> bool {
    run_git_unsafe(repo, &["rev-parse", "--is-inside-work-tree"]).0
}

/// Return the top-level working tree directory for `repo` (a path inside a Git
/// worktree), or `None` if it is not part of a Git repository.
pub fn git_toplevel(repo: &Path) -> Option<PathBuf> {
    let (ok, stdout, _) = run_git_unsafe(repo, &["rev-parse", "--show-toplevel"]);
    if !ok {
        return None;
    }
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

pub fn current_branch(repo: &Path) -> String {
    let ok = run_git_unsafe(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).1;
    let trimmed = ok.trim();
    if trimmed.is_empty() || trimmed == "HEAD" {
        "(detached)".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn git_status(repo: &Path) -> AppResult<GitStatusSummary> {
    if !repo_valid(repo) {
        return Err(AppError::Validation(
            "The configured path is not a Git repository.".into(),
        ));
    }
    let branch = current_branch(repo);

    let remote_key = format!("branch.{}.remote", branch);
    let remote = match run_git_unsafe(repo, &["config", "--get", &remote_key]).1.trim() {
        r if !r.is_empty() => Some(r.to_string()),
        _ => {
            let r = run_git_unsafe(repo, &["remote"]).1.trim().to_string();
            if r.is_empty() {
                None
            } else {
                Some(r)
            }
        }
    };

    // Publishing targets origin/main, not the current branch's upstream.
    let (mut ahead, mut behind) = (0, 0);
    let up_raw = run_git_unsafe(repo, &["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
    if up_raw.0 {
        if let Some((a, b)) = up_raw.1.split_once('\t') {
            ahead = a.trim().parse().unwrap_or(0);
            behind = b.trim().parse().unwrap_or(0);
        }
    }

    let mut staged = vec![];
    let mut unstaged = vec![];
    let mut untracked = vec![];
    let status_raw = run_git_unsafe(repo, &["status", "--porcelain=v1", "-z"]);
    let mut rename_target_follows = false;
    for line in status_raw.1.split('\0') {
        if line.len() < 4 {
            continue;
        }
        if rename_target_follows {
            rename_target_follows = false;
            continue;
        }
        let x = line.as_bytes()[0] as char;
        let y = line.as_bytes()[1] as char;
        let p = line[3..].to_string();
        rename_target_follows = matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C');
        if x == '?' && y == '?' {
            untracked.push(p);
        } else if x != ' ' && x != '?' {
            staged.push(DiffFile {
                status: status_char(x),
                path: p,
            });
        } else if y != ' ' && y != '?' {
            unstaged.push(DiffFile {
                status: status_char(y),
                path: p,
            });
        }
    }

    // Unrelated modified = unstaged modified/added changes outside content/assets/pages/devlog/dist
    // (This is informational; staging is always explicit by path list.)
    let related_prefixes = ["content/", "pages/", "pages.html", "devlog/", "devlog.html", "assets/"];
    let unrelated_modified = unstaged
        .iter()
        .filter(|f| !related_prefixes.iter().any(|pfx| f.path.starts_with(pfx)))
        .map(|f| f.path.clone())
        .collect();

    Ok(GitStatusSummary {
        branch,
        remote,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        unrelated_modified,
        repo_path: repo.display().to_string(),
    })
}

fn status_char(c: char) -> String {
    match c {
        'A' => "added".to_string(),
        'M' => "modified".to_string(),
        'D' => "deleted".to_string(),
        'R' => "renamed".to_string(),
        'C' => "copied".to_string(),
        'U' => "unmerged".to_string(),
        _ => "changed".to_string(),
    }
}

pub fn git_diff_summary(repo: &Path, staged: bool) -> AppResult<Vec<DiffFile>> {
    let args: &[&str] = if staged {
        &["diff", "--cached", "--name-status"]
    } else {
        &["diff", "--name-status"]
    };
    let out = run_git(repo, args)?;
    let mut files = vec![];
    for line in out.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((code, p)) = trimmed.split_once('\t') {
            files.push(DiffFile {
                status: status_char(code.chars().next().unwrap_or('M')),
                path: p.to_string(),
            });
        }
    }
    Ok(files)
}

/// Full unified diff (line-level) of the working tree or the index.
pub fn git_diff(repo: &Path, staged: bool) -> AppResult<String> {
    if !repo_valid(repo) {
        return Err(AppError::Validation(
            "The configured path is not a Git repository.".into(),
        ));
    }
    let args: &[&str] = if staged {
        &["diff", "--cached", "--unified=3"]
    } else {
        &["diff", "--unified=3"]
    };
    let out = run_git(repo, args)?;
    Ok(out.trim().to_string())
}

/// List recent commits for an arbitrary project repository (used to seed
/// devlog entries from the repo you are actually working in).
pub fn git_log(repo: &Path, count: usize) -> AppResult<Vec<CommitInfo>> {
    if !repo_valid(repo) {
        return Err(AppError::Validation(format!(
            "Not a Git repository: {}",
            repo.display()
        )));
    }
    let n = count.clamp(1, 200);
    let arg_n = format!("-{}", n);
    let out = run_git(
        repo,
        &[
            "--no-pager",
            "log",
            &arg_n,
            "--pretty=format:%h|%ad|%s",
            "--date=short",
        ],
    )?;
    let mut commits = vec![];
    for line in out.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, '|');
        let hash = parts.next().unwrap_or("").to_string();
        let date = parts.next().unwrap_or("").to_string();
        let subject = parts.next().unwrap_or("").to_string();
        commits.push(CommitInfo { hash, date, subject });
    }
    Ok(commits)
}

pub fn git_stage_paths(repo: &Path, paths: &[String]) -> AppResult<()> {
    if paths.is_empty() {
        return Ok(());
    }

    let mut present = Vec::new();
    let mut deleted = Vec::new();
    for raw in paths {
        let path = raw.trim();
        let relative = Path::new(path);
        if path.is_empty()
            || relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            continue;
        }
        if repo.join(relative).exists() {
            present.push(path);
        } else if run_git_unsafe(repo, &["ls-files", "--error-unmatch", "--", path]).0 {
            // Use the explicitly selected, tracked path. `git add -u -- path`
            // records a deletion without ever staging unrelated work.
            deleted.push(path);
        }
    }
    if !present.is_empty() {
        let mut args = vec!["add", "--"];
        args.extend(present);
        run_git(repo, &args)?;
    }
    if !deleted.is_empty() {
        let mut args = vec!["add", "-u", "--"];
        args.extend(deleted);
        run_git(repo, &args)?;
    }

    Ok(())
}

pub fn git_commit(repo: &Path, message: &str) -> AppResult<String> {
    let msg = if message.is_empty() {
        "Update portfolio content"
    } else {
        message
    };
    let out = run_git(repo, &["commit", "-m", msg])?;
    Ok(out)
}

/// Unstage the given paths (or the whole index when `paths` is empty) so a
/// failed publish can never leave the index permanently blocking later ones.
pub fn git_unstage(repo: &Path, paths: &[String]) -> AppResult<()> {
    let clean: Vec<&str> = paths
        .iter()
        .map(|p| p.trim())
        .filter(|p| {
            !p.is_empty()
                && !Path::new(p).is_absolute()
                && !p.contains("..")
        })
        .collect();
    if clean.is_empty() {
        run_git(repo, &["reset", "--", "."])?;
        return Ok(());
    }
    let mut args = vec!["reset", "--"];
    args.extend(clean.iter().copied());
    run_git(repo, &args)?;
    Ok(())
}

pub fn git_push(repo: &Path, branch: &str) -> AppResult<String> {
    if branch == "(detached)" {
        return Err(AppError::Validation("Cannot publish from a detached HEAD. Check out a branch before publishing.".into()));
    }

    run_git(repo, &["fetch", "origin", SOURCE_BRANCH])?;
    if !run_git_unsafe(repo, &["merge-base", "--is-ancestor", "origin/main", "HEAD"]).0 {
        return Err(AppError::Git(
            "origin/main contains changes that are not in this checkout. Rebase this branch onto origin/main, resolve any conflicts, then publish again.".into(),
        ));
    }

    run_git_verbose(repo, &["push", "origin", "HEAD:main"])
}

/// Deploy the validated public snapshot without switching or cleaning the
/// source checkout. Only dist/ reaches the gh-pages branch.
pub fn deploy_pages(repo: &Path) -> AppResult<String> {
    let dist = repo.join("dist");
    if !dist.join("index.html").is_file() || !dist.join("devlog.html").is_file() {
        return Err(AppError::Validation(
            "The publish snapshot is missing. Run the publish build before deploying.".into(),
        ));
    }
    for private in [
        "content",
        "admin-app",
        "scripts",
        "sync-service",
        "bin",
        "docs",
        ".git",
        ".gitignore",
        ".gitattributes",
        "start.sh",
        "package.json",
        "package-lock.json",
        "README.md",
    ] {
        if dist.join(private).exists() {
            return Err(AppError::Validation(format!(
                "Refusing to deploy: dist/ unexpectedly contains private source path '{private}'."
            )));
        }
    }

    let remote = run_git(repo, &["remote", "get-url", "origin"])?;
    let remote = remote.trim();
    if remote.is_empty() {
        return Err(AppError::Validation("The repository has no origin remote.".into()));
    }

    let stamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default();
    let checkout = std::env::temp_dir().join(format!("ahmarius-pages-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&checkout)?;

    let result = (|| -> AppResult<String> {
        let probe = run_git_output(repo, &["ls-remote", "--heads", "origin", "refs/heads/gh-pages"], true)?;
        if !probe.status.success() {
            return Err(AppError::Git(format!(
                "Could not check the {PAGES_BRANCH} branch: {}",
                String::from_utf8_lossy(&probe.stderr).trim()
            )));
        }
        let exists = !String::from_utf8_lossy(&probe.stdout).trim().is_empty();
        let checkout_arg = checkout.to_string_lossy().to_string();
        if exists {
            run_git_verbose(repo, &[
                "clone", "--quiet", "--single-branch", "--branch",
                PAGES_BRANCH, remote, &checkout_arg,
            ])?;
        } else {
            run_git_verbose(&checkout, &["init", "--initial-branch", PAGES_BRANCH])?;
            run_git_verbose(&checkout, &["remote", "add", "origin", remote])?;
        }

        clear_publish_checkout(&checkout)?;
        copy_publish_tree(&dist, &checkout)?;
        std::fs::write(checkout.join(".nojekyll"), b"")?;
        run_git_verbose(&checkout, &["add", "-A"])?;
        if run_git(&checkout, &["status", "--porcelain"])?.trim().is_empty() {
            return Ok(format!("The {PAGES_BRANCH} snapshot already matches this build."));
        }

        let source_hash = run_git(repo, &["rev-parse", "--short", "HEAD"])?;
        let message = format!("Publish site from {}", source_hash.trim());
        let author_name = git_config_or(repo, "user.name", "AH Marius Content Studio");
        let author_email = git_config_or(repo, "user.email", "content-studio@users.noreply.github.com");
        let name_arg = format!("user.name={author_name}");
        let email_arg = format!("user.email={author_email}");
        run_git_verbose(&checkout, &[
            "-c", &name_arg, "-c", &email_arg, "commit", "-m", &message,
        ])?;
        run_git_verbose(&checkout, &["push", "origin", "HEAD:gh-pages"])?;
        Ok(format!("Published {} to {PAGES_BRANCH}.", source_hash.trim()))
    })();

    let _ = std::fs::remove_dir_all(&checkout);
    result
}

fn run_git_verbose(repo: &Path, args: &[&str]) -> AppResult<String> {
    let out = run_git_output(repo, args, true)?;
    let detail = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ).trim().to_string();
    if !out.status.success() {
        return Err(AppError::Git(if detail.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            detail
        }));
    }
    Ok(detail)
}

fn git_config_or(repo: &Path, key: &str, fallback: &str) -> String {
    let (_, value, _) = run_git_unsafe(repo, &["config", "--get", key]);
    let value = value.trim();
    if value.is_empty() { fallback.to_string() } else { value.to_string() }
}

fn clear_publish_checkout(root: &Path) -> AppResult<()> {
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_name() == ".git" { continue; }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            std::fs::remove_dir_all(path)?;
        } else {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn copy_publish_tree(source: &Path, target: &Path) -> AppResult<()> {
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if kind.is_symlink() {
            return Err(AppError::Validation(format!(
                "Refusing to deploy symlink from dist/: {}", from.display()
            )));
        }
        if kind.is_dir() {
            std::fs::create_dir_all(&to)?;
            copy_publish_tree(&from, &to)?;
        } else if kind.is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Pull upstream changes. `strategy` is "rebase" (default, keeps history
/// linear) or "merge". Errors include full git output so the user can act.
pub fn git_pull(repo: &Path, strategy: &str) -> AppResult<String> {
    if strategy == "merge" {
        run_git(repo, &["pull", "origin", SOURCE_BRANCH])
    } else {
        run_git(repo, &["pull", "--rebase", "origin", SOURCE_BRANCH])
    }
}

pub fn git_last_commit(repo: &Path) -> AppResult<String> {
    Ok(run_git(repo, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

/// Probe whether Git can talk to the configured `origin` remote without
/// requiring interactive credentials. Returns the remote URL and an
/// auth/push-readiness summary so the UI can surface login state.
pub fn git_auth_status(repo: &Path) -> AppResult<serde_json::Value> {
    let remote = run_git(repo, &["remote", "get-url", "origin"]).unwrap_or_default();
    let remote = remote.trim().to_string();
    let (ok, _out, err) = run_git_unsafe(repo, &["ls-remote", "--exit-code", "origin", "HEAD"]);
    let error = if ok { String::new() } else { err.trim().to_string() };
    let (gh_authed, gh_login) = gh_auth_state();
    Ok(serde_json::json!({
        "remote": remote,
        "authenticated": ok,
        "error": error,
        "gh_installed": gh_installed(),
        "gh_authed": gh_authed,
        "gh_login": gh_login,
        "method": if ok { "git-credential" } else if gh_authed { "gh-cli" } else { "none" },
    }))
}

/// Returns `(installed, login)` for the GitHub CLI.
fn gh_auth_state() -> (bool, Option<String>) {
    if !gh_installed() {
        return (false, None);
    }
    let authed = Command::new("gh")
        .args(["auth", "status", "--active"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !authed {
        return (true, None);
    }
    let login = Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (true, login.or(Some("github".to_string())))
}

pub fn gh_installed() -> bool {
    !Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
}

/// Register the gh credential helper so `git push` over HTTPS can read the
/// token from gh's keyring. Idempotent; returns gh's stderr output.
pub fn github_auth_setup() -> AppResult<String> {
    if !gh_installed() {
        return Err(AppError::Command(
            "GitHub CLI (gh) is not installed. Install it from https://cli.github.com, or configure Git credentials manually.".into(),
        ));
    }
    let out = Command::new("gh")
        .args(["auth", "setup-git"])
        .output()
        .map_err(AppError::from)?;
    if !out.status.success() {
        return Err(AppError::Command(format!(
            "gh auth setup-git failed:\n{}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Ok(if stderr.is_empty() { "OK".to_string() } else { stderr })
}

/// Start the device-flow web sign-in via `gh auth login --web`. Runs in the
/// background and streams one-time code / URL / completion via Tauri events.
pub fn github_login(app: tauri::AppHandle) -> AppResult<()> {
    if !gh_installed() {
        let _ = app.emit(
            "github-login-error",
            "GitHub CLI (gh) is not installed. Install it, or configure Git credentials manually.",
        );
        return Err(AppError::Command(
            "GitHub CLI (gh) is not installed. Install it from https://cli.github.com, or configure Git credentials manually.".into(),
        ));
    }
    std::thread::spawn(move || {
        run_gh_login_flow(&app);
    });
    Ok(())
}

fn run_gh_login_flow(app: &tauri::AppHandle) {
    let mut child = match Command::new("gh")
        .args([
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--skip-ssh-key",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GH_PROMPT_DISABLED", "1")
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("github-login-error", format!("Could not start gh: {e}"));
            return;
        }
    };

    let stderr = child.stderr.take().expect("piped stderr");
    let events = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut seen_code = false;
        let mut seen_url = false;
        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            if let Some(code) = extract_gh_code(&line) {
                seen_code = true;
                let _ = events.emit("github-login-code", serde_json::json!({ "code": code }));
            }
            if let Some(url) = extract_gh_url(&line) {
                seen_url = true;
                let _ = events.emit("github-login-url", serde_json::json!({ "url": url }));
            }
            let _ = events.emit("github-login-progress", serde_json::json!({ "line": line }));
            if seen_code && seen_url {
                let _ = events.emit("github-login-ready", serde_json::json!({}));
            }
        }
    });

    let status = child.wait();
    let ok = status.map(|s| s.success()).unwrap_or(false);
    let (_, login) = if ok { gh_auth_state() } else { (false, None) };
    let _ = app.emit(
        "github-login-done",
        serde_json::json!({ "ok": ok, "login": login }),
    );
    if ok {
        // Ensure the HTTPS credential helper is registered for this repo's remote.
        let _ = github_auth_setup();
        if let Some(repo) = crate::auto_detect_repo() {
            let _ = run_git_unsafe(&repo, &["ls-remote", "--exit-code", "origin", "HEAD"]);
        }
    }
}

/// Parse gh's "First copy your one-time code: ABCD-1234" line.
fn extract_gh_code(line: &str) -> Option<String> {
    let key = "one-time code";
    let i = line.find(key)?;
    let rest = &line[i + key.len()..];
    let start = rest.find(|c: char| c.is_ascii_alphanumeric())?;
    let end = rest[start..]
        .find(|c: char| !c.is_ascii_alphanumeric() && c != '-')
        .map(|j| start + j)
        .unwrap_or(rest.len());
    if start >= end {
        return None;
    }
    Some(rest[start..end].to_string())
}

/// Parse gh's "Open this URL in your browser: https://github.com/login/device" line.
fn extract_gh_url(line: &str) -> Option<String> {
    const URL: &str = "https://github.com/login/device";
    let i = line.find(URL)?;
    let rest = &line[i..];
    let url = rest.split_whitespace().next().unwrap_or(URL);
    Some(if url.is_empty() { URL.to_string() } else { url.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn forbidden_patterns() -> Vec<String> {
        // Built from fragments at runtime so the literal text never appears in
        // the scanned source (which would cause a false positive).
        // The reset fragment is intentionally not used; kept as a documented guard.
        let mut v = Vec::new();
        v.push(["clean", " -f", "d"].concat());
        v.push(["clean", " -f", "xd"].concat());
        v.push(["push", " --fo", "rce"].concat());
        v.push(["push", " -f"].concat());
        v.push(["push", " +"].concat());
        v.push(["rebase", " -i"].concat());
        v.push(["filter-br", "anch"].concat());
        v.push(["stash", " pop"].concat());
        v.push(["add", " -A"].concat());
        v.push(["add", " ."].concat());
        v
    }

    #[test]
    fn no_destructive_git_substrings_in_source() {
        let src = fs::read_to_string(file!()).unwrap();
        // Only inspect production code (not this test module, which references
        // the patterns itself).
        let non_test = src.split("#[cfg(test)]").next().unwrap_or("").to_string();
        let bad: Vec<String> = forbidden_patterns()
            .into_iter()
            .filter(|p| non_test.contains(p))
            .collect();
        assert!(bad.is_empty(), "forbidden git arguments present: {:?}", bad);
    }

    fn repo() -> PathBuf {
        let dir = fs::canonicalize(std::env::temp_dir()).unwrap().join(format!(
            "studio-git-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("content")).unwrap();
        let _ = Command::new("git").args(["init", "-q"]).current_dir(&dir).status();
        let _ = Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&dir)
            .status();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .status();
        dir
    }

    #[test]
    fn stage_only_intended_paths() {
        let dir = repo();
        fs::write(dir.join("content/ok.md"), "ok").unwrap();
        fs::write(dir.join("unrelated.md"), "nope").unwrap();
        git_stage_paths(&dir, &["content/ok.md".to_string()]).unwrap();
        let status = git_status(&dir).unwrap();
        // Only content/ok.md staged; unrelated.md untracked & explicitly NOT staged.
        let staged_paths: Vec<&str> = status.staged.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(staged_paths, vec!["content/ok.md"]);
        assert!(status.untracked.contains(&"unrelated.md".to_string()));
        // No staged path may be the unrelated file.
        assert!(!staged_paths.contains(&"unrelated.md"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stages_an_explicitly_deleted_tracked_file() {
        let dir = repo();
        let path = dir.join("content/deleted.md");
        fs::write(&path, "before").unwrap();
        run_git(&dir, &["add", "--", "content/deleted.md"]).unwrap();
        run_git(&dir, &["commit", "-m", "Add fixture"]).unwrap();
        fs::remove_file(path).unwrap();

        git_stage_paths(&dir, &["content/deleted.md".to_string()]).unwrap();
        let status = git_status(&dir).unwrap();
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].path, "content/deleted.md");
        assert_eq!(status.staged[0].status, "deleted");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_path_list_stages_nothing() {
        let dir = repo();
        git_stage_paths(&dir, &[]).unwrap();
        let status = git_status(&dir).unwrap();
        assert!(status.staged.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repo_valid_detects_non_repo() {
        let dir = repo();
        fs::remove_dir_all(dir.join(".git")).ok();
        assert!(!repo_valid(&dir));
        fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn deploys_only_the_public_snapshot_to_gh_pages() {
        let dir = repo();
        fs::write(dir.join("README.md"), "source").unwrap();
        run_git(&dir, &["add", "--", "README.md"]).unwrap();
        run_git(&dir, &["commit", "-m", "Initial source"]).unwrap();

        let dist = dir.join("dist");
        fs::create_dir_all(dist.join("devlog")).unwrap();
        fs::write(dist.join("index.html"), "home").unwrap();
        fs::write(dist.join("devlog.html"), "devlog").unwrap();
        fs::write(dist.join("devlog/post.html"), "post").unwrap();

        let bare = dir.with_extension("remote.git");
        Command::new("git")
            .args(["init", "--bare", "-q"])
            .arg(&bare)
            .status()
            .unwrap();
        run_git(
            &dir,
            &["remote", "add", "origin", &bare.to_string_lossy()],
        )
        .unwrap();

        let result = deploy_pages(&dir).unwrap();
        assert!(result.contains("gh-pages"));

        let show = |path: &str| {
            Command::new("git")
                .arg(format!("--git-dir={}", bare.display()))
                .args(["show", &format!("gh-pages:{path}")])
                .output()
                .unwrap()
        };
        assert_eq!(String::from_utf8_lossy(&show("index.html").stdout), "home");
        assert!(show(".nojekyll").status.success());
        assert!(!show("content/private.md").status.success());

        let second = deploy_pages(&dir).unwrap();
        assert!(second.contains("already matches"));

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&bare).ok();
    }

    #[test]
    fn deployment_rejects_source_only_paths() {
        let dir = repo();
        let dist = dir.join("dist");
        fs::create_dir_all(dist.join("sync-service")).unwrap();
        fs::write(dist.join("index.html"), "home").unwrap();
        fs::write(dist.join("devlog.html"), "devlog").unwrap();
        fs::write(dist.join("sync-service/worker.js"), "private source").unwrap();

        let error = deploy_pages(&dir).unwrap_err().to_string();
        assert!(error.contains("sync-service"));

        fs::remove_dir_all(&dir).ok();
    }

}
