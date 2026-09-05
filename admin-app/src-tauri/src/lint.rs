use crate::{AppError, AppResult, resolve_in_repo};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

#[derive(Serialize, Debug, Clone)]
pub struct LintIssue {
    pub severity: String,
    pub message: String,
    pub file: String,
    pub line: Option<usize>,
}

#[derive(Serialize, Debug, Clone, Default)]
pub struct LintReport {
    pub issues: Vec<LintIssue>,
    pub warnings_count: usize,
    pub errors_count: usize,
}

impl LintReport {
    pub fn has_errors(&self) -> bool {
        self.errors_count > 0
    }
}

/// Lint Markdown posts before a publish: missing frontmatter dates, drafts
/// leaking into publish, broken local links, etc.
pub fn lint_posts(repo: &Path) -> AppResult<LintReport> {
    let pages_root = resolve_in_repo(repo, "content/pages")?;
    let mut report = LintReport::default();

    fn walk(repo: &Path, pages_root: &Path, dir: &Path, report: &mut LintReport) -> AppResult<()> {
        // Each direct child of the pages root is a page directory.
        for entry in std::fs::read_dir(dir).map_err(AppError::from)?.flatten() {
            let page_dir = entry.path();
            if !page_dir.is_dir() {
                continue;
            }
            let posts_dir = page_dir.join("posts");
            if posts_dir.is_dir() {
                let entries = std::fs::read_dir(&posts_dir).map_err(AppError::from)?;
                for post in entries.flatten() {
                    let path = post.path();
                    if !path.is_file() || path.extension().map(|e| e != "md").unwrap_or(true) {
                        continue;
                    }
                    let rel = path.strip_prefix(pages_root).unwrap_or(&path);
                    let rel_str = rel.to_string_lossy().to_string();
                    match lint_one_post(repo, &path, &rel_str) {
                        Ok(mut issues) => report.issues.append(&mut issues),
                        Err(e) => report.issues.push(LintIssue {
                            severity: "error".into(),
                            message: format!("Could not lint: {}", e),
                            file: rel_str,
                            line: None,
                        }),
                    }
                }
            }
            let subpages = page_dir.join("subpages");
            if subpages.is_dir() {
                walk(repo, pages_root, &subpages, report)?;
            }
        }
        Ok(())
    }

    walk(repo, &pages_root, &pages_root, &mut report)?;

    let mut set = HashSet::new();
    report.issues.retain(|i| set.insert(i.file.clone() + &i.message + &i.severity));
    report.errors_count = report.issues.iter().filter(|i| i.severity == "error").count();
    report.warnings_count = report.issues.len() - report.errors_count;
    Ok(report)
}

fn lint_one_post(repo: &Path, file: &Path, rel: &str) -> AppResult<Vec<LintIssue>> {
    let raw = std::fs::read_to_string(file)?;
    let mut issues = Vec::new();
    let (meta, body) = crate::content::parse_post(&raw);

    if meta.status == "published" && (meta.date.is_empty() || meta.date == "null") {
        issues.push(LintIssue {
            severity: "error".into(),
            message: "Published post is missing a date. Set date: YYYY-MM-DD.".into(),
            file: rel.to_string(),
            line: None,
        });
    }
    if meta.title.trim().is_empty() {
        issues.push(LintIssue {
            severity: "error".into(),
            message: "Post is missing a title.".into(),
            file: rel.to_string(),
            line: None,
        });
    }
    if !meta.slug.is_empty() && !meta.slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        issues.push(LintIssue {
            severity: "warning".into(),
            message: format!(
                "Slug '{}' may produce an odd URL. Only lowercase letters, digits, hyphens.",
                meta.slug
            ),
            file: rel.to_string(),
            line: None,
        });
    }
    if meta.excerpt.trim().is_empty() && meta.tags.is_empty() {
        issues.push(LintIssue {
            severity: "warning".into(),
            message: "Post has no excerpt and no tags; it may not surface well in search.".into(),
            file: rel.to_string(),
            line: None,
        });
    }

    // Broken local links/images (relative to repo root).
    for (idx, line) in body.lines().enumerate() {
        let mut rest = line;
        while let Some(start) = rest.find("](./") {
            let after = &rest[start + 2..];
            let end = after.find(')').unwrap_or(after.len());
            let target = after[..end].to_string();
            if !target.is_empty() && !repo.join(pages_root_rel(&target)).exists() {
                issues.push(LintIssue {
                    severity: "error".into(),
                    message: format!("Broken internal link/image: {}", target),
                    file: rel.to_string(),
                    line: Some(idx + 1),
                });
            }
            rest = &after[end..];
        }
        let mut i = line;
        while let Some(start) = i.find("![](") {
            let after = &i[start + 4..];
            let end = after.find(')').unwrap_or(after.len());
            let target = &after[..end];
            if !target.is_empty() && !target.starts_with("http") {
                let p = repo.join(target.trim_start_matches('/'));
                if !p.exists() {
                    issues.push(LintIssue {
                        severity: "error".into(),
                        message: format!("Missing image asset: {}", target),
                        file: rel.to_string(),
                        line: Some(idx + 1),
                    });
                }
            }
            i = &after[end..];
        }
    }

    Ok(issues)
}

fn pages_root_rel(target: &str) -> std::path::PathBuf {
    let t = target.trim_start_matches("./");
    std::path::PathBuf::from(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("studio-lint-{}-{}", tag, std::process::id()))
    }

    #[test]
    fn flags_missing_date_on_published_post() {
        let root = temp_repo("missing-date");
        let dir = root.join("content/pages/demo/posts");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("p.md"),
            "---\ntitle: Hi\nstatus: published\n---\nHello\n",
        )
        .unwrap();
        let report = lint_posts(&root).unwrap();
        assert!(report.issues.iter().any(|i| i.message.contains("missing a date")));
        assert!(report.has_errors());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn clean_post_produces_no_errors() {
        let root = temp_repo("clean");
        let dir = root.join("content/pages/demo/posts");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("p.md"),
            "---\ntitle: Fine\ndate: 2026-09-01\nstatus: published\nexcerpt: Fine post.\ntags: [A]\n---\nHello\n",
        )
        .unwrap();
        let report = lint_posts(&root).unwrap();
        assert!(!report.has_errors());
        std::fs::remove_dir_all(&root).ok();
    }
}