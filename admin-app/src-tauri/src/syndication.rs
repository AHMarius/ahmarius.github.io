use crate::AppResult;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, Clone, Default)]
pub struct DeployHookResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub detail: String,
}

pub const SYNDICATE_VIA: [&str; 3] = ["none", "mastodon", "bluesky"];

/// Derive a short, URL-safe string from text so cross-post user mentions can be
/// truncated consistently with the guide's companion site (OpenGraph/posts).
pub fn truncate_for_crosspost(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut acc: Vec<char> = text.chars().take(max - 1).collect();
    while let Some(last) = acc.last() {
        if last.is_whitespace() {
            acc.pop();
        } else {
            break;
        }
    }
    acc.push('…');
    acc.into_iter().collect()
}

/// Fire a deploy webhook (e.g. Vercel/Netlify/GitHub Action endpoint). This is
/// non-blocking for the UI: a timeout of a few seconds is applied and failures
/// are surfaced as detail text rather than hard errors.
pub async fn trigger_deploy_hook(hook_url: &str) -> AppResult<DeployHookResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::AppError::Command(format!("Could not build HTTP client: {}", e)))?;
    let resp = client
        .post(hook_url)
        .header("User-Agent", "ahmarius-content-studio/1.0")
        .send()
        .await
        .map_err(|e| crate::AppError::Command(format!("Deploy hook request failed: {}", e)))?;
    let status = resp.status().as_u16();
    let detail = resp
        .text()
        .await
        .map(|t| t.chars().take(500).collect())
        .unwrap_or_default();
    let ok = status >= 200 && status < 300;
    Ok(DeployHookResult {
        ok,
        status: Some(status),
        detail,
    })
}

/// Build a cross-post payload model used by the frontend for previewing what
/// will be posted when a `syndicate_via` target is configured.
#[derive(Serialize, Debug, Clone)]
pub struct CrossPostPreview {
    pub via: String,
    pub text: String,
    pub truncated: bool,
}

pub fn crosspost_preview(title: &str, excerpt: &str, url: &str) -> CrossPostPreview {
    const MAX: usize = 400;
    let raw = match (title, excerpt) {
        (t, e) if !t.trim().is_empty() && !e.trim().is_empty() => format!("{} — {}", t.trim(), e.trim()),
        (t, _) if !t.trim().is_empty() => t.trim().to_string(),
        (_, e) => e.trim().to_string(),
    };
    let with_url = format!("{} {}", raw, url);
    let text = truncate_for_crosspost(&with_url, MAX);
    CrossPostPreview {
        via: String::new(),
        truncated: text.len() < with_url.len(),
        text,
    }
}

#[allow(dead_code)]
pub fn repo_url(repo: &Path) -> String {
    format!("https://github.com/{}", repo.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or("".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_with_ellipsis() {
        let long = "a".repeat(500);
        let out = truncate_for_crosspost(&long, 400);
        assert_eq!(out.chars().count(), 400);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn short_text_untouched() {
        assert_eq!(truncate_for_crosspost("hi", 400), "hi");
    }

    #[test]
    fn crosspost_preview_has_url() {
        let p = crosspost_preview("Title", "Excerpt", "https://example.com/x");
        assert!(p.text.contains("https://example.com/x"));
        assert!(p.text.contains("Title"));
    }
}