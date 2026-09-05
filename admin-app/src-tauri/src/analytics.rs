use crate::AppResult;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Debug, Clone)]
pub struct UmamiPayload {
    pub website: String,
    pub hostname: String,
    pub language: String,
    pub title: String,
    pub url: String,
}

#[derive(Serialize, Debug, Clone, Default)]
pub struct AnalyticsSummary {
    pub script_url: Option<String>,
    pub website_id: Option<String>,
    pub tracking_enabled: bool,
}

/// Validate the user-supplied Umami configuration without exposing the API key.
/// Site analytics only ever output the public website ID to the generated HTML
/// (via the <script> tag), never a secret.
pub fn analytics_config(umami_url: &str, website_id: &str) -> AnalyticsSummary {
    let url = umami_url.trim();
    let id = website_id.trim();
    AnalyticsSummary {
        script_url: if url.is_empty() { None } else { Some(format!("{}/script.js", url.trim_end_matches('/'))) },
        website_id: if id.is_empty() { None } else { Some(id.to_string()) },
        tracking_enabled: !url.is_empty() && !id.is_empty(),
    }
}

/// Send a pageview/track event to a self-hosted Umami collector. Fails softly:
/// outages should never break the editor's normal flow.
pub async fn track_event(
    umami_url: &str,
    payload: &UmamiPayload,
    api_key: Option<&str>,
) -> AppResult<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| crate::AppError::Command(format!("Could not build HTTP client: {}", e)))?;
    let mut req = client
        .post(format!("{}/api/send", umami_url.trim_end_matches('/')))
        .json(payload);
    if let Some(key) = api_key.filter(|k| !k.is_empty()) {
        req = req.header("x-umami-api-key", key);
    }
    req.send()
        .await
        .map_err(|e| crate::AppError::Command(format!("Umami track failed: {}", e)))?;
    Ok(())
}

#[allow(dead_code)]
fn sample(url: &str) -> f64 {
    // Stable sample for demo analytics; real sampling is done by Umami.
    let hash: u64 = url.bytes().fold(2166136261, |acc, b| (acc ^ u64::from(b)).wrapping_mul(16777619));
    (hash as f64 % 100.0) / 100.0
}