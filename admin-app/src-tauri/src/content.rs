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

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PostMeta {    #[serde(default)]
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
    pub excerpt: String,
    #[serde(default)]
    pub featured: bool,
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
    pub excerpt: String,
    pub featured: bool,
    pub page: String,
    pub project: String,
    pub tags: Vec<String>,
    pub technologies: Vec<String>,
    pub series: String,
    pub part: i64,
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
    if meta.featured {
        lines.push("featured: true".to_string());
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

fn line_items<'a>(line: &'a str) -> Option<&'a str> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("- ") {
        Some(trimmed[2..].trim().trim_matches('"'))
    } else {
        None
    }
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
        excerpt: String::new(),
        featured: false,
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
                    "excerpt" => meta.excerpt = value,
                    "featured" => meta.featured = value == "true",
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
    let top = resolve_in_repo(repo, &format!("content/pages/{}", slug))?;
    if top.join(PAGE_FILE).exists() || top.join(POSTS_DIR).is_dir() {
        return Ok(top);
    }
    if let Some(sub) = find_subpage_dir(repo, slug)? {
        return Ok(sub);
    }
    Ok(top)
}

/// Find `content/pages/<parent>/subpages/<slug>` for a page whose slug lives
/// under a sub-pages tree, returning its directory when present.
///
/// Without this, operations keyed on a sub-page's slug (read/update/delete,
/// post lookup) would resolve to the non-existent top-level
/// `content/pages/<slug>` and silently no-op.
fn find_subpage_dir(repo: &Path, slug: &str) -> AppResult<Option<PathBuf>> {
    let root = resolve_in_repo(repo, "content/pages")?;
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let sub = entry.path().join(SUBPAGES_DIR).join(slug);
            if sub.is_dir() && (sub.join(PAGE_FILE).exists() || sub.join(POSTS_DIR).is_dir()) {
                return Ok(Some(sub));
            }
        }
    }
    Ok(None)
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
    Ok(out)
}

fn collect_page(repo: &Path, dir: &Path, out: &mut Vec<PageRow>) -> AppResult<()> {
    let page_file = dir.join(PAGE_FILE);
    if page_file.exists() {
        let slug = dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let raw = match std::fs::read_to_string(&page_file) {
            Ok(r) => r,
            Err(_) => String::new(),
        };
        let (mut meta, _) = parse_page_raw(&raw);
        if meta.name.is_empty() {
            meta.name = slug.clone();
        }
        // find parent from path segmentation
        let parent = find_parent_from_path(repo, dir);
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
                "parent" => {
                    if value != "null" && !value.is_empty() {
                        meta.parent = Some(value);
                    }
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
    let dir = match &page.parent {
        Some(p) if !p.is_empty() => {
            ensure_safe_slug(p)?;
            resolve_in_repo(repo, &format!("content/pages/{}/subpages/{}", p, slug))?
        }
        _ => page_dir_of(repo, &slug)?,
    };
    if dir.join(PAGE_FILE).exists() {
        return Err(AppError::Validation(format!("Page already exists: {}", slug)));
    }
    if let Some(parent) = &page.parent {
        if !parent.is_empty() && !page_dir_of(repo, parent)?.join(PAGE_FILE).exists() {
            return Err(AppError::Validation(format!("Parent page does not exist: {}", parent)));
        }
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

pub fn update_page(repo: &Path, page: &PageInput) -> AppResult<()> {
    let slug = ensure_safe_slug(&page.slug)?;
    let dir = page_dir_of(repo, &slug)?;
    if !dir.join(PAGE_FILE).exists() {
        return Err(AppError::Validation(format!("Page not found: {}. Rename pages through the dedicated rename flow.", slug)));
    }
    atomic_write(&dir.join(PAGE_FILE), &serialize_page(page))?;
    Ok(())
}

pub fn delete_page(repo: &Path, slug: &str) -> AppResult<()> {
    let slug = ensure_safe_slug(slug)?;
    let dir = page_dir_of(repo, &slug)?;
    let mut entries: Vec<(String, String)> = Vec::new();
    for post in post_slugs_in(&dir.join(POSTS_DIR)) {
        entries.push((slug.clone(), post));
    }
    if dir.join(SUBPAGES_DIR).is_dir() {
        if let Ok(subpages) = std::fs::read_dir(dir.join(SUBPAGES_DIR)) {
            for sub in subpages.flatten() {
                let sub_dir = sub.path();
                if sub_dir.is_dir() {
                    let Some(sub_slug) = sub_dir.file_name().map(|s| s.to_string_lossy().to_string()) else {
                        continue;
                    };
                    for post in post_slugs_in(&sub_dir.join(POSTS_DIR)) {
                        entries.push((sub_slug.clone(), post));
                    }
                }
            }
        }
    }
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
    if let Ok(path) = resolve_in_repo(repo, &format!("assets/pages/{}", slug)) {
        if path.exists() {
            moved.push((path, format!("assets/pages/{}", slug)));
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
    remove_staged_page_assets(repo, &slug);
    let _ = remove_generated(repo, &format!("pages/{}", slug));
    Ok(())
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
    if direct.exists() {
        return Ok(direct);
    }
    if page_dir.join(SUBPAGES_DIR).is_dir() {
        if let Ok(entries) = std::fs::read_dir(page_dir.join(SUBPAGES_DIR)) {
            for entry in entries.flatten() {
                let sub = entry.path();
                if sub.is_dir() {
                    let cand = sub.join(POSTS_DIR).join(format!("{}.md", post_slug));
                    if cand.exists() {
                        return Ok(cand);
                    }
                }
            }
        }
    }
    Ok(direct)
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
    let (meta, _body) = parse_post(&raw);
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
        excerpt: meta.excerpt,
        featured: meta.featured,
        page: page_slug.to_string(),
        project: meta.project,
        tags: meta.tags,
        technologies: meta.technologies,
        series: meta.series,
        part: meta.part,
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
        "excerpt": meta.excerpt,
        "featured": meta.featured,
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
    if !matches!(status, "draft" | "published") {
        return Err(AppError::Validation("Post status must be either draft or published.".into()));
    }
    let date = if input.meta.date.is_empty() { today.clone() } else { input.meta.date.clone() };
    if !is_iso_date(&date) {
        return Err(AppError::Validation("Post date must use YYYY-MM-DD.".into()));
    }
    let meta = PostMeta {
        title: input.meta.title.clone(),
        slug: post_slug.clone(),
        date,
        updated_date: today,
        status: status.to_string(),
        excerpt: input.meta.excerpt.clone(),
        featured: input.meta.featured,
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
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
        ensure_page_meta(parent)?;
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
fn ensure_page_meta(posts_dir: &Path) -> AppResult<()> {
    let page_dir = match posts_dir.parent() {
        Some(p) => p.to_path_buf(),
        None => return Ok(()),
    };
    if page_dir.join(PAGE_FILE).exists() {
        return Ok(());
    }
    let Some(slug) = page_dir.file_name().map(|s| s.to_string_lossy().to_string()) else {
        return Ok(());
    };
    let input = PageInput {
        name: slug.clone(),
        slug: slug.clone(),
        description: String::new(),
        cover: String::new(),
        parent: None,
        order: None,
        kind: String::new(),
        devlog_repo: String::new(),
    };
    atomic_write(&page_dir.join(PAGE_FILE), &serialize_page(&input))?;
    Ok(())
}

pub fn content_tree(repo: &Path) -> AppResult<Vec<ContentNode>> {
    let pages = list_pages(repo)?;
    let posts = list_posts(repo)?;
    let mut nodes = vec![];
    for page in pages {
        let mut node = ContentNode {
            id: page.slug.clone(),
            type_: "page".to_string(),
            slug: page.slug.clone(),
            name: page.name.clone(),
            status: String::new(),
            path: page.path.clone(),
            kind: page.kind.clone(),
            updated_date: String::new(),
            children: Vec::new(),
        };
        for post in posts.iter().filter(|p| p.page == page.slug) {
            node.children.push(ContentNode {
                id: format!("{}:{}", page.slug, post.slug),
                type_: "post".to_string(),
                slug: post.slug.clone(),
                name: post.title.clone(),
                status: post.status.clone(),
                path: post.path.clone(),
                kind: String::new(),
                updated_date: post.updated_date.clone(),
                children: Vec::new(),
            });
        }
        nodes.push(node);
    }
    Ok(nodes)
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
    // For each md file, look for a sibling assets/ dir.
    for md in post_md {
        if md.extension().map(|e| e == "md").unwrap_or(false) {
            let assets = md.parent().unwrap_or(&md).join("assets");
            if !assets.is_dir() {
                continue;
            }
            let raw_md = std::fs::read_to_string(&md).unwrap_or_default();
            let post = md
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            // Recover page slug from the path content/pages/<page>/posts/<post>/<post>.md
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
    // [content, pages, ... , posts, <post>, <post>.md]
    for (i, c) in comps.iter().enumerate() {
        if *c == "posts" && i >= 3 {
            // page slug = comps[2], parent pages chain joined for nesting handled below
            return Some(comps[2].to_string_lossy().to_string());
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
            excerpt: String::new(),
            featured: false,
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
    fn write_post_into_unknown_page_provisions_page_meta() {
        let root = repo();
        let slug = write_post(
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
        )
        .unwrap();
        assert_eq!(slug, "hello");
        // Writing a post into a never-created page must provision page.yml so
        // the page is visible in the tree and on the published site.
        let page_dir = resolve_in_repo(&root, "content/pages/brand-new-page").unwrap();
        assert!(page_dir.join("page.yml").exists());
        assert!(std::fs::read_to_string(page_dir.join("page.yml")).unwrap().starts_with("---\n"));
        let pages = list_pages(&root).unwrap();
        assert!(pages.iter().any(|p| p.slug == "brand-new-page"));
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
