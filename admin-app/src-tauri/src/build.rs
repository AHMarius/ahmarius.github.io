use crate::{AppError, AppResult, SettingsJson};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize, Debug, Clone)]
pub struct BuildResult {
    pub success: bool,
    pub output: String,
    pub warnings: Vec<String>,
    pub built_pages: bool,
    pub mode: String,
}

fn args_for_mode(mode: &str) -> Vec<&str> {
    match mode {
        "preview" => vec!["run", "build", "--", "--mode", "preview"],
        "publish" => vec!["run", "build", "--", "--mode", "publish"],
        _ => vec!["run", "build"],
    }
}

fn trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn validate_announcement_link(value: &Option<String>) -> AppResult<Option<String>> {
    let Some(url) = trimmed(value) else {
        return Ok(None);
    };
    let internal = url.starts_with('/') && !url.starts_with("//");
    let secure = url.starts_with("https://")
        && !url["https://".len()..].is_empty()
        && !url.chars().any(char::is_whitespace)
        && !url["https://".len()..].contains('@');
    if url.len() > 500 || url.contains('\\') || (!internal && !secure) {
        return Err(AppError::Validation(
            "Announcement link must be an HTTPS URL or a root-relative site path.".into(),
        ));
    }
    Ok(Some(url))
}

/// Expose site-time settings (giscus/umami) to the Node build pipeline by
/// writing a small *tracked* public config file into the repo before `npm run
/// build`. It contains no secrets — analytics only references the public
/// website ID. Keeping it under content means a clean CI checkout produces
/// exactly the same site as the local preview.
pub fn write_studio_config(repo: &Path, settings: &SettingsJson) -> AppResult<()> {
    let announcement_text = trimmed(&settings.announcement_text);
    if settings.announcement_enabled && announcement_text.is_none() {
        return Err(AppError::Validation(
            "An enabled site announcement needs a message.".into(),
        ));
    }
    if announcement_text
        .as_ref()
        .is_some_and(|text| text.chars().count() > 180)
    {
        return Err(AppError::Validation(
            "Site announcement messages are limited to 180 characters.".into(),
        ));
    }
    let announcement_url = validate_announcement_link(&settings.announcement_url)?;
    let announcement_label = trimmed(&settings.announcement_link_label);
    if announcement_label
        .as_ref()
        .is_some_and(|label| label.chars().count() > 40)
    {
        return Err(AppError::Validation(
            "Site announcement link labels are limited to 40 characters.".into(),
        ));
    }
    let config = serde_json::json!({
        "announcement": {
            "enabled": settings.announcement_enabled,
            "text": announcement_text,
            "url": announcement_url,
            "link_label": announcement_label,
            "dismissible": settings.announcement_dismissible.unwrap_or(true),
        },
        "giscus": {
            "repo_id": settings.giscus_repo_id,
            "category_id": settings.giscus_category_id,
        },
        "umami": {
            "url": settings.umami_url,
            "website_id": settings.umami_website_id,
        },
    });
    let path = repo.join("content").join("site-settings.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError::Command(format!("Could not serialize studio config: {}", e)))?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn build_site(repo: &Path, mode: &str, settings: Option<&SettingsJson>) -> AppResult<BuildResult> {
    if let Some(settings) = settings {
        write_studio_config(repo, settings)?;
    }

    if mode == "publish" {
        run_checked(repo, "npm", &["test"], "Site validation failed")?;
    }

    let out = crate::process::run_captured(
        repo,
        "npm",
        args_for_mode(mode),
        Duration::from_secs(600),
        "Site build",
    )
    .map_err(|e| {
        if e.to_string().contains("could not start") {
            AppError::Command(format!(
                "npm could not be started (in {}). Is Node.js installed and on PATH? Install Node.js from nodejs.org, then restart the app.\n{}",
                repo.display(),
                e
            ))
        } else {
            e
        }
    })?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let combined = format!("{}{}", stdout, stderr);
    let warnings = combined
        .lines()
        .filter(|l| l.to_lowercase().contains("warn"))
        .map(|l| l.to_string())
        .collect();

    if !out.status.success() {
        return Err(AppError::Command(format!(
            "The build failed:\n{}",
            combined.trim()
        )));
    }

    if mode == "publish" {
        run_checked(repo, "node", &["scripts/check-leaks.mjs"], "Draft-leak check failed")?;
    }

    let built_pages = repo.join("pages.html").exists();
    Ok(BuildResult {
        success: true,
        output: combined.trim().to_string(),
        warnings,
        built_pages,
        mode: mode.to_string(),
    })
}

fn run_checked(repo: &Path, program: &str, args: &[&str], label: &str) -> AppResult<()> {
    let out = crate::process::run_captured(
        repo,
        program,
        args,
        Duration::from_secs(600),
        label,
    )
    .map_err(|e| {
        if e.to_string().contains("could not start") {
            AppError::Command(format!("{}: could not start {}: {}", label, program, e))
        } else {
            e
        }
    })?;
    if out.status.success() {
        return Ok(());
    }
    let detail = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Err(AppError::Command(format!("{}:\n{}", label, detail.trim())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SettingsJson;

    fn tmp_repo() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "studio-build-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("content")).unwrap();
        root
    }

    #[test]
    fn studio_config_is_written_tracked_not_ignored() {
        let root = tmp_repo();
        let settings = SettingsJson {
            announcement_enabled: true,
            announcement_text: Some("New portfolio release".to_string()),
            announcement_url: Some("/projects.html".to_string()),
            announcement_link_label: Some("See projects".to_string()),
            announcement_dismissible: Some(false),
            giscus_repo_id: Some("R_abc".to_string()),
            giscus_category_id: Some("DIC_1".to_string()),
            umami_url: Some("https://analytics.example".to_string()),
            umami_website_id: Some("site-1".to_string()),
            ..Default::default()
        };
        write_studio_config(&root, &settings).unwrap();

        let tracked = root.join("content").join("site-settings.json");
        assert!(tracked.is_file(), "config should live in content/ (tracked)");
        assert!(
            !root.join(".studio-config.json").exists(),
            "legacy ignored path must no longer be written"
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&tracked).unwrap()).unwrap();
        assert_eq!(parsed["umami"]["website_id"], "site-1");
        assert_eq!(parsed["giscus"]["repo_id"], "R_abc");
        assert_eq!(parsed["announcement"]["text"], "New portfolio release");
        assert_eq!(parsed["announcement"]["dismissible"], false);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn studio_config_rejects_unsafe_announcement_links() {
        let root = tmp_repo();
        let settings = SettingsJson {
            announcement_enabled: true,
            announcement_text: Some("Unsafe link".to_string()),
            announcement_url: Some("javascript:alert(1)".to_string()),
            ..Default::default()
        };
        assert!(write_studio_config(&root, &settings).is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}
