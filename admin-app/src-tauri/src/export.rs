use crate::{AppError, AppResult, resolve_in_repo};
use std::path::Path;
use std::process::Command;

#[derive(serde::Serialize, Debug, Clone)]
pub struct ExportResult {
    pub ok: bool,
    pub out_path: Option<String>,
    pub detail: String,
}

fn pandoc_available() -> bool {
    Command::new("pandoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Export a post to PDF (or DOCX via --to=docx fallback) using pandoc when it
/// is installed. The post's body is combined with title/date frontmatter, so
/// output preserves the heading structure and math is rasterized by pandoc's
/// LaTeX engine when available.
pub fn export_post(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<ExportResult> {
    if !pandoc_available() {
        return Ok(ExportResult {
            ok: false,
            out_path: None,
            detail: "pandoc is not installed. Install pandoc (brew install pandoc, or from pandoc.org) to enable PDF/DOCX export.".into(),
        });
    }
    let file = resolve_in_repo(repo, &format!("content/pages/{}/posts/{}.md", page_slug, post_slug))?;
    let raw = std::fs::read_to_string(&file)?;
    let (meta, body) = crate::content::parse_post(&raw);
    let md = format!(
        "---\ntitle: {}\ndate: {}\n---\n\n{}",
        meta.title, meta.date, body
    );

    let out_dir = repo.join("export").join(page_slug);
    std::fs::create_dir_all(&out_dir)?;
    let out = out_dir.join(format!("{}.pdf", post_slug));

    let run_pandoc = |out_path: &Path, extra: &[&str]| -> AppResult<std::process::Output> {
        Command::new("pandoc")
            .arg("-f")
            .arg("markdown+tex_math_dollars")
            .arg("-o")
            .arg(out_path)
            .args(extra)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Command(format!("pandoc failed to start: {}", e)))
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(stdin) = child.stdin.as_mut() {
                    stdin.write_all(md.as_bytes())?;
                }
                child
                    .wait_with_output()
                    .map_err(AppError::from)
            })
    };

    let pdf = run_pandoc(&out, &["--pdf-engine=xelatex"])?;

    if !pdf.status.success() {
        let detail = String::from_utf8_lossy(&pdf.stderr)
            .chars()
            .take(500)
            .collect::<String>();
        // Fall back to DOCX (no LaTeX engine needed).
        let docx = out_dir.join(format!("{}.docx", post_slug));
        let docx_out = match run_pandoc(&docx, &[])? {
            o if o.status.success() => Some(docx.display().to_string()),
            o => {
                let d = String::from_utf8_lossy(&o.stderr).chars().take(500).collect::<String>();
                return Ok(ExportResult {
                    ok: false,
                    out_path: None,
                    detail: format!("pandoc could not export. PDF: {}\nDOCX: {}", detail, d),
                });
            }
        };
        return Ok(ExportResult {
            ok: true,
            out_path: docx_out,
            detail: format!(
                "pandoc could not produce a PDF (missing LaTeX engine?).\n{}",
                detail
            ),
        });
    }

    Ok(ExportResult {
        ok: true,
        out_path: Some(out.display().to_string()),
        detail: "Exported PDF.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pandoc_result_when_missing() {
        // On machines without pandoc this returns ok:false gracefully; the test
        // only asserts we never panic and always return a structured result.
        let root = std::env::temp_dir().join(format!("studio-export-{}", std::process::id()));
        std::fs::create_dir_all(
            root.join("content/pages/demo/posts"),
        )
        .unwrap();
        std::fs::write(root.join("content/pages/demo/posts/p.md"), "---\ntitle: T\nstatus: published\n---\nHello\n").unwrap();
        let r = export_post(&root, "demo", "p");
        assert!(r.is_ok());
        let res = r.unwrap();
        assert!(!res.detail.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}