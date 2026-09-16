use crate::{AppError, AppResult, resolve_in_repo};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;

const DATABASE_PATH: &str = "content/projects/catalog.sqlite3";

#[derive(Serialize, Debug, Clone)]
pub struct PortfolioProject {
    pub slug: String,
    pub name: String,
    pub date_label: String,
    pub status: String,
    pub gallery_folder: String,
    pub tags: Vec<String>,
    pub description: String,
    pub article_html: String,
    pub sort_order: i64,
}

fn connection(repo: &Path) -> AppResult<Connection> {
    let path = resolve_in_repo(repo, DATABASE_PATH)?;
    if !path.is_file() {
        return Err(AppError::Validation(format!(
            "Projects database not found: {}",
            DATABASE_PATH
        )));
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| AppError::Command(format!("Could not open projects database: {error}")))
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PortfolioProject> {
    let tags: String = row.get(5)?;
    Ok(PortfolioProject {
        slug: row.get(0)?,
        name: row.get(1)?,
        date_label: row.get(2)?,
        status: row.get(3)?,
        gallery_folder: row.get(4)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        description: row.get(6)?,
        article_html: row.get(7)?,
        sort_order: row.get(8)?,
    })
}

pub fn list(repo: &Path) -> AppResult<Vec<PortfolioProject>> {
    let db = connection(repo)?;
    let mut statement = db
        .prepare(
            "SELECT slug, name, date_label, status, gallery_folder, tags, description, article_html, sort_order
             FROM portfolio_projects ORDER BY sort_order, id",
        )
        .map_err(|error| AppError::Command(format!("Could not query projects database: {error}")))?;
    let rows = statement
        .query_map([], project_from_row)
        .map_err(|error| AppError::Command(format!("Could not read projects database: {error}")))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::Command(format!("Could not decode projects database: {error}")))
}

pub fn read(repo: &Path, slug: &str) -> AppResult<PortfolioProject> {
    let db = connection(repo)?;
    db.query_row(
        "SELECT slug, name, date_label, status, gallery_folder, tags, description, article_html, sort_order
         FROM portfolio_projects WHERE slug = ?1",
        [slug],
        project_from_row,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::Validation(format!("Portfolio project not found: {slug}"))
        }
        other => AppError::Command(format!("Could not read projects database: {other}")),
    })
}
