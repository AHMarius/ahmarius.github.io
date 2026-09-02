use crate::{AppError, AppResult, ensure_safe_slug, resolve_in_repo};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const PAGE_FILE: &str = "page.yml";
const POSTS_DIR: &str = "posts";
const SUBPAGES_DIR: &str = "subpages";
const ASSETS_DIR: &str = "assets";

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
    pub tags: Vec<String>,
    #[serde(default)]
    pub technologies: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PostInput {
    pub page_slug: String,
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
    #[serde(default)]
    pub updated_date: String,
    #[serde(default)]
    pub children: Vec<ContentNode>,
}

fn yaml_string(key: &str, value: &str) -> String {
    let escaped = value.replace('"', "\\\"");
    format!("{}: \"{}\"", key, escaped)
}

fn yaml_list(items: &[String]) -> String {
    if items.is_empty() {
        return "  []".to_string();
    }
    items
        .iter()
        .map(|i| format!("  - {}", i.replace('"', "\\\"")))
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
                        "tags" => meta.tags.push(item.to_string()),
                        "technologies" => meta.technologies.push(item.to_string()),
                        _ => {}
                    }
                }
                continue;
            }
            current_list = None;
            if let Some(kv) = line.split_once(':') {
                let key = kv.0.trim();
                let value = kv.1.trim().trim_matches('"').to_string();
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
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------- Pages ----------

pub fn page_dir_of(repo: &Path, slug: &str) -> AppResult<PathBuf> {
    ensure_safe_slug(slug)?;
    resolve_in_repo(repo, &format!("content/pages/{}", slug))
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
}

fn parse_page_raw(raw: &str) -> (PageMeta, ()) {
    let mut meta = PageMeta {
        name: String::new(),
        slug: None,
        description: String::new(),
        cover: String::new(),
        order: 100,
        parent: None,
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
    std::fs::create_dir_all(&dir)?;
    let input = PageInput {
        name: page.name.clone(),
        slug: slug.clone(),
        description: page.description.clone(),
        cover: page.cover.clone(),
        parent: page.parent.clone(),
        order: page.order,
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
        path: dir.display().to_string(),
    })
}

pub fn update_page(repo: &Path, page: &PageInput) -> AppResult<()> {
    let slug = ensure_safe_slug(&page.slug)?;
    let dir = page_dir_of(repo, &slug)?;
    atomic_write(&dir.join(PAGE_FILE), &serialize_page(page))?;
    Ok(())
}

pub fn delete_page(repo: &Path, slug: &str) -> AppResult<()> {
    let slug = ensure_safe_slug(slug)?;
    let dir = page_dir_of(repo, &slug)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

// ---------- Posts ----------

pub fn post_file_of(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<PathBuf> {
    ensure_safe_slug(page_slug)?;
    ensure_safe_slug(post_slug)?;
    resolve_in_repo(
        repo,
        &format!("content/pages/{}/{}/{}.md", page_slug, POSTS_DIR, post_slug),
    )
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
    let file = post_file_of(repo, &page_slug, &post_slug)?;
    let today = today_iso();
    let meta = PostMeta {
        title: input.meta.title.clone(),
        slug: post_slug.clone(),
        date: if input.meta.date.is_empty() {
            today.clone()
        } else {
            input.meta.date.clone()
        },
        updated_date: today,
        status: if input.meta.status.is_empty() {
            "draft".to_string()
        } else {
            input.meta.status.clone()
        },
        excerpt: input.meta.excerpt.clone(),
        featured: input.meta.featured,
        page: page_slug.clone(),
        project: input.meta.project.clone(),
        subtitle: input.meta.subtitle.clone(),
        cover: input.meta.cover.clone(),
        tags: input.meta.tags.clone(),
        technologies: input.meta.technologies.clone(),
    };
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
        ensure_page_meta(parent)?;
    }
    atomic_write(&file, &serialize_post(&meta, &input.body))?;
    Ok(post_slug)
}

pub fn delete_post(repo: &Path, page_slug: &str, post_slug: &str) -> AppResult<()> {
    let file = post_file_of(repo, page_slug, post_slug)?;
    if file.exists() {
        std::fs::remove_file(&file)?;
    }
    let assets = file.parent().unwrap_or(&file).join(ASSETS_DIR);
    if assets.exists() {
        std::fs::remove_dir_all(&assets)?;
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
            },
        )
        .unwrap();
        let sub = resolve_in_repo(&root, "content/pages/fluid-dynamics/subpages/gpu-port").unwrap();
        assert!(sub.join(PAGE_FILE).exists());
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
        let pages = list_pages(&root).unwrap();
        assert!(pages.iter().any(|p| p.slug == "brand-new-page"));
        std::fs::remove_dir_all(&root).ok();
    }
}
