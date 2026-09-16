use crate::{AppError, AppResult};
use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// Run `program args` inside `repo`, capturing stdout/stderr, with a hard
/// timeout. Output is redirected to temp files rather than pipes so a chatty
/// child (a large `git diff`, a verbose `npm test`, …) can never deadlock on a
/// full pipe buffer; only the exit status is polled.
pub fn run_captured<I, S>(
    repo: &Path,
    program: &str,
    args: I,
    timeout: Duration,
    label: &str,
) -> AppResult<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let (out_path, err_path) = temp_log_paths(program);
    let out_file = std::fs::File::create(&out_path).map_err(|e| {
        AppError::Command(format!("{label}: could not open temp output file: {e}"))
    })?;
    let err_file = std::fs::File::create(&err_path).map_err(|e| {
        AppError::Command(format!("{label}: could not open temp error file: {e}"))
    })?;

    let mut child = Command::new(program)
        .args(args)
        .current_dir(repo)
        .stdout(Stdio::from(out_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map_err(|e| AppError::Command(format!("{label}: could not start {program}: {e}")))?;

    let status = wait_child_with_timeout(&mut child, timeout, label)?;

    let stdout = read_log(&out_path, label)?;
    let stderr = read_log(&err_path, label)?;
    let _ = std::fs::remove_file(&out_path);
    let _ = std::fs::remove_file(&err_path);
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn wait_child_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
    label: &str,
) -> AppResult<std::process::ExitStatus> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(AppError::from)? {
            return Ok(status);
        }
        if started.elapsed() > timeout {
            kill_tree(child);
            let _ = child.wait();
            return Err(AppError::Command(format!(
                "{label} timed out after {} seconds.",
                timeout.as_secs()
            )));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn temp_log_paths(program: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let tag = format!(
        "{}-{}-{}",
        program
            .split(['/', '\\'])
            .next_back()
            .unwrap_or("proc")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(16)
            .collect::<String>(),
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
    );
    (
        std::env::temp_dir().join(format!("studio-{tag}.out")),
        std::env::temp_dir().join(format!("studio-{tag}.err")),
    )
}

fn read_log(path: &Path, label: &str) -> AppResult<Vec<u8>> {
    std::fs::read(path).map_err(|e| {
        AppError::Command(format!("{label}: could not read command output: {e}"))
    })
}

/// Best-effort kill of a child and its descendants so a hung lint/test/build
/// cannot leave orphaned Node or npm processes behind.
pub fn kill_tree(child: &mut std::process::Child) {
    if cfg!(target_os = "windows") {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .output();
    } else {
        let _ = Command::new("pkill")
            .args(["-KILL", "-P", &child.id().to_string()])
            .output();
        let _ = child.kill();
    }
}