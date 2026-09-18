use crate::{AppError, AppResult, ensure_safe_slug, resolve_in_repo};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const PAGE_FILE: &str = "page.yml";
const POSTS_DIR: &str = "posts";
const SUBPAGES_DIR: &str = "subpages";
const PROJECTS_DIR: &str = "content/projects";
const PROJECT_FILE: &str = "project.yml";
const TRASH_DIR: &str = ".trash";
const TRASH_MANIFEST: &str = ".restore.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProjectInput {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub repo_url: String,
    #[serde(default)]
    pub live_url: String,
    #[serde(default)]
    pub status: String, // active | paused | archived
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cover: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ProjectRow {
    pub slug: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub repo_url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub live_url: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub cover: String,
    #[serde(default)]
    pub post_count: usize,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PostMeta {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub updated_date: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub publish_at: String,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub featured: bool,
    #[serde(default = "default_comments")]
    pub comments: bool,
    #[serde(default)]
    pub page: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub series: String,
    #[serde(default)]
    pub part: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub technologies: Vec<String>,
}

impl Default for PostMeta {
    fn default() -> Self {
        Self {
            title: String::new(),
            slug: String::new(),
            date: String::new(),
            updated_date: String::new(),
            status: String::new(),
            publish_at: String::new(),
            excerpt: String::new(),
            featured: false,
            comments: true,
            page: String::new(),
            project: String::new(),
            subtitle: String::new(),
            cover: String::new(),
            series: String::new(),
            part: 0,
            tags: Vec::new(),
            technologies: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PostInput {
    pub page_slug: String,
    /// Present only when editing an existing post. This makes a slug change an
    /// explicit rename rather than accidentally creating a duplicate post.
    #[serde(default)]
    pub original_slug: String,
    /// Per-editor-session asset folder used before a new post receives its
    /// final slug.
    #[serde(default)]
    pub draft_asset_slug: String,
    pub meta: PostMeta,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PageInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub order: Option<i64>,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub devlog_repo: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct PostRow {
    pub title: String,
    pub slug: String,
    pub date: String,
    pub updated_date: String,
    pub status: String,
    pub publish_at: String,
    pub excerpt: String,
    pub featured: bool,
    pub comments: bool,
    pub page: String,
    pub project: String,
    pub tags: Vec<String>,
    pub technologies: Vec<String>,
    pub series: String,
    pub part: i64,
    pub body: String,
    pub path: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct PageRow {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub cover: String,
    pub parent: Option<String>,
    pub order: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub devlog_repo: String,
    pub path: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ContentNode {
    pub id: String,
    pub type_: String, // "page" | "post"
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cover: String,
    pub status: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String, // "page" | "devlog" (page nodes only)
    #[serde(default)]
    pub updated_date: String,
    #[serde(default)]
    pub children: Vec<ContentNode>,
}

fn yaml_string(key: &str, value: &str) -> String {
    // JSON strings are valid YAML scalars and correctly preserve quotes,
    // backslashes, Unicode and line breaks.
    format!("{}: {}", key, serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into()))
}

fn yaml_list(items: &[String]) -> String {
    if items.is_empty() {
        return "  []".to_string();
    }
    items
        .iter()
        .map(|i| format!("  - {}", serde_json::to_string(i).unwrap_or_else(|_| "\"\"".into())))
        .collect::<Vec<_>>()
        .join("\n")
}

fn default_comments() -> bool {
    true
}

pub fn serialize_post(meta: &PostMeta, body: &str) -> String {
    let mut lines = vec!["---".to_string()];
    lines.push(yaml_string("title", &meta.title));
    lines.push(yaml_string("slug", &meta.slug));
    if !meta.date.is_empty() {
        lines.push(yaml_string("date", &meta.date));
    }
    if !meta.updated_date.is_empty() {
        lines.push(yaml_string("updatedDate", &meta.updated_date));
    }
    if !meta.status.is_empty() {
        lines.push(yaml_string("status", &meta.status));
    }
    if !meta.publish_at.is_empty() {
        lines.push(yaml_string("publishAt", &meta.publish_at));
    }
    if meta.featured {
        lines.push("featured: true".to_string());
    }
    if !meta.comments {
        lines.push("comments: false".to_string());
    }
    if !meta.page.is_empty() {
        lines.push(yaml_string("page", &meta.page));
    }
    if !meta.project.is_empty() {
        lines.push(yaml_string("project", &meta.project));
    }
    if !meta.subtitle.is_empty() {
        lines.push(yaml_string("subtitle", &meta.subtitle));
    }
    if !meta.cover.is_empty() {
        lines.push(yaml_string("cover", &meta.cover));
    }
    if !meta.series.is_empty() {
        lines.push(yaml_string("series", &meta.series));
    }
    if meta.part > 0 {
        lines.push(format!("part: {}", meta.part));
    }
    if !meta.excerpt.is_empty() {
        lines.push(yaml_string("excerpt", &meta.excerpt));
    }
    lines.push("technologies:".to_string());
    lines.push(yaml_list(&meta.technologies));
    lines.push("tags:".to_string());
    lines.push(yaml_list(&meta.tags));
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push(body.trim().to_string());
    lines.join("\n") + "\n"
}

pub fn serialize_page(page: &PageInput) -> String {
    let mut out = String::new();
    // Page metadata is consumed by the same frontmatter parser as posts.
    // Without these delimiters a page created in the studio looks valid to the
    // Rust editor but is invisible/broken in the Node publish pipeline.
    out.push_str("---\n");
    out.push_str(&yaml_string("name", &page.name));
    out.push('\n');
    out.push_str(&yaml_string("slug", &page.slug));
    out.push('\n');
    if !page.description.is_empty() {
        out.push_str(&yaml_string("description", &page.description));
        out.push('\n');
    }
    if !page.cover.is_empty() {
        out.push_str(&yaml_string("cover", &page.cover));
        out.push('\n');
    }
    out.push_str(&yaml_string("kind", if page.kind.is_empty() { "page" } else { &page.kind }));
    out.push('\n');
    if !page.devlog_repo.is_empty() {
        out.push_str(&yaml_string("devlog_repo", &page.devlog_repo));
        out.push('\n');
    }
    match &page.parent {
        Some(p) if !p.is_empty() => {
            out.push_str(&yaml_string("parent", p));
            out.push('\n');
        }
        _ => {
            out.push_str("parent: null\n");
        }
    }
    out.push_str(&format!("order: {}\n", page.order.unwrap_or(100)));
    out.push_str("---\n");
    out
}

fn line_items(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    trimmed
        .strip_prefix("- ")
        .map(|item| item.trim().trim_matches('"'))
}

fn parse_scalar(raw: &str) -> String {
    let value = raw.trim();
    if value.starts_with('"') {
        return serde_json::from_str::<String>(value).unwrap_or_else(|_| value.trim_matches('"').to_string());
    }
    value.trim_matches('\'').to_string()
}

pub fn parse_post(raw: &str) -> (PostMeta, String) {
    let mut meta = PostMeta {
        title: String::new(),
        slug: String::new(),
        date: String::new(),
        updated_date: String::new(),
        status: String::new(),
        publish_at: String::new(),
        excerpt: String::new(),
        featured: false,
        comments: true,
        page: String::new(),
        project: String::new(),
        subtitle: String::new(),
        cover: String::new(),
        series: String::new(),
        part: 0,
        tags: Vec::new(),
        technologies: Vec::new(),
    };
    let mut body_start = 0usize;
    let mut current_list: Option<&str> = None;
    if let Some(rest) = raw.strip_prefix("---\n") {
        let end = rest.find("\n---").map(|i| i + 4).unwrap_or(rest.len());
        let front = &rest[..end];
        body_start = end + 2;
        for line in front.lines() {
            if line.is_empty() {
                continue;
            }
            if let Some(item) = line_items(line) {
                if let Some(list) = current_list {
                    match list {
                        "tags" => meta.tags.push(parse_scalar(item)),
                        "technologies" => meta.technologies.push(parse_scalar(item)),
                        _ => {}
                    }
                }
                continue;
            }
            current_list = None;
            if let Some(kv) = line.split_once(':') {
                let key = kv.0.trim();
                let value = parse_scalar(kv.1);
                if value.is_empty() {
                    if key == "tags" {
                        current_list = Some("tags");
                    } else if key == "technologies" {
                        current_list = Some("technologies");
                    }
                    continue;
                }
                match key {
                    "title" => meta.title = value,
                    "slug" => meta.slug = value,
                    "date" => meta.date = value,
                    "updatedDate" => meta.updated_date = value,
                    "status" => meta.status = value,
                    "publishAt" | "publish_at" => meta.publish_at = value,
                    "excerpt" => meta.excerpt = value,
                    "featured" => meta.featured = value == "true",
                    "comments" => meta.comments = value != "false",
                    "page" => meta.page = value,
                    "project" => meta.project = value,
                    "subtitle" => meta.subtitle = value,
                    "cover" => meta.cover = value,
                    "series" => meta.series = value,
                    "part" => meta.part = value.parse().unwrap_or(0),
                    _ => {}
                }
            }
        }
    }
    let body = if raw.len() > body_start {
        raw[body_start.min(raw.len())..].trim().to_string()
    } else {
        String::new()
    };
    (meta, body)
}

fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    let tmp = path.with_extension(format!("tmp-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------- Pages ----------

pub fn page_dir_of(repo: &Path, slug: &str) -> AppResult<PathBuf> {
    ensure_safe_slug(slug)?;
    let matches = find_page_dirs(repo, slug)?;
    if matches.len() > 1 {
        return Err(AppError::Validation(format!(
            "Page slug '{}' is duplicated in the content hierarchy.",
            slug
        )));
    }
    if let Some(found) = matches.into_iter().next() {
        return Ok(found);
    }
    resolve_in_repo(repo, &format!("content/pages/{}", slug))
}

fn find_page_dirs(repo: &Path, slug: &str) -> AppResult<Vec<PathBuf>> {
    let root = resolve_in_repo(repo, "content/pages")?;
    fn search(dir: &Path, slug: &str, found: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let page = entry.path();
            if !page.is_dir() {
                continue;
            }
            if entry.file_name().to_string_lossy() == slug
                && (page.join(PAGE_FILE).exists() || page.join(POSTS_DIR).is_dir())
            {
                found.push(page.clone());
            }
            let children = page.join(SUBPAGES_DIR);
            if children.is_dir() {
                search(&children, slug, found);
            }
        }
    }
    let mut found = Vec::new();
    search(&root, slug, &mut found);
    Ok(found)
}

pub fn list_pages(repo: &Path) -> AppResult<Vec<PageRow>> {
    let pages_root = resolve_in_repo(repo, "content/pages")?;
    let mut out = vec![];
    if let Ok(entries) = std::fs::read_dir(&pages_root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_page(repo, &p, &mut out)?;
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    for page in &out {
        if !seen.insert(page.slug.clone()) {
            return Err(AppError::Validation(format!(
                "Page slug '{}' is duplicated in the content hierarchy.",
                page.slug
            )));
        }
    }
    out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

fn collect_page(repo: &Path, dir: &Path, out: &mut Vec<PageRow>) -> AppResult<()> {
    let page_file = dir.join(PAGE_FILE);
    if page_file.exists() {
        let slug = dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let raw = std::fs::read_to_string(&page_file).unwrap_or_default();
        let (mut meta, _) = parse_page_raw(&raw);
        if meta.name.is_empty() {
            meta.name = slug.clone();
        }
        // find parent from path segmentation
        let parent = find_parent_from_path(repo, dir);
        if meta.parent != parent {
            return Err(AppError::Validation(format!(
                "Page '{}' declares parent {:?}, but its directory is under {:?}.",
                slug, meta.parent, parent
            )));
        }
        out.push(PageRow {
            slug: meta.slug.clone().unwrap_or_else(|| slug.clone()),
            name: meta.name,
            description: meta.description,
            cover: meta.cover,
            parent,
            order: meta.order,
            kind: meta.kind,
            devlog_repo: meta.devlog_repo,
            path: dir.display().to_string(),
        });
    }
    // subpages
    let subpages = dir.join(SUBPAGES_DIR);
    if subpages.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&subpages) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    collect_page(repo, &p, out)?;
                }
            }
        }
    }
    Ok(())
}

fn find_parent_from_path(repo: &Path, page_dir: &Path) -> Option<String> {
    let rel = page_dir
        .strip_prefix(repo)
        .ok()?
        .to_string_lossy()
        .to_string();
    let parts: Vec<&str> = rel.split('/').collect();
    // content/pages/<slug>/subpages/<child>  -> parent is parts[2]
    for i in (0..parts.len()).rev() {
        if parts[i] == SUBPAGES_DIR && i + 1 < parts.len() {
            return Some(parts[i - 1].to_string());
        }
    }
    None
}

struct PageMeta {
    name: String,
    slug: Option<String>,
    description: String,
    cover: String,
    order: i64,
    parent: Option<String>,
    kind: String,
    devlog_repo: String,
}

fn parse_page_raw(raw: &str) -> (PageMeta, ()) {
    let mut meta = PageMeta {
        name: String::new(),
        slug: None,
        description: String::new(),
        cover: String::new(),
        order: 100,
        parent: None,
        kind: "page".to_string(),
        devlog_repo: String::new(),
    };
    for line in raw.lines() {
        if let Some(kv) = line.split_once(':') {
            let key = kv.0.trim();
            let value = kv.1.trim().trim_matches('"').to_string();
            match key {
                "name" => meta.name = value,
                "slug" => meta.slug = Some(value),
                "description" => meta.description = value,
                "cover" => meta.cover = value,
                "kind" => meta.kind = value,
                "devlog_repo" => meta.devlog_repo = value,
                "order" => {
                    meta.order = value.parse().unwrap_or(100);
                }
                "parent" if value != "null" && !value.is_empty() => {
                    meta.parent = Some(value);
                }
                _ => {}
            }
        }
    }
    (meta, ())
}

pub fn read_page(repo: &Path, slug: &str) -> AppResult<serde_json::Value> {
    let dir = page_dir_of(repo, slug)?;
    let raw = std::fs::read_to_string(dir.join(PAGE_FILE))
        .map_err(|_| AppError::Validation(format!("Page not found: {}", slug)))?;
    let (meta, _) = parse_page_raw(&raw);
    let parent = find_parent_from_path(repo, &dir).or(meta.parent.clone());
    Ok(serde_json::json!({
        "name": meta.name,
        "slug": meta.slug.unwrap_or_else(|| slug.to_string()),
        "description": meta.description,
        "cover": meta.cover,
        "order": meta.order,
        "kind": meta.kind,
        "devlog_repo": meta.devlog_repo,
        "parent": parent,
    }))
}

pub fn create_page(repo: &Path, page: &PageInput) -> AppResult<PageRow> {
    let slug = if page.slug.is_empty() {
        slugify(&page.name)
    } else {
        page.slug.clone()
    };
    ensure_safe_slug(&slug)?;
    if !find_page_dirs(repo, &slug)?.is_empty() {
        return Err(AppError::Validation(format!("Page already exists: {}", slug)));
    }
    if page.parent.as_deref() == Some(slug.as_str()) {
        return Err(AppError::Validation("A page cannot be its own parent.".into()));
    }
    let dir = match &page.parent {
        Some(p) if !p.is_empty() => {
            ensure_safe_slug(p)?;
            let parent_dir = page_dir_of(repo, p)?;
            if !parent_dir.join(PAGE_FILE).exists() {
                return Err(AppError::Validation(format!("Parent page does not exist: {}", p)));
            }
            let root = repo.canonicalize().map_err(AppError::from)?;
            let parent_rel = parent_dir
                .strip_prefix(&root)
                .or_else(|_| parent_dir.strip_prefix(repo))
                .map_err(|_| AppError::Validation("Parent page escaped the repository.".into()))?;
            let child_rel = parent_rel.join(SUBPAGES_DIR).join(&slug);
            resolve_in_repo(repo, &child_rel.to_string_lossy())?
        }
        _ => page_dir_of(repo, &slug)?,
    };
    if dir.join(PAGE_FILE).exists() {
        return Err(AppError::Validation(format!("Page already exists: {}", slug)));
    }
    std::fs::create_dir_all(&dir)?;
    let input = PageInput {
        name: page.name.clone(),
        slug: slug.clone(),
        description: page.description.clone(),
        cover: page.cover.clone(),
        parent: page.parent.clone(),
        order: page.order,
        kind: page.kind.clone(),
        devlog_repo: page.devlog_repo.clone(),
    };
    atomic_write(&dir.join(PAGE_FILE), &serialize_page(&input))?;
    std::fs::create_dir_all(dir.join(POSTS_DIR))?;
    Ok(PageRow {
        slug,
        name: input.name,
        description: input.description,
        cover: input.cover,
        parent: input.parent,
        order: input.order.unwrap_or(100),
        kind: input.kind,
        devlog_repo: input.devlog_repo,
        path: dir.display().to_string(),
    })
}

pub fn update_page(repo: &Path, original_slug: &str, page: &PageInput) -> AppResult<()> {
    let slug = ensure_safe_slug(&page.slug)?;
    let original_slug = ensure_safe_slug(original_slug)?;
    let original_dir = page_dir_of(repo, &original_slug)?;
    if !original_dir.join(PAGE_FILE).exists() {
        return Err(AppError::Validation(format!("Page not found: {}.", original_slug)));
    }
    if page.parent.as_deref() == Some(slug.as_str())
        || page.parent.as_deref() == Some(original_slug.as_str())
    {
        return Err(AppError::Validation("A page cannot be its own parent.".into()));
    }
    if slug != original_slug && !find_page_dirs(repo, &slug)?.is_empty() {
        return Err(AppError::Validation(format!("Page already exists: {}", slug)));
    }

    let destination = match page.parent.as_deref().filter(|parent| !parent.is_empty()) {
        Some(parent) => {
            let parent = ensure_safe_slug(parent)?;
            let parent_dir = page_dir_of(repo, &parent)?;
            if !parent_dir.join(PAGE_FILE).exists() {
                return Err(AppError::Validation(format!("Parent page does not exist: {}", parent)));
            }
            let original_canon = original_dir.canonicalize()?;
            let parent_canon = parent_dir.canonicalize()?;
            if parent_canon.starts_with(&original_canon) {
                return Err(AppError::Validation("A page cannot be moved below one of its descendants.".into()));
            }
            parent_dir.join(SUBPAGES_DIR).join(&slug)
        }
        None => resolve_in_repo(repo, &format!("content/pages/{}", slug))?,
    };

    let moved = destination != original_dir;
    if moved {
        if destination.exists() {
            return Err(AppError::Validation(format!("Page destination already exists: {}", slug)));
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&original_dir, &destination)?;
    }
    if let Err(error) = atomic_write(&destination.join(PAGE_FILE), &serialize_page(page)) {
        if moved {
            let _ = std::fs::rename(&destination, &original_dir);
        }
        return Err(error);
    }
    if slug != original_slug {
        rewrite_direct_child_parents(&destination, &slug)?;
        rewrite_direct_posts_page(&destination, &original_slug, &slug)?;
        move_generated_page_assets(repo, &original_slug, &slug)?;
    }
    Ok(())
}

fn rewrite_direct_child_parents(page_dir: &Path, parent_slug: &str) -> AppResult<()> {
    let children = page_dir.join(SUBPAGES_DIR);
    let Ok(entries) = std::fs::read_dir(children) else { return Ok(()) };
    for entry in entries.flatten() {
        let file = entry.path().join(PAGE_FILE);
        if !file.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&file)?;
        let (meta, _) = parse_page_raw(&raw);
        let input = PageInput {
            name: meta.name,
            slug: meta.slug.unwrap_or_else(|| entry.file_name().to_string_lossy().to_string()),
            description: meta.description,
            cover: meta.cover,
            parent: Some(parent_slug.to_string()),
            order: Some(meta.order),
            kind: meta.kind,
            devlog_repo: meta.devlog_repo,
        };
        atomic_write(&file, &serialize_page(&input))?;
    }
    Ok(())
}

fn rewrite_direct_posts_page(page_dir: &Path, old_slug: &str, new_slug: &str) -> AppResult<()> {
    let posts = page_dir.join(POSTS_DIR);
    let Ok(entries) = std::fs::read_dir(posts) else { return Ok(()) };
    for entry in entries.flatten() {
        let file = entry.path();
        if file.extension().is_some_and(|extension| extension == "md") {
            let raw = std::fs::read_to_string(&file)?;
            let (mut meta, body) = parse_post(&raw);
            if meta.page.is_empty() || meta.page == old_slug {
                meta.page = new_slug.to_string();
                atomic_write(&file, &serialize_post(&meta, &body))?;
            }
        }
    }
    Ok(())
}

fn move_generated_page_assets(repo: &Path, old_slug: &str, new_slug: &str) -> AppResult<()> {
    for prefix in ["assets/pages", "assets/posts", "pages"] {
        let old = resolve_in_repo(repo, &format!("{}/{}", prefix, old_slug))?;
        if !old.exists() {
            continue;
        }
        let new = resolve_in_repo(repo, &format!("{}/{}", prefix, new_slug))?;
        if new.exists() {
            return Err(AppError::Validation(format!(
                "Cannot rename generated path because it already exists: {}/{}",
                prefix, new_slug
            )));
        }
        if let Some(parent) = new.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(old, new)?;
    }
    Ok(())
}

pub fn delete_page(repo: &Path, slug: &str) -> AppResult<()> {
    let slug = ensure_safe_slug(slug)?;
    let dir = page_dir_of(repo, &slug)?;
    let mut page_slugs = Vec::new();
    let mut entries: Vec<(String, String)> = Vec::new();
    collect_page_descendants(&dir, &mut page_slugs, &mut entries);
    let mut moved: Vec<(PathBuf, String)> = Vec::new();
    if dir.exists() {
        let original = repo_relative(repo, &dir)?;
        moved.push((dir.clone(), original));
    }
    // Trash every staged asset copy (page cover + each post's published
    // assets) so restore brings back images and covers, not just the .md files.
    for (page, post) in &entries {
        let staged_rel = format!("assets/posts/{}/{}", page, post);
        if let Ok(path) = resolve_in_repo(repo, &staged_rel) {
            if path.exists() {
                moved.push((path, staged_rel));
            }
        }
    }
    for page in &page_slugs {
        if let Ok(path) = resolve_in_repo(repo, &format!("assets/pages/{}", page)) {
            if path.exists() {
                moved.push((path, format!("assets/pages/{}", page)));
            }
        }
    }
    if !moved.is_empty() {
        let refs: Vec<(&Path, &str)> = moved.iter().map(|(p, s)| (p.as_path(), s.as_str())).collect();
        move_to_trash(repo, "page", &slug, &refs)?;
    }
    for (page, post) in &entries {
        remove_staged_post_assets(repo, page, post);
        let _ = remove_generated(repo, &format!("devlog/{}.html", post));
    }
    for page in &page_slugs {
        remove_staged_page_assets(repo, page);
        let _ = remove_generated(repo, &format!("pages/{}", page));
    }
    Ok(())
}

fn collect_page_descendants(
    dir: &Path,
    pages: &mut Vec<String>,
    posts: &mut Vec<(String, String)>,
) {
    let Some(page_slug) = dir.file_name().map(|name| name.to_string_lossy().to_string()) else {
        return;
    };
    pages.push(page_slug.clone());
    for post in post_slugs_in(&dir.join(POSTS_DIR)) {
        posts.push((page_slug.clone(), post));
    }
    let children = dir.join(SUBPAGES_DIR);
    let Ok(entries) = std::fs::read_dir(children) else { return };
    for child in entries.flatten() {
        if child.path().is_dir() {
            collect_page_descendants(&child.path(), pages, posts);
        }
    }
}

// ---------- Projects ----------

pub fn project_dir_of(repo: &Path, slug: &str) -> AppResult<PathBuf> {
    ensure_safe_slug(slug)?;
    resolve_in_repo(repo, &format!("{}/{}", PROJECTS_DIR, slug))
}

pub fn list_projects(repo: &Path) -> AppResult<Vec<ProjectRow>> {
    let root = resolve_in_repo(repo, PROJECTS_DIR)?;
    let mut out = vec![];
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_project(repo, &p, &mut out)?;
            }
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

fn collect_project(repo: &Path, dir: &Path, out: &mut Vec<ProjectRow>) -> AppResult<()> {
    let file = dir.join(PROJECT_FILE);
    if !file.exists() {
        return Ok(());
    }
    let slug = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let raw = std::fs::read_to_string(&file).unwrap_or_default();
    let meta = parse_project_raw(&raw);
    let post_count = posts_in_project(repo, &slug)?;
    out.push(ProjectRow {
        slug: meta.slug.unwrap_or_else(|| slug.clone()),
        name: if meta.name.is_empty() {
            slug.clone()
        } else {
            meta.name
        },
        repo_url: meta.repo_url,
        live_url: meta.live_url,
        status: meta.status,
        description: meta.description,
        cover: meta.cover,
        post_count,
        path: dir.display().to_string(),
    });
    Ok(())
}

fn posts_in_project(repo: &Path, slug: &str) -> AppResult<usize> {
    let pages = list_pages(repo)?;
    let mut count = 0usize;
    for page in pages {
        let posts_dir = page_dir_of(repo, &page.slug)?.join(POSTS_DIR);
        if !posts_dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&posts_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map(|e| e == "md").unwrap_or(false) {
                    if let Ok(raw) = std::fs::read_to_string(&p) {
                        let (m, _) = parse_post(&raw);
                        if m.project == slug {
                            count += 1;
                        }
                    }
                }
            }
        }
    }
    Ok(count)
}

struct ProjectMeta {
    name: String,
    slug: Option<String>,
    repo_url: String,
    live_url: String,
    status: String,
    description: String,
    cover: String,
}

fn parse_project_raw(raw: &str) -> ProjectMeta {
    let mut meta = ProjectMeta {
        name: String::new(),
        slug: None,
        repo_url: String::new(),
        live_url: String::new(),
        status: "active".to_string(),
        description: String::new(),
        cover: String::new(),
    };
    for line in raw.lines() {
        if let Some(kv) = line.split_once(':') {
            let key = kv.0.trim();
            let value = kv.1.trim().trim_matches('"').to_string();
            match key {
                "name" => meta.name = value,
                "slug" => meta.slug = Some(value),
                "repo_url" => meta.repo_url = value,
                "live_url" => meta.live_url = value,
                "status" => meta.status = value,
                "description" => meta.description = value,
                "cover" => meta.cover = value,
                _ => {}
            }
        }
    }
    meta
}

fn serialize_project(p: &ProjectInput) -> String {
    let mut lines: Vec<String> = vec![];
    lines.push(yaml_string("name", &p.name));
    lines.push(yaml_string("slug", &p.slug));
    if !p.repo_url.is_empty() {
        lines.push(yaml_string("repo_url", &p.repo_url));
    }
    if !p.live_url.is_empty() {
        lines.push(yaml_string("live_url", &p.live_url));
    }
    if !p.status.is_empty() {
        lines.push(yaml_string("status", &p.status));
    }
    if !p.description.is_empty() {
        lines.push(yaml_string("description", &p.description));
    }
    if !p.cover.is_empty() {
        lines.push(yaml_string("cover", &p.cover));
    }
    lines.join("\n")
}

pub fn read_project(repo: &Path, slug: &str) -> AppResult<serde_json::Value> {
    let dir = project_dir_of(repo, slug)?;
    let raw = std::fs::read_to_string(dir.join(PROJECT_FILE))
        .map_err(|_| AppError::Validation(format!("Project not found: {}", slug)))?;
    let meta = parse_project_raw(&raw);
    Ok(serde_json::json!({
        "name": meta.name,
        "slug": meta.slug.unwrap_or_else(|| slug.to_string()),
        "repo_url": meta.repo_url,
        "live_url": meta.live_url,
        "status": meta.status,
        "description": meta.description,
        "cover": meta.cover,
        "post_count": posts_in_project(repo, slug)?,
    }))
}

pub fn create_project(repo: &Path, project: &ProjectInput) -> AppResult<ProjectRow> {
    let slug = if project.slug.is_empty() {
        slugify(&project.name)
    } else {
        project.slug.clone()
    };
    ensure_safe_slug(&slug)?;
    let dir = project_dir_of(repo, &slug)?;
    if dir.join(PROJECT_FILE).exists() {
        return Err(AppError::Validation(format!(
            "Project already exists: {}",
            slug
        )));
    }
    std::fs::create_dir_all(&dir)?;
    let mut ours = project.clone();
    ours.slug = slug.clone();
    if ours.name.is_empty() {
        ours.name = slug.clone();
    }
    if ours.status.is_empty() {
        ours.status = "active".to_string();
    }
    atomic_write(&dir.join(PROJECT_FILE), &serialize_project(&ours))?;
    Ok(ProjectRow {
        slug,
        name: ours.name,
        repo_url: ours.repo_url,
        live_url: ours.live_url,
        status: ours.status,
        description: ours.description,
        cover: ours.cover,
        post_count: 0,
        path: dir.display().to_string(),
    })
}

pub fn update_project(repo: &Path, project: &ProjectInput) -> AppResult<()> {
    let slug = ensure_safe_slug(&project.slug)?;
    let dir = project_dir_of(repo, &slug)?;
    if !dir.join(PROJECT_FILE).exists() {
        return Err(AppError::Validation(format!("Project not found: {}", slug)));
    }
    atomic_write(&dir.join(PROJECT_FILE), &serialize_project(project))?;
    Ok(())
}

pub fn delete_project(repo: &Path, slug: &str) -> AppResult<()> {
    let slug = ensure_safe_slug(slug)?;
    let dir = project_dir_of(repo, &slug)?;
    let mut moved: Vec<(PathBuf, String)> = Vec::new();
    if dir.exists() {
        moved.push((dir.clone(), format!("{}/{}", PROJECTS_DIR, slug)));
    }
    if let Ok(path) = resolve_in_repo(repo, &format!("assets/projects/{}", slug)) {
        if path.exists() {
            moved.push((path, format!("assets/projects/{}", slug)));
        }
    }
    if !moved.is_empty() {
        let refs: Vec<(&Path, &str)> = moved.iter().map(|(p, s)| (p.as_path(), s.as_str())).collect();
        move_to_trash(repo, "project", &slug, &refs)?;
    }
    remove_staged_page_assets(repo, &slug);
    let _ = remove_generated(repo, &format!("projects/{}", slug));
    Ok(())
}

// ---------- Posts ----------

pub fn post_file_of(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<PathBuf> {
    ensure_safe_slug(page_slug)?;
    ensure_safe_slug(post_slug)?;
    let page_dir = page_dir_of(repo, page_slug)?;
    let direct = page_dir
        .join(POSTS_DIR)
        .join(format!("{}.md", post_slug));
    Ok(direct)
}

/// Resolve the canonical per-post asset directory for top-level and nested
/// pages alike. The returned directory may not exist yet, but every existing
/// ancestor has passed the repository/symlink boundary check.
pub fn post_assets_dir_of(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<PathBuf> {
    let post_file = post_file_of(repo, page_slug, post_slug)?;
    let repo_root = repo.canonicalize().map_err(AppError::from)?;
    let relative_post = post_file
        .strip_prefix(&repo_root)
        .or_else(|_| post_file.strip_prefix(repo))
        .map_err(|_| AppError::Validation("Post path escaped the repository.".into()))?;
    let relative_assets = relative_post.with_extension("").join("assets");
    resolve_in_repo(repo, &relative_assets.to_string_lossy())
}

pub fn list_posts(repo: &Path) -> AppResult<Vec<PostRow>> {
    let pages = list_pages(repo)?;
    let mut out = vec![];
    for page in pages {
        let posts_dir = page_dir_of(repo, &page.slug)?.join(POSTS_DIR);
        if !posts_dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&posts_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map(|e| e == "md").unwrap_or(false) {
                    out.push(read_post_from_path(repo, &page.slug, &p)?);
                }
            }
        }
    }
    Ok(out)
}

fn read_post_from_path(_repo: &Path, page_slug: &str, path: &Path) -> AppResult<PostRow> {
    let raw = std::fs::read_to_string(path)?;
    let (meta, body) = parse_post(&raw);
    let slug = if meta.slug.is_empty() {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        meta.slug.clone()
    };
    Ok(PostRow {
        title: meta.title,
        slug,
        date: meta.date,
        updated_date: meta.updated_date,
        status: if meta.status.is_empty() {
            "draft".to_string()
        } else {
            meta.status
        },
        publish_at: meta.publish_at,
        excerpt: meta.excerpt,
        featured: meta.featured,
        comments: meta.comments,
        page: page_slug.to_string(),
        project: meta.project,
        tags: meta.tags,
        technologies: meta.technologies,
        series: meta.series,
        part: meta.part,
        body,
        path: path.display().to_string(),
    })
}

pub fn read_post(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<serde_json::Value> {
    let file = post_file_of(repo, page_slug, post_slug)?;
    let raw = std::fs::read_to_string(&file)
        .map_err(|_| AppError::Validation(format!("Post not found: {}", post_slug)))?;
    let (meta, body) = parse_post(&raw);
    Ok(serde_json::json!({
        "title": meta.title,
        "slug": meta.slug,
        "date": meta.date,
        "updatedDate": meta.updated_date,
        "status": if meta.status.is_empty() { "draft" } else { meta.status.as_str() },
        "publishAt": meta.publish_at,
        "excerpt": meta.excerpt,
        "featured": meta.featured,
        "comments": meta.comments,
        "page": page_slug,
        "project": meta.project,
        "subtitle": meta.subtitle,
        "cover": meta.cover,
        "series": meta.series,
        "part": meta.part,
        "tags": meta.tags,
        "technologies": meta.technologies,
        "body": body,
    }))
}

pub fn write_post(repo: &Path, input: &PostInput) -> AppResult<String> {
    let page_slug = ensure_safe_slug(&input.page_slug)?;
    let post_slug = if input.meta.slug.is_empty() {
        slugify(&input.meta.title)
    } else {
        input.meta.slug.clone()
    };
    ensure_safe_slug(&post_slug)?;
    let original_slug = input.original_slug.trim();
    if !original_slug.is_empty() {
        ensure_safe_slug(original_slug)?;
    }
    let original_file = if original_slug.is_empty() {
        None
    } else {
        let file = post_file_of(repo, &page_slug, original_slug)?;
        if !file.is_file() {
            return Err(AppError::Validation(format!("Post not found: {}", original_slug)));
        }
        Some(file)
    };
    let file = if let Some(existing) = original_file.as_ref() {
        let parent = existing.parent().ok_or_else(|| AppError::Validation("Could not resolve post destination.".into()))?;
        parent.join(format!("{}.md", post_slug))
    } else {
        post_file_of(repo, &page_slug, &post_slug)?
    };
    if original_file.as_ref().map(|f| f != &file).unwrap_or(false) && file.exists() {
        return Err(AppError::Validation(format!("A post with slug '{}' already exists.", post_slug)));
    }
    if original_file.is_none() && file.exists() {
        return Err(AppError::Validation(format!("A post with slug '{}' already exists.", post_slug)));
    }
    let today = today_iso();
    if input.meta.title.trim().is_empty() {
        return Err(AppError::Validation("Post title must not be empty.".into()));
    }
    let status = if input.meta.status.is_empty() { "draft" } else { input.meta.status.as_str() };
    if !matches!(status, "draft" | "published" | "archived") {
        return Err(AppError::Validation("Post status must be draft, published, or archived.".into()));
    }
    let date = if input.meta.date.is_empty() { today.clone() } else { input.meta.date.clone() };
    if !is_iso_date(&date) {
        return Err(AppError::Validation("Post date must use YYYY-MM-DD.".into()));
    }
    if !input.meta.publish_at.is_empty() && !is_iso_date(&input.meta.publish_at) {
        return Err(AppError::Validation("Scheduled publish date must use YYYY-MM-DD.".into()));
    }
    let meta = PostMeta {
        title: input.meta.title.clone(),
        slug: post_slug.clone(),
        date,
        updated_date: today,
        status: status.to_string(),
        publish_at: input.meta.publish_at.clone(),
        excerpt: input.meta.excerpt.clone(),
        featured: input.meta.featured,
        comments: input.meta.comments,
        page: page_slug.clone(),
        project: input.meta.project.clone(),
        subtitle: input.meta.subtitle.clone(),
        cover: input.meta.cover.replace(
            &format!("assets/posts/{}/{}/", page_slug, input.draft_asset_slug),
            &format!("assets/posts/{}/{}/", page_slug, post_slug),
        ),
        series: input.meta.series.clone(),
        part: input.meta.part,
        tags: input.meta.tags.clone(),
        technologies: input.meta.technologies.clone(),
    };
    let page_dir = page_dir_of(repo, &page_slug)?;
    if !page_dir.join(PAGE_FILE).is_file() {
        return Err(AppError::Validation(format!(
            "Page '{}' does not exist. Create or select a page before saving the post.",
            page_slug
        )));
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    atomic_write(&file, &serialize_post(&meta, &input.body))?;
    if let Some(old_file) = original_file {
        if old_file != file {
            let old_assets = old_file.with_extension("");
            let new_assets = file.with_extension("");
            if old_assets.is_dir() && !new_assets.exists() {
                std::fs::rename(&old_assets, &new_assets)?;
            }
            std::fs::remove_file(old_file)?;
        }
    } else if !input.draft_asset_slug.trim().is_empty() {
        let draft_slug = ensure_safe_slug(&input.draft_asset_slug)?;
        let draft_assets = file.parent().unwrap_or_else(|| Path::new(""))
            .join(&draft_slug);
        let final_assets = file.with_extension("");
        if draft_assets.is_dir() && !final_assets.exists() {
            std::fs::rename(draft_assets, final_assets)?;
        }
    }
    Ok(post_slug)
}

pub fn delete_post(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<()> {
    let page_slug = ensure_safe_slug(page_slug)?;
    let post_slug = ensure_safe_slug(post_slug)?;
    let file = post_file_of(repo, &page_slug, &post_slug)?;
    let slug_dir = file.with_extension("");
    let parent = file.parent().map(|p| p.to_path_buf());
    let mut moved: Vec<(PathBuf, String)> = Vec::new();
    if file.exists() {
        moved.push((file.clone(), repo_relative(repo, &file)?));
    }
    if slug_dir.is_dir() && parent.as_ref() != Some(&slug_dir) {
        moved.push((slug_dir.clone(), repo_relative(repo, &slug_dir)?));
    }
    // Preserve the staged (published) asset copy too, so restore brings back
    // covers and images with the post.
    if let Ok(path) = resolve_in_repo(repo, &format!("assets/posts/{}/{}", page_slug, post_slug)) {
        if path.exists() {
            moved.push((path, format!("assets/posts/{}/{}", page_slug, post_slug)));
        }
    }
    if !moved.is_empty() {
        let refs: Vec<(&Path, &str)> = moved.iter().map(|(p, s)| (p.as_path(), s.as_str())).collect();
        move_to_trash(repo, "post", &post_slug, &refs)?;
    }
    remove_staged_post_assets(repo, &page_slug, &post_slug);
    let _ = remove_generated(repo, &format!("devlog/{}.html", post_slug));
    Ok(())
}

/// The `.md` slug-folder names directly under a page's `posts` dir.
fn post_slugs_in(posts_dir: &Path) -> Vec<String> {
    let mut out = vec![];
    if let Ok(entries) = std::fs::read_dir(posts_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().map(|e| e == "md").unwrap_or(false) {
                if let Some(stem) = p.file_stem() {
                    out.push(stem.to_string_lossy().to_string());
                }
            }
        }
    }
    out
}

/// Best-effort removal of the staged (published) asset copy for a post.
fn remove_staged_post_assets(repo: &Path, page_slug: &str, post_slug: &str) {
    let rel = format!("assets/posts/{}/{}", page_slug, post_slug);
    if let Ok(path) = resolve_in_repo(repo, &rel) {
        if path.exists() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

/// Best-effort removal of the staged page cover asset.
fn remove_staged_page_assets(repo: &Path, page_slug: &str) {
    let rel = format!("assets/pages/{}", page_slug);
    if let Ok(path) = resolve_in_repo(repo, &rel) {
        if path.exists() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

/// Best-effort removal of a generated site artifact (file or dir) by rel path.
fn remove_generated(repo: &Path, rel: &str) -> AppResult<()> {
    let path = resolve_in_repo(repo, rel)?;
    if path.is_file() {
        std::fs::remove_file(&path)?;
    } else if path.is_dir() {
        std::fs::remove_dir_all(&path)?;
    }
    Ok(())
}

/// Ensure a page's `page.yml` exists for a post's parent `posts` directory.
///
/// When a post is written into a slug that has never been created as a page
/// through the "New Page" flow, this auto-provisions a minimal page so the
/// page (and its posts) are visible both in the app tree and the published
/// site. Without it a post could end up in an orphaned `<slug>/posts/` folder
/// that has no `page.yml`, making the whole page invisible everywhere.
pub fn content_tree(repo: &Path) -> AppResult<Vec<ContentNode>> {
    let pages = list_pages(repo)?;
    let posts = list_posts(repo)?;
    let by_slug: std::collections::HashMap<String, PageRow> = pages
        .iter()
        .cloned()
        .map(|page| (page.slug.clone(), page))
        .collect();
    let mut child_pages: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut roots = Vec::new();
    for page in &pages {
        if let Some(parent) = &page.parent {
            if !by_slug.contains_key(parent) {
                return Err(AppError::Validation(format!(
                    "Page '{}' references missing parent '{}'.",
                    page.slug, parent
                )));
            }
            child_pages.entry(parent.clone()).or_default().push(page.slug.clone());
        } else {
            roots.push(page.slug.clone());
        }
    }
    let order_slugs = |slugs: &mut Vec<String>| {
        slugs.sort_by(|a, b| {
            let left = &by_slug[a];
            let right = &by_slug[b];
            left.order.cmp(&right.order).then_with(|| left.name.cmp(&right.name))
        });
    };
    order_slugs(&mut roots);
    for children in child_pages.values_mut() {
        order_slugs(children);
    }

    fn build_node(
        slug: &str,
        by_slug: &std::collections::HashMap<String, PageRow>,
        child_pages: &std::collections::HashMap<String, Vec<String>>,
        posts: &[PostRow],
    ) -> ContentNode {
        let page = &by_slug[slug];
        let mut children: Vec<ContentNode> = child_pages
            .get(slug)
            .into_iter()
            .flatten()
            .map(|child| build_node(child, by_slug, child_pages, posts))
            .collect();
        let mut page_posts: Vec<&PostRow> = posts.iter().filter(|post| post.page == slug).collect();
        page_posts.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.title.cmp(&b.title)));
        children.extend(page_posts.into_iter().map(|post| ContentNode {
            id: format!("{}:{}", page.slug, post.slug),
            type_: "post".to_string(),
            slug: post.slug.clone(),
            name: post.title.clone(),
            description: post.excerpt.clone(),
            cover: String::new(),
            status: post.status.clone(),
            path: post.path.clone(),
            kind: String::new(),
            updated_date: if post.updated_date.is_empty() { post.date.clone() } else { post.updated_date.clone() },
            children: Vec::new(),
        }));
        let updated_date = children
            .iter()
            .map(|child| child.updated_date.as_str())
            .max()
            .unwrap_or_default()
            .to_string();
        ContentNode {
            id: page.slug.clone(),
            type_: "page".to_string(),
            slug: page.slug.clone(),
            name: page.name.clone(),
            description: page.description.clone(),
            cover: page.cover.clone(),
            status: String::new(),
            path: page.path.clone(),
            kind: page.kind.clone(),
            updated_date,
            children,
        }
    }

    Ok(roots
        .iter()
        .map(|slug| build_node(slug, &by_slug, &child_pages, &posts))
        .collect())
}

// ---------- Media scan / orphan cleanup ----------

#[derive(Serialize, Debug, Clone)]
pub struct MediaFile {
    pub path: String,        // absolute
    pub rel_path: String,    // repo-relative, e.g. content/pages/x/posts/p/assets/img.png
    pub page: String,
    pub post: String,        // post slug ("" if page-level asset)
    pub file_name: String,
    pub bytes: u64,
    pub orphaned: bool,
}

/// Recursive directory walk yielding file paths.
fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk_files(&p, out);
        } else if p.is_file() {
            out.push(p);
        }
    }
}

/// Scan every per-post `assets/` directory under `content/pages`, classifying
/// each asset as in-use or orphaned relative to its owning post's Markdown.
pub fn scan_media(repo: &Path) -> AppResult<Vec<MediaFile>> {
    let mut out: Vec<MediaFile> = vec![];
    let root = repo.join("content/pages");
    if !root.is_dir() {
        return Ok(out);
    }
    let mut post_md: Vec<PathBuf> = vec![];
    walk_files(&root, &mut post_md);
    // For each `<slug>.md`, look for its `<slug>/assets/` directory.
    for md in post_md {
        if md.extension().map(|e| e == "md").unwrap_or(false) {
            let assets = md.with_extension("").join("assets");
            if !assets.is_dir() {
                continue;
            }
            let raw_md = std::fs::read_to_string(&md).unwrap_or_default();
            let post = md
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            // Recover the owning page slug from the component before `posts`.
            let page = page_slug_from_post_path(repo, &md).unwrap_or_default();
            let mut asset_files = vec![];
            walk_files(&assets, &mut asset_files);
            for af in asset_files {
                let fname = af
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let rel = af
                    .strip_prefix(repo)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                // Orphaned if the filename isn't referenced in the post markdown.
                let orphaned = !raw_md.contains(&fname);
                let bytes = std::fs::metadata(&af).map(|m| m.len()).unwrap_or(0);
                out.push(MediaFile {
                    path: af.display().to_string(),
                    rel_path: rel,
                    page: page.clone(),
                    post: post.clone(),
                    file_name: fname,
                    bytes,
                    orphaned,
                });
            }
        }
    }
    Ok(out)
}

fn page_slug_from_post_path(repo: &Path, md: &Path) -> Option<String> {
    // path = repo/content/pages/<...>/<post>.md ; find the dir containing "posts".
    let rel = md.strip_prefix(repo).ok()?;
    let comps: Vec<&std::ffi::OsStr> = rel.components().map(|c| c.as_os_str()).collect();
    // [content, pages, ..., <page>, posts, <post>.md]
    for (i, c) in comps.iter().enumerate() {
        if *c == "posts" && i >= 3 {
            return Some(comps[i - 1].to_string_lossy().to_string());
        }
    }
    None
}

/// Delete one media file after confirming it stays inside the repo.
pub fn delete_media(repo: &Path, rel_path: &str) -> AppResult<()> {
    let p = resolve_in_repo(repo, rel_path)?;
    if p.is_file() {
        std::fs::remove_file(&p)?;
    }
    Ok(())
}

// ---------- trash (recoverable deletion) ----------

#[derive(Serialize, Debug, Clone)]
pub struct TrashEntry {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub deleted_at: String,
    pub files: usize,
}

/// Disk path of the repo-local trash directory.
fn trash_repo_root(repo: &Path) -> PathBuf {
    repo.join(TRASH_DIR)
}

/// Convert an absolute path inside `repo` to its repo-relative slash string.
fn repo_relative(repo: &Path, path: &Path) -> AppResult<String> {
    let canon = repo
        .canonicalize()
        .map_err(|_| AppError::Validation("Repository path does not exist.".into()))?;
    let rel = path
        .strip_prefix(&canon)
        .map_err(|_| AppError::Validation("Path is outside the repository.".into()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// Create a fresh (unused) trash entry directory.
fn new_trash_entry(repo: &Path, kind: &str, name: &str) -> AppResult<PathBuf> {
    let root = trash_repo_root(repo);
    std::fs::create_dir_all(&root)?;
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let mut n = 0usize;
    loop {
        let id = if n == 0 {
            format!("{}_{}_{}", ts, kind, name)
        } else {
            format!("{}_{}_{}_{}", ts, kind, name, n)
        };
        let path = root.join(&id);
        if !path.exists() {
            std::fs::create_dir_all(&path)?;
            return Ok(path);
        }
        n += 1;
    }
}

/// Move `moved` sources (absolute path + repo-relative original) into a single
/// trash entry, recording a manifest so they can be restored later. Sources
/// that no longer exist are skipped; empty deletions create no entry.
fn move_to_trash(repo: &Path, kind: &str, name: &str, moved: &[(&Path, &str)]) -> AppResult<()> {
    let entry = new_trash_entry(repo, kind, name)?;
    let mut files = Vec::new();
    let mut used_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (src, original) in moved {
        if !src.exists() && !src.is_symlink() {
            continue;
        }
        let Some(base) = src.file_name().map(|s| s.to_string_lossy().to_string()) else {
            continue;
        };
        // Multiple sources can share a base name (e.g. a post's <slug>/ assets
        // folder and the staged assets/<slug> copy). Disambiguate the stored
        // name; the original `to` path is recorded for restore either way.
        let mut stored = base.clone();
        let mut n = 2;
        while used_names.contains(&stored) || entry.join(&stored).exists() {
            stored = format!("{}_{}", base, n);
            n += 1;
        }
        used_names.insert(stored.clone());
        let dest = entry.join(&stored);
        std::fs::rename(src, &dest)?;
        files.push(serde_json::json!({ "from": stored, "to": original }));
    }
    if files.is_empty() {
        let _ = std::fs::remove_dir_all(&entry);
        return Ok(());
    }
    let manifest = serde_json::json!({
        "kind": kind,
        "name": name,
        "deleted_at": chrono::Utc::now().to_rfc3339(),
        "files": files,
    });
    let raw = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| AppError::Command(format!("Could not serialize trash manifest: {e}")))?;
    std::fs::write(entry.join(TRASH_MANIFEST), raw)?;
    Ok(())
}

/// A trash entry id must be an opaque folder name; reject anything that could
/// traverse or point outside `.trash`.
fn ensure_trash_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id == "." || id == ".." {
        return Err(AppError::Validation(format!("Invalid trash id: {}", id)));
    }
    if id.contains('/') || id.contains('\\') || id.starts_with('.') {
        return Err(AppError::Validation(format!("Invalid trash id: {}", id)));
    }
    Ok(())
}

/// List recoverable deletions, newest first.
pub fn list_trash(repo: &Path) -> AppResult<Vec<TrashEntry>> {
    let root = trash_repo_root(repo);
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(&root)? {
        let band = entry?;
        let dir = band.path();
        if !dir.is_dir() {
            continue;
        }
        let raw = match std::fs::read_to_string(dir.join(TRASH_MANIFEST)) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let id = dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        out.push(TrashEntry {
            id,
            kind: v["kind"].as_str().unwrap_or_default().to_string(),
            name: v["name"].as_str().unwrap_or_default().to_string(),
            deleted_at: v["deleted_at"].as_str().unwrap_or_default().to_string(),
            files: v["files"].as_array().map(|a| a.len()).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}

/// Restore a previously deleted item to its original location. Refuses to
/// overwrite existing paths so a restore can never clobber new work.
pub fn restore_deleted(repo: &Path, id: &str) -> AppResult<()> {
    ensure_trash_id(id)?;
    let entry = trash_repo_root(repo).join(id);
    if !entry.is_dir() {
        return Err(AppError::Validation(format!(
            "Trash entry not found: {}. Run list_trash to see available restores.",
            id
        )));
    }
    let raw = std::fs::read_to_string(entry.join(TRASH_MANIFEST))
        .map_err(|_| AppError::Validation(format!("Trash entry has no manifest: {}", id)))?;
    let v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Command(format!("Could not read trash manifest: {e}")))?;
    let files = v["files"]
        .as_array()
        .ok_or_else(|| AppError::Validation("Trash manifest has no files.".into()))?;

    let mut plan: Vec<(PathBuf, PathBuf)> = Vec::new();
    for f in files {
        let from_name = f["from"]
            .as_str()
            .ok_or_else(|| AppError::Validation("Trash manifest entry missing 'from'.".into()))?;
        let to_rel = f["to"]
            .as_str()
            .ok_or_else(|| AppError::Validation("Trash manifest entry missing 'to'.".into()))?;
        let from = entry.join(from_name);
        if !from.exists() && !from.is_symlink() {
            return Err(AppError::Validation(format!(
                "Trash entry is missing {}; it cannot be restored.",
                from_name
            )));
        }
        let to = resolve_in_repo(repo, to_rel)?;
        if to.exists() {
            return Err(AppError::Validation(format!(
                "Refusing to restore over an existing path: {}. Move or remove it first.",
                to_rel
            )));
        }
        plan.push((from, to));
    }

    for (from, to) in &plan {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(from, to)?;
    }
    let _ = std::fs::remove_dir_all(&entry);
    Ok(())
}

/// Permanently delete trash contents; returns the number of entries removed.
pub fn empty_trash(repo: &Path) -> AppResult<usize> {
    let root = trash_repo_root(repo);
    if !root.is_dir() {
        return Ok(0);
    }
    let mut count = 0;
    for entry in std::fs::read_dir(&root)? {
        let band = entry?;
        let p = band.path();
        if p.is_dir() {
            std::fs::remove_dir_all(&p)?;
            count += 1;
        }
    }
    Ok(count)
}

// ---------- helpers ----------

pub fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in value.chars() {
        let lc = c.to_ascii_lowercase();
        if lc.is_ascii_alphanumeric() {
            out.push(lc);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed
    }
}

fn today_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn is_iso_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

/// Summary of the most recent site build, surfaced in the publish modal so the
/// editor can see what the last build produced before deploying.
#[derive(Serialize, Debug, Clone, Default)]
pub struct SiteBuildInfo {
    pub generated_at: Option<String>,
    pub devlog_posts: usize,
    pub devlog_index: bool,
    pub feed_generated: bool,
    pub sitemap_generated: bool,
    pub robots_generated: bool,
    pub search_index_generated: bool,
    pub archive_folders: Vec<String>,
}

pub fn site_build_info(repo: &Path) -> AppResult<SiteBuildInfo> {
    let devlog = resolve_in_repo(repo, "devlog")?;
    let exists = |name: &str| devlog.join(name).exists();
    let mut info = SiteBuildInfo {
        devlog_posts: 0,
        devlog_index: exists("index.html"),
        feed_generated: repo.join("feed.xml").exists(),
        sitemap_generated: repo.join("sitemap.xml").exists(),
        robots_generated: repo.join("robots.txt").exists(),
        search_index_generated: repo.join("search-index.json").exists(),
        archive_folders: Vec::new(),
        ..Default::default()
    };
    if let Ok(md) = repo.join("devlog.html").metadata() {
        if let Ok(t) = md.modified() {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            info.generated_at = Some(dt.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    if let Ok(entries) = std::fs::read_dir(&devlog) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".html") && name != "index.html" {
                info.devlog_posts += 1;
            } else if ["tag", "tech", "project"].contains(&name.as_str()) {
                info.archive_folders.push(name);
            }
        }
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "studio-content-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        create_page(
            &root,
            &PageInput {
                name: "Fluid".to_string(),
                slug: "fluid-dynamics".to_string(),
                description: "d".to_string(),
                cover: String::new(),
                parent: None,
                order: None,
                kind: "devlog".to_string(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        root
    }

    #[test]
    fn create_nested_subpage() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "GPU Port".to_string(),
                slug: "gpu-port".to_string(),
                description: "g".to_string(),
                cover: String::new(),
                parent: Some("fluid-dynamics".to_string()),
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let sub = resolve_in_repo(&root, "content/pages/fluid-dynamics/subpages/gpu-port").unwrap();
        assert!(sub.join(PAGE_FILE).exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn projects_crud_and_post_count() {
        let root = repo();
        let created = create_project(
            &root,
            &ProjectInput {
                slug: "shader-lab".to_string(),
                name: "Shader Lab".to_string(),
                repo_url: "https://github.com/AHMarius/shader-lab".to_string(),
                live_url: String::new(),
                status: "active".to_string(),
                description: "GPU experiments".to_string(),
                cover: String::new(),
            },
        )
        .unwrap();
        assert_eq!(created.slug, "shader-lab");
        assert!(resolve_in_repo(
            &root,
            "content/projects/shader-lab/project.yml"
        )
        .is_ok());

        let listed = list_projects(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Shader Lab");
        assert_eq!(listed[0].post_count, 0);

        // Link a post to the project and confirm the count reflects it.
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(&posts).unwrap();
        let meta = PostMeta {
            title: "Procedural grids".to_string(),
            slug: "x".to_string(),
            date: "2026-01-05".to_string(),
            updated_date: String::new(),
            status: "published".to_string(),
            publish_at: String::new(),
            excerpt: String::new(),
            featured: false,
            comments: true,
            page: "fluid-dynamics".to_string(),
            project: "shader-lab".to_string(),
            subtitle: String::new(),
            cover: String::new(),
            series: String::new(),
            part: 0,
            tags: vec![],
            technologies: vec![],
        };
        atomic_write(&posts.join("x.md"), &serialize_post(&meta, "body")).unwrap();
        let listed2 = list_projects(&root).unwrap();
        assert_eq!(listed2[0].post_count, 1);

        update_project(
            &root,
            &ProjectInput {
                slug: "shader-lab".to_string(),
                name: "Shader Lab 2".to_string(),
                repo_url: String::new(),
                live_url: String::new(),
                status: "paused".to_string(),
                description: String::new(),
                cover: String::new(),
            },
        )
        .unwrap();
        let read = read_project(&root, "shader-lab").unwrap();
        assert_eq!(read["status"], "paused");
        assert_eq!(read["name"], "Shader Lab 2");

        delete_project(&root, "shader-lab").unwrap();
        assert!(!resolve_in_repo(&root, "content/projects/shader-lab".to_string().as_str()).unwrap().exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_post_round_trip() {
        let root = repo();
        // Ensure the post dir ancestor chain exists (write_post creates the final parent).
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(posts.join("my-post")).unwrap();
        let slug = write_post(
            &root,
            &PostInput {
                page_slug: "fluid-dynamics".to_string(),
                original_slug: String::new(),
                draft_asset_slug: String::new(),
                meta: PostMeta {
                    title: "My Post".to_string(),
                    slug: "my-post".to_string(),
                    status: "draft".to_string(),
                    publish_at: "2026-10-01".to_string(),
                    comments: false,
                    ..Default::default()
                },
                body: "# Hello\n\nSome **bold** text with $x^2$ math.".to_string(),
            },
        )
        .unwrap();
        assert_eq!(slug, "my-post");
        let file = post_file_of(&root, "fluid-dynamics", "my-post").unwrap();
        let raw = std::fs::read_to_string(&file).unwrap();
        assert!(raw.contains("\"My Post\"") || raw.contains("My Post"));
        assert!(raw.contains("# Hello"));
        assert!(raw.contains("$x^2$"));
        assert!(raw.contains("publishAt: \"2026-10-01\""));
        assert!(raw.contains("comments: false"));
        let doc = read_post(&root, "fluid-dynamics", "my-post").unwrap();
        assert_eq!(doc["publishAt"], "2026-10-01");
        assert_eq!(doc["comments"], false);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_post_rejects_traversal_slug() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(posts.join("p")).unwrap();
        let r = write_post(
            &root,
            &PostInput {
                page_slug: "fluid-dynamics".to_string(),
                original_slug: String::new(),
                draft_asset_slug: String::new(),
                meta: PostMeta {
                    title: "Bad".to_string(),
                    slug: "../escape".to_string(),
                    ..Default::default()
                },
                body: "x".to_string(),
            },
        );
        assert!(r.is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_post_into_unknown_page_is_rejected() {
        let root = repo();
        let result = write_post(
            &root,
            &PostInput {
                page_slug: "brand-new-page".to_string(),
                original_slug: String::new(),
                draft_asset_slug: String::new(),
                meta: PostMeta {
                    title: "Hello".to_string(),
                    slug: "hello".to_string(),
                    status: "published".to_string(),
                    ..Default::default()
                },
                body: "body".to_string(),
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
        let page_dir = resolve_in_repo(&root, "content/pages/brand-new-page").unwrap();
        assert!(!page_dir.join("page.yml").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_subpage_removes_nested_dir() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "GPU Port".to_string(),
                slug: "gpu-port".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("fluid-dynamics".to_string()),
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let sub = resolve_in_repo(&root, "content/pages/fluid-dynamics/subpages/gpu-port")
            .unwrap();
        assert!(sub.join(PAGE_FILE).exists());

        // Pre-fix code resolved to content/pages/gpu-port (top-level) and would
        // have silently no-opped; delete must find the nested subpage and remove it.
        delete_page(&root, "gpu-port").unwrap();
        assert!(!sub.join(PAGE_FILE).exists());
        assert!(!sub.exists());
        // The parent page must survive.
        assert!(resolve_in_repo(&root, "content/pages/fluid-dynamics/page.yml")
            .unwrap()
            .exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_post_cleans_assets_and_staged_copy() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(posts.join("my-post").join("assets")).unwrap();
        std::fs::write(posts.join("my-post.md"), "# My Post").unwrap();
        std::fs::write(posts.join("my-post").join("assets").join("pic.png"), b"png").unwrap();
        // A staged copy at its published location + a generated post page.
        let staged = resolve_in_repo(&root, "assets/posts/fluid-dynamics/my-post").unwrap();
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("pic.png"), b"png").unwrap();
        let generated = resolve_in_repo(&root, "devlog/my-post.html").unwrap();
        std::fs::create_dir_all(generated.parent().unwrap()).unwrap();
        std::fs::write(&generated, "<html>").unwrap();

        delete_post(&root, "fluid-dynamics", "my-post").unwrap();

        assert!(!posts.join("my-post.md").exists());
        // The <slug> assets folder next to the .md must be gone too (the old
        // code looked at posts/assets, leaving orphaned content).
        assert!(!posts.join("my-post").exists());
        assert!(!staged.exists());
        assert!(!generated.exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deletion_moves_posts_to_trash_and_back() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(posts.join("recap").join("assets")).unwrap();
        std::fs::write(posts.join("recap.md"), "# Recap").unwrap();
        std::fs::write(posts.join("recap").join("assets").join("pic.png"), b"png").unwrap();

        delete_post(&root, "fluid-dynamics", "recap").unwrap();
        assert!(!posts.join("recap.md").exists());
        assert!(!posts.join("recap").exists());

        let trash = list_trash(&root).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].kind, "post");
        assert_eq!(trash[0].name, "recap");
        assert_eq!(trash[0].files, 2);

        restore_deleted(&root, &trash[0].id).unwrap();
        assert!(posts.join("recap.md").exists());
        assert!(posts.join("recap").join("assets").join("pic.png").exists());
        assert!(list_trash(&root).unwrap().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn restore_brings_back_staged_asset_copy() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(posts.join("recap").join("assets")).unwrap();
        std::fs::write(posts.join("recap.md"), "# Recap").unwrap();
        std::fs::write(posts.join("recap").join("assets").join("pic.png"), b"png").unwrap();
        let staged = resolve_in_repo(&root, "assets/posts/fluid-dynamics/recap").unwrap();
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("cover.png"), b"cover").unwrap();

        delete_post(&root, "fluid-dynamics", "recap").unwrap();
        assert!(!staged.join("cover.png").exists());

        let trash = list_trash(&root).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].files, 3); // .md + post assets dir + staged copy

        restore_deleted(&root, &trash[0].id).unwrap();
        assert!(posts.join("recap.md").exists());
        assert!(posts.join("recap").join("assets").join("pic.png").exists());
        assert!(staged.join("cover.png").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deletion_moves_pages_to_trash_and_back() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "GPU Port".to_string(),
                slug: "gpu-port".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("fluid-dynamics".to_string()),
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let sub = resolve_in_repo(&root, "content/pages/fluid-dynamics/subpages/gpu-port").unwrap();

        delete_page(&root, "gpu-port").unwrap();
        assert!(!sub.exists());

        let trash = list_trash(&root).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].kind, "page");

        restore_deleted(&root, &trash[0].id).unwrap();
        assert!(sub.join(PAGE_FILE).exists());
        // The parent page is restored alongside (it was part of the same entry).
        assert!(list_trash(&root).unwrap().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn restore_refuses_to_overwrite_existing_content() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(&posts).unwrap();
        std::fs::write(posts.join("keep.md"), "# Original").unwrap();

        delete_post(&root, "fluid-dynamics", "keep").unwrap();
        assert!(!posts.join("keep.md").exists());
        // Re-create a new post at the same path before restoring.
        std::fs::write(posts.join("keep.md"), "# Newer").unwrap();

        let trash = list_trash(&root).unwrap();
        assert!(restore_deleted(&root, &trash[0].id).is_err());
        // The existing file must be untouched.
        assert_eq!(std::fs::read_to_string(posts.join("keep.md")).unwrap(), "# Newer");
        // The entry still holds the old content, so nothing was lost.
        assert_eq!(list_trash(&root).unwrap().len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_trash_removes_entries_only() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(&posts).unwrap();
        std::fs::write(posts.join("gone.md"), "# Gone").unwrap();
        delete_post(&root, "fluid-dynamics", "gone").unwrap();
        assert_eq!(list_trash(&root).unwrap().len(), 1);

        assert_eq!(empty_trash(&root).unwrap(), 1);
        assert!(list_trash(&root).unwrap().is_empty());
        // Source/content tree must be untouched by emptying the trash.
        assert!(!posts.join("gone.md").exists());
        assert!(resolve_in_repo(&root, "content/pages/fluid-dynamics/page.yml")
            .unwrap()
            .exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn subpage_post_paths_are_found() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "GPU Port".to_string(),
                slug: "gpu-port".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("fluid-dynamics".to_string()),
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let sub_posts = resolve_in_repo(
            &root,
            "content/pages/fluid-dynamics/subpages/gpu-port/posts",
        )
        .unwrap();
        std::fs::create_dir_all(&sub_posts).unwrap();
        std::fs::write(sub_posts.join("deep.md"), "# Deep").unwrap();

        let file = post_file_of(&root, "gpu-port", "deep").unwrap();
        assert_eq!(
            std::fs::canonicalize(&file).unwrap(),
            std::fs::canonicalize(sub_posts.join("deep.md")).unwrap()
        );
        // Deleting a subpage post must reach it (and not error).
        delete_post(&root, "gpu-port", "deep").unwrap();
        assert!(!sub_posts.join("deep.md").exists());

        // Arbitrary-depth page lookup and asset resolution use the same
        // recursive hierarchy rather than assuming one sub-page level.
        create_page(
            &root,
            &PageInput {
                name: "Kernel Notes".to_string(),
                slug: "kernel-notes".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("gpu-port".to_string()),
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let deep_posts = resolve_in_repo(
            &root,
            "content/pages/fluid-dynamics/subpages/gpu-port/subpages/kernel-notes/posts",
        )
        .unwrap();
        std::fs::create_dir_all(&deep_posts).unwrap();
        std::fs::write(deep_posts.join("part-one.md"), "![](assets/plot.png)").unwrap();
        let assets = post_assets_dir_of(&root, "kernel-notes", "part-one").unwrap();
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(assets.join("plot.png"), b"png").unwrap();
        assert_eq!(
            std::fs::canonicalize(post_file_of(&root, "kernel-notes", "part-one").unwrap()).unwrap(),
            std::fs::canonicalize(deep_posts.join("part-one.md")).unwrap()
        );
        let media = scan_media(&root).unwrap();
        assert!(media.iter().any(|item| {
            item.page == "kernel-notes"
                && item.post == "part-one"
                && item.file_name == "plot.png"
                && !item.orphaned
        }));
        let staged_post = resolve_in_repo(
            &root,
            "assets/posts/kernel-notes/part-one/plot.png",
        )
        .unwrap();
        std::fs::create_dir_all(staged_post.parent().unwrap()).unwrap();
        std::fs::write(&staged_post, b"published").unwrap();
        let staged_cover = resolve_in_repo(&root, "assets/pages/kernel-notes/cover.png").unwrap();
        std::fs::create_dir_all(staged_cover.parent().unwrap()).unwrap();
        std::fs::write(&staged_cover, b"cover").unwrap();
        let generated = resolve_in_repo(&root, "pages/kernel-notes/index.html").unwrap();
        std::fs::create_dir_all(generated.parent().unwrap()).unwrap();
        std::fs::write(&generated, b"generated").unwrap();

        delete_page(&root, "gpu-port").unwrap();
        assert!(!deep_posts.exists());
        assert!(!staged_post.exists());
        assert!(!staged_cover.exists());
        assert!(!generated.exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_post_rename_via_original_slug() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(posts.join("v1")).unwrap();
        std::fs::write(posts.join("v1.md"), "# V1").unwrap();
        // Rename from v1 to v2 using original_slug.
        let slug = write_post(
            &root,
            &PostInput {
                page_slug: "fluid-dynamics".to_string(),
                original_slug: "v1".to_string(),
                draft_asset_slug: String::new(),
                meta: PostMeta {
                    title: "V2".to_string(),
                    slug: "v2".to_string(),
                    status: "draft".to_string(),
                    ..Default::default()
                },
                body: "new body".to_string(),
            },
        )
        .unwrap();
        assert_eq!(slug, "v2");
        assert!(!posts.join("v1.md").exists());
        assert!(!posts.join("v1").exists());
        assert!(posts.join("v2.md").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_post_rejects_empty_title() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(&posts).unwrap();
        let r = write_post(
            &root,
            &PostInput {
                page_slug: "fluid-dynamics".to_string(),
                original_slug: String::new(),
                draft_asset_slug: String::new(),
                meta: PostMeta {
                    title: String::new(),
                    slug: "valid-slug".to_string(),
                    status: "draft".to_string(),
                    ..Default::default()
                },
                body: "body".to_string(),
            },
        );
        assert!(r.is_err());
        let msg = r.unwrap_err().to_string();
        assert!(msg.contains("title"), "Expected title validation error, got: {msg}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_post_rejects_duplicate_slug() {
        let root = repo();
        let posts = resolve_in_repo(&root, "content/pages/fluid-dynamics/posts").unwrap();
        std::fs::create_dir_all(&posts).unwrap();
        std::fs::write(posts.join("existing.md"), "# Existing").unwrap();
        let r = write_post(
            &root,
            &PostInput {
                page_slug: "fluid-dynamics".to_string(),
                original_slug: String::new(),
                draft_asset_slug: String::new(),
                meta: PostMeta {
                    title: "Dup".to_string(),
                    slug: "existing".to_string(),
                    status: "draft".to_string(),
                    ..Default::default()
                },
                body: "body".to_string(),
            },
        );
        assert!(r.is_err());
        assert!(r.unwrap_err().to_string().contains("already exists"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn update_page_rejects_missing_slug() {
        let root = repo();
        let r = update_page(
            &root,
            "ghost-page",
            &PageInput {
                name: "Ghost".to_string(),
                slug: "ghost-page".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: None,
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        );
        assert!(r.is_err());
        assert!(r.unwrap_err().to_string().contains("Page not found"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn duplicate_page_slug_is_rejected_globally() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "Second root".to_string(),
                slug: "second-root".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: None,
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let duplicate = create_page(
            &root,
            &PageInput {
                name: "Fluid duplicate".to_string(),
                slug: "fluid-dynamics".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("second-root".to_string()),
                order: None,
                kind: String::new(),
                devlog_repo: String::new(),
            },
        );
        assert!(duplicate.is_err());
        assert!(duplicate.unwrap_err().to_string().contains("already exists"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn update_page_renames_and_moves_the_directory() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "Target".to_string(),
                slug: "target".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: None,
                order: Some(20),
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let old = resolve_in_repo(&root, "content/pages/fluid-dynamics").unwrap();
        std::fs::write(old.join("posts").join("note.md"), "---\ntitle: Note\nslug: note\npage: fluid-dynamics\n---\n\nBody\n").unwrap();
        update_page(
            &root,
            "fluid-dynamics",
            &PageInput {
                name: "Renamed".to_string(),
                slug: "renamed".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("target".to_string()),
                order: Some(5),
                kind: "page".to_string(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        assert!(!old.exists());
        let moved = resolve_in_repo(&root, "content/pages/target/subpages/renamed").unwrap();
        assert!(moved.join(PAGE_FILE).exists());
        assert!(std::fs::read_to_string(moved.join("posts").join("note.md")).unwrap().contains("page: \"renamed\""));
        let page = read_page(&root, "renamed").unwrap();
        assert_eq!(page["parent"], "target");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn content_tree_nests_pages_and_computes_page_updated_date() {
        let root = repo();
        create_page(
            &root,
            &PageInput {
                name: "GPU Port".to_string(),
                slug: "gpu-port".to_string(),
                description: String::new(),
                cover: String::new(),
                parent: Some("fluid-dynamics".to_string()),
                order: Some(1),
                kind: String::new(),
                devlog_repo: String::new(),
            },
        )
        .unwrap();
        let posts = page_dir_of(&root, "gpu-port").unwrap().join(POSTS_DIR);
        std::fs::write(
            posts.join("latest.md"),
            "---\ntitle: Latest\nslug: latest\ndate: 2026-01-01\nupdatedDate: 2026-09-18\nstatus: published\n---\n\nBody\n",
        )
        .unwrap();
        let tree = content_tree(&root).unwrap();
        assert_eq!(tree.len(), 1);
        let child = tree[0].children.iter().find(|node| node.type_ == "page").unwrap();
        assert_eq!(child.slug, "gpu-port");
        assert_eq!(child.children[0].type_, "post");
        assert_eq!(child.updated_date, "2026-09-18");
        assert_eq!(tree[0].updated_date, "2026-09-18");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn update_project_rejects_missing_slug() {
        let root = repo();
        let r = update_project(
            &root,
            &ProjectInput {
                slug: "nope".to_string(),
                name: "Nope".to_string(),
                ..Default::default()
            },
        );
        assert!(r.is_err());
        assert!(r.unwrap_err().to_string().contains("Project not found"));
        std::fs::remove_dir_all(&root).ok();
    }
}
