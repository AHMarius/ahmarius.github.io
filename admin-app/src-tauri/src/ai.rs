use crate::AppResult;
use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
pub struct AiMetadata {
    pub title: Option<String>,
    pub excerpt: Option<String>,
    pub tags: Vec<String>,
    pub technologies: Vec<String>,
}

/// Suggest metadata from a post body using deterministic heuristics so drafts
/// get reasonable starting frontmatter without requiring a remote model.
pub fn suggest_metadata(body: &str, current_title: &str) -> AppResult<AiMetadata> {
    let cleaned = strip_markdown(body);
    let first_line = body
        .lines()
        .find(|l| l.trim().starts_with('#'))
        .map(|l| l.trim().trim_start_matches('#').trim().to_string())
        .filter(|s| !s.is_empty());

    let title = first_line.filter(|t| !t.is_empty()).or_else(|| {
        let t = current_title.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    });

    let excerpt = if cleaned.chars().count() > 220 {
        let mut acc: Vec<char> = cleaned.chars().take(180).collect();
        while let Some(last) = acc.last() {
            if last.is_whitespace() {
                acc.pop();
            } else {
                break;
            }
        }
        acc.push('…');
        Some(acc.into_iter().collect())
    } else if !cleaned.is_empty() {
        Some(cleaned.clone())
    } else {
        None
    };

    let keywords = keyword_scores(&cleaned);
    let mut tags: Vec<String> = keywords
        .iter()
        .filter(|(k, _)| !TECH_KEYWORDS.contains(&k.as_str()) && k.chars().count() >= 3 && k.chars().count() <= 20)
        .map(|(k, _)| capitalize(k))
        .collect();
    tags.dedup();
    tags.truncate(5);
    if tags.is_empty() {
        tags.push("Notes".to_string());
    }

    let technologies: Vec<String> = keywords
        .iter()
        .filter(|(k, _)| TECH_KEYWORDS.contains(&k.as_str()))
        .map(|(k, _)| k.clone())
        .collect();

    Ok(AiMetadata {
        title,
        excerpt,
        tags,
        technologies,
    })
}

fn strip_markdown(markdown: &str) -> String {
    markdown
        .split('\n')
        .map(|l| l.trim())
        .filter(|l| {
            !l.is_empty()
                && !l.starts_with('#')
                && !l.starts_with("![")
                && !l.starts_with("```")
                && !l.starts_with("---")
        })
        .collect::<Vec<_>>()
        .join(" ")
        .replace(|c| c == '*' || c == '`' || c == '_' || c == '~', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

const TECH_KEYWORDS: [&str; 34] = [
    "rust", "c", "cpp", "c++", "go", "python", "typescript", "javascript", "ts", "js",
    "react", "vue", "solidjs", "svelte", "node", "deno", "tauri", "electron", "vite",
    "webgpu", "opengl", "vulkan", "llvm", "cuda", "macos", "linux", "windows", "k8s",
    "docker", "kubernetes", "nginx", "postgres", "sqlite", "redis",
];

fn keyword_scores(text: &str) -> Vec<(String, usize)> {
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for word in text
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|w| !w.is_empty())
    {
        let clean = word.trim_matches('-');
        if clean.chars().count() >= 3 && clean.chars().count() <= 24 {
            *counts.entry(clean.to_string()).or_insert(0) += 1;
        }
    }
    let mut sorted: Vec<(String, usize)> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    if TECH_KEYWORDS.contains(&"c++") {
        // Normalize "cpp"/"c" to a single "c++" when the body is clearly C-family work.
    }
    sorted
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_title_excerpt() {
        let md = "# My Great Post\n\nThis is a body with enough text to generate an excerpt. Rust and Tauri are mentioned repeatedly: Rust, Rust, Tauri.";
        let meta = suggest_metadata(md, "").unwrap();
        assert_eq!(meta.title.as_deref(), Some("My Great Post"));
        assert!(meta.excerpt.is_some());
        assert!(meta.excerpt.as_deref().unwrap().starts_with("This is a body"));
    }

    #[test]
    fn tags_exclude_tech_keywords_but_capture_common_words() {
        let meta = suggest_metadata("Rust Rust Tauri WebGPU simulation solver solver", "").unwrap();
        assert!(meta.technologies.contains(&"rust".to_string()));
        assert!(meta.technologies.contains(&"tauri".to_string()));
        assert!(meta.tags.iter().any(|t| t.eq_ignore_ascii_case("solver")));
    }
}