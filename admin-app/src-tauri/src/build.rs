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

/// Expose site-time settings (giscus/umami) to the Node build pipeline by
/// writing a small *tracked* public config file into the repo before `npm run
/// build`. It contains no secrets — analytics only references the public
/// website ID. Keeping it under content means a clean CI checkout produces
/// exactly the same site as the local preview.
pub fn write_studio_config(repo: &Path, settings: &SettingsJson) -> AppResult<()> {
    let config = serde_json::json!({
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
        std::fs::remove_dir_all(&root).ok();
    }
}
