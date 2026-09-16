use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> Option<PathBuf> {
    let start = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR")?);
    let mut dir = start;
    loop {
        if dir.join(".git").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_version(root: &Path) -> String {
    let base = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into());
    // Use last commit touching admin-app (so content-only commits don't bump the app version).
    let mut sha = git(
        root,
        &["log", "-1", "--format=%h", "--", "admin-app"],
    )
    .filter(|s| !s.is_empty());
    if sha.is_none() {
        sha = git(root, &["rev-parse", "--short", "HEAD"]).filter(|s| !s.is_empty());
    }
    let sha = sha.unwrap_or_else(|| "dev".into());
    let dirty = git(root, &["status", "--porcelain", "--", "admin-app"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if dirty {
        format!("{base}+{sha}-dirty")
    } else {
        format!("{base}+{sha}")
    }
}

fn main() {
    // start.sh writes the current expected version into .build-version before
    // invoking cargo so the binary always reports exactly what the launcher computed.
    let marker = Path::new(env!("CARGO_MANIFEST_DIR")).join(".build-version");
    let version = fs::read_to_string(&marker)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| repo_root().map(|r| git_version(&r)))
        .unwrap_or_else(|| {
            env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into())
        });

    println!("cargo:rustc-env=AHMARIUS_APP_VERSION={version}");

    println!("cargo:rerun-if-changed={}", marker.display());
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../src");
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=../index.html");

    tauri_build::build();
}
