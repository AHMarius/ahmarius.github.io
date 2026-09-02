use crate::{AppError, AppResult, resolve_in_repo, ensure_safe_slug};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_VIDEO_BYTES: u64 = 25 * 1024 * 1024; // 25 MiB
const WARN_VIDEO_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB

#[derive(Serialize, Debug, Clone)]
pub struct ImportAssetResult {
    pub file_name: String,
    pub rel_path: String,
    #[serde(default)]
    pub warning: Option<String>,
}

fn sanitize_filename(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in name.chars() {
        let lc = c.to_ascii_lowercase();
        if lc.is_ascii_alphanumeric() || lc == '.' || lc == '_' || lc == '-' {
            out.push(lc);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "asset".to_string()
    } else {
        trimmed
    }
}

pub fn import_asset(
    repo: &Path,
    page_slug: &str,
    post_slug: &str,
    source_path: &str,
    original_name: &str,
) -> AppResult<ImportAssetResult> {
    let page_slug = ensure_safe_slug(page_slug)?;
    let post_slug = ensure_safe_slug(post_slug)?;
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err(AppError::Validation(format!(
            "Source file not found: {}",
            source_path
        )));
    }

    // Large video protection
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_uppercase())
        .unwrap_or_default();
    let size = std::fs::metadata(&source)?.len();
    let mut warning = None;
    if matches!(ext.as_str(), "MP4" | "WEBM" | "OGG" | "OGV") {
        if size > WARN_VIDEO_BYTES {
            return Err(AppError::Validation(
                "This video is over 100 MiB. GitHub blocks regular Git objects over 100 MiB. \
                 Use external hosting + embed URL instead."
                    .into(),
            ));
        } else if size > MAX_VIDEO_BYTES {
            warning = Some(format!(
                "This video is {} and larger than 25 MiB. Consider external hosting to keep the repo small.",
                human_size(size)
            ));
        }
    }

    let assets_dir = resolve_in_repo(
        repo,
        &format!("content/pages/{}/posts/{}/assets", page_slug, post_slug),
    )?;    std::fs::create_dir_all(&assets_dir)?;

    let base = sanitize_filename(original_name);
    let mut candidate = base.clone();
    let mut counter = 1;
    while assets_dir.join(&candidate).exists() {
        let stem = Path::new(&base)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "asset".to_string());
        let ext = Path::new(&base)
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        candidate = if ext.is_empty() {
            format!("{}-{}", stem, counter)
        } else {
            format!("{}-{}.{}", stem, counter, ext)
        };
        counter += 1;
    }

    let dest = assets_dir.join(&candidate);
    std::fs::copy(&source, &dest)?;
    Ok(ImportAssetResult {
        file_name: candidate.clone(),
        rel_path: format!("assets/{}", candidate),
        warning,
    })
}

#[derive(Serialize, Debug, Clone)]
pub struct PdfImportResult {
    pub title: String,
    pub text: String,
    pub page_count: Option<usize>,
    pub is_image_only: bool,
}

pub fn import_pdf(repo: &Path, source_path: &str) -> AppResult<PdfImportResult> {
    let source = PathBuf::from(source_path);
    let _ = repo;
    if !source.is_file() {
        return Err(AppError::Validation(format!(
            "PDF not found: {}",
            source_path
        )));
    }
    let has_pdftotext = Command::new("pdftotext")
        .arg("-v")
        .output()
        .map(|_| true)
        .unwrap_or(false);

    let page_count = Command::new("pdfinfo")
        .arg(source_path)
        .output()
        .ok()
        .and_then(|o| {
            if !o.status.success() {
                return None;
            }
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            s.lines()
                .find(|l| l.starts_with("Pages:"))
                .and_then(|l| l.split(':').nth(1))
                .and_then(|v| v.trim().parse::<usize>().ok())
        });

    if !has_pdftotext {
        return Err(AppError::Validation(
            "PDF text extraction needs the 'pdftotext' tool (poppler). Install it with: sudo pacman -S poppler"
                .into(),
        ));
    }

    let out = Command::new("pdftotext")
        .arg("-layout")
        .arg(source_path)
        .arg("-")
        .output()
        .map_err(|_| AppError::Command("pdftotext failed to run.".into()))?;

    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let is_image_only = text.trim().split_whitespace().count() < 20;

    let title = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "PDF Import".to_string());

    Ok(PdfImportResult {
        title,
        text,
        page_count,
        is_image_only,
    })
}

fn human_size(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        format!("{:.1} GiB", mb / 1024.0)
    } else {
        format!("{:.1} MiB", mb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_normalizes() {
        assert_eq!(sanitize_filename("My Screenshot (Final) 2026.png"), "my-screenshot-final-2026.png");
        assert_eq!(sanitize_filename("Diagram.svg"), "diagram.svg");
        assert_eq!(sanitize_filename("!!!"), "asset");
        assert_eq!(sanitize_filename("already_safe.jpg"), "already_safe.jpg");
    }

    fn fresh_repo() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "studio-import-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let page = root.join("content/pages/fluid/posts/demo");
        std::fs::create_dir_all(&page).unwrap();
        root
    }

    #[test]
    fn import_copies_to_post_assets() {
        let repo = fresh_repo();
        let src = repo.join("shot.png");
        std::fs::write(&src, b"png-bytes").unwrap();
        let res = import_asset(&repo, "fluid", "demo", src.to_str().unwrap(), "My Shot.png").unwrap();
        assert_eq!(res.file_name, "my-shot.png");
        assert!(repo.join("content/pages/fluid/posts/demo/assets/my-shot.png").exists());
        std::fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn duplicate_filename_gets_suffix() {
        let repo = fresh_repo();
        let src = repo.join("shot.png");
        std::fs::write(&src, b"x").unwrap();
        import_asset(&repo, "fluid", "demo", src.to_str().unwrap(), "My Shot.png").unwrap();
        let res2 = import_asset(&repo, "fluid", "demo", src.to_str().unwrap(), "My Shot.png").unwrap();
        assert!(res2.file_name.starts_with("my-shot-1"));
        std::fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn traversal_page_slug_rejected() {
        let repo = fresh_repo();
        let src = repo.join("s.png");
        std::fs::write(&src, b"x").unwrap();
        let r = import_asset(&repo, "../evil", "demo", src.to_str().unwrap(), "s.png");
        assert!(r.is_err());
        std::fs::remove_dir_all(&repo).ok();
    }
}
