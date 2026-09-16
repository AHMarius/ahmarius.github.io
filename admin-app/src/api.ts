import { invoke } from "@tauri-apps/api/core";

export interface PostMetaInput {
  title: string;
  slug: string;
  date: string;
  updated_date: string;
  status: string;
  publish_at: string;
  excerpt: string;
  featured: boolean;
  comments: boolean;
  page: string;
  project: string;
  subtitle: string;
  cover: string;
  series: string;
  part: number;
  tags: string[];
  technologies: string[];
}

export interface PostInput {
  page_slug: string;
  original_slug?: string;
  draft_asset_slug?: string;
  meta: PostMetaInput;
  body: string;
}

export interface PageInput {
  name: string;
  slug: string;
  description: string;
  cover: string;
  parent: string | null;
  order: number | null;
  kind: string;
  devlog_repo: string;
}

export interface PageRow {
  slug: string;
  name: string;
  description: string;
  cover: string;
  parent: string | null;
  order: number;
  kind: string;
  devlog_repo: string;
  path: string;
}

export interface PostRow {
  title: string;
  slug: string;
  date: string;
  updated_date: string;
  status: string;
  publish_at: string;
  excerpt: string;
  featured: boolean;
  comments: boolean;
  page: string;
  project: string;
  tags: string[];
  technologies: string[];
  series: string;
  part: number;
  path: string;
}

export interface ProjectInput {
  slug: string;
  name: string;
  repo_url: string;
  live_url: string;
  status: string;
  description: string;
  cover: string;
}

export interface ProjectRow {
  slug: string;
  name: string;
  repo_url: string;
  live_url: string;
  status: string;
  description: string;
  cover: string;
  post_count: number;
  path: string;
}

export interface PortfolioProject {
  slug: string;
  name: string;
  date_label: string;
  status: string;
  gallery_folder: string;
  tags: string[];
  description: string;
  article_html: string;
  sort_order: number;
}

export interface ContentNode {
  id: string;
  type_: string;
  slug: string;
  name: string;
  status: string;
  kind?: string;
  path: string;
  updated_date: string;
  children: ContentNode[];
}

export interface GitStatusSummary {
  branch: string;
  remote: string | null;
  ahead: number;
  behind: number;
  staged: { status: string; path: string }[];
  unstaged: { status: string; path: string }[];
  untracked: string[];
  unrelated_modified: string[];
  repo_path: string;
}

export interface BuildResult {
  success: boolean;
  output: string;
  warnings: string[];
  built_pages: boolean;
  mode: string;
}

export interface SiteBuildInfo {
  generated_at: string | null;
  devlog_posts: number;
  devlog_index: boolean;
  feed_generated: boolean;
  sitemap_generated: boolean;
  robots_generated: boolean;
  search_index_generated: boolean;
  archive_folders: string[];
}

export interface LintIssue {
  severity: "error" | "warning";
  message: string;
  file: string;
  line: number | null;
}

export interface LintReport {
  issues: LintIssue[];
  warnings_count: number;
  errors_count: number;
}

export interface DeployHookResult {
  ok: boolean;
  status: number | null;
  detail: string;
}

export interface AiMetadata {
  title: string | null;
  excerpt: string | null;
  tags: string[];
  technologies: string[];
}

export interface AnalyticsSummary {
  script_url: string | null;
  website_id: string | null;
  tracking_enabled: boolean;
}

export interface CrossPostPreview {
  via: string;
  text: string;
  truncated: boolean;
}

export interface ExportResult {
  ok: boolean;
  out_path: string | null;
  detail: string;
}

export interface PdfImportResult {
  title: string;
  text: string;
  page_count: number | null;
  is_image_only: boolean;
}

export interface ImportAssetResult {
  file_name: string;
  rel_path: string;
  warning: string | null;
}

export interface PostDoc {
  title: string;
  slug: string;
  date: string;
  updatedDate: string;
  status: string;
  publishAt: string;
  excerpt: string;
  featured: boolean;
  comments: boolean;
  page: string;
  project: string;
  subtitle: string;
  cover: string;
  series: string;
  part: number;
  tags: string[];
  technologies: string[];
  body: string;
}

export interface PageDoc {
  name: string;
  slug: string;
  description: string;
  cover: string;
  order: number;
  kind: string;
  devlog_repo: string;
  parent: string | null;
}

export interface CommitInfo {
  hash: string;
  date: string;
  subject: string;
}

export const api = {
  getPrefs: () => invoke<any>("get_prefs"),
  setPrefs: (prefs: any) => invoke("set_prefs", { prefs }),
  scanContent: () => invoke<ContentNode[]>("scan_content"),
  readPage: (slug: string) => invoke<PageDoc>("read_page", { slug }),
  createPage: (page: PageInput) => invoke<PageRow>("create_page", { page }),
  updatePage: (page: PageInput) => invoke("update_page", { page }),
  deletePage: (slug: string) => invoke("delete_page", { slug }),
  readPost: (pageSlug: string, postSlug: string) =>
    invoke<PostDoc>("read_post", { pageSlug, postSlug }),
  writePost: (input: PostInput) => invoke<string>("write_post", { input }),
  deletePost: (pageSlug: string, postSlug: string) =>
    invoke("delete_post", { pageSlug, postSlug }),
  listProjects: () => invoke<ProjectRow[]>("list_projects"),
  listPortfolioProjects: () => invoke<PortfolioProject[]>("list_portfolio_projects"),
  readPortfolioProject: (slug: string) =>
    invoke<PortfolioProject>("read_portfolio_project", { slug }),
  readProject: (slug: string) =>
    invoke<ProjectRow & { post_count: number }>("read_project", { slug }),
  createProject: (project: ProjectInput) =>
    invoke<ProjectRow>("create_project", { project }),
  updateProject: (project: ProjectInput) => invoke("update_project", { project }),
  deleteProject: (slug: string) => invoke("delete_project", { slug }),
  importAsset: (
    pageSlug: string,
    postSlug: string,
    sourcePath: string,
    originalName: string,
  ) =>
    invoke<ImportAssetResult>("import_asset", {
      pageSlug,
      postSlug,
      sourcePath,
      originalName,
    }),
  importAssetBytes: (
    pageSlug: string,
    postSlug: string,
    fileName: string,
    data: number[],
  ) =>
    invoke<ImportAssetResult>("import_asset_bytes", {
      pageSlug,
      postSlug,
      fileName,
      data,
    }),
  captureScreenshot: (pageSlug: string, postSlug: string) =>
    invoke<ImportAssetResult>("capture_screenshot", { pageSlug, postSlug }),
  pickFile: (filterName?: string, filterExts?: string[]) =>
    invoke<string | null>("pick_file", { filterName, filterExts }),
  importPdf: (sourcePath: string) =>
    invoke<PdfImportResult>("import_pdf", { sourcePath }),
  buildSite: (mode?: string) => invoke<BuildResult>("build_site", { mode }),
  latestSiteBuild: () => invoke<SiteBuildInfo>("latest_site_build"),
  lintPosts: () => invoke<LintReport>("lint_posts"),
  triggerDeployHook: (hookUrl?: string) =>
    invoke<DeployHookResult>("trigger_deploy_hook", { hookUrl }),
  suggestMetadata: (body: string, currentTitle: string) =>
    invoke<AiMetadata>("suggest_metadata", { body, currentTitle }),
  analyticsSummary: () => invoke<AnalyticsSummary>("analytics_summary"),
  trackUmamiEvent: (url: string, title: string) =>
    invoke("track_umami_event", { url, title }),
  crosspostPreview: (title: string, excerpt: string, url: string, via: string) =>
    invoke<CrossPostPreview>("crosspost_preview", { title, excerpt, url, via }),
  exportPost: (pageSlug: string, postSlug: string) =>
    invoke<ExportResult>("export_post", { pageSlug, postSlug }),
  gitStatus: () => invoke<GitStatusSummary>("git_status"),
  gitDiffSummary: (staged: boolean) => invoke<any[]>("git_diff_summary", { staged }),
  gitDiff: (staged: boolean) => invoke<string>("git_diff", { staged }),
  gitLog: (repoPath: string, count?: number) =>
    invoke<CommitInfo[]>("git_log", { repoPath, count }),
  gitStagePaths: (paths: string[]) => invoke("git_stage_paths", { paths }),
  gitCommit: (message: string) => invoke<string>("git_commit", { message }),
  gitUnstage: (paths?: string[]) => invoke("git_unstage", { paths }),
  gitPush: (branch: string) => invoke<string>("git_push", { branch }),
  deployPages: () => invoke<string>("deploy_pages"),
  gitLastCommit: () => invoke<string>("git_last_commit"),
  gitAuthStatus: () => invoke<any>("git_auth_status"),
  checkRepo: (repoPath: string) =>
    invoke<any>("check_repo", { repoPath }),
  saveRecovery: (key: string, content: string, metadata?: Record<string, unknown>) =>
    invoke("save_recovery", { key, content, metadata }),
  loadRecovery: (key: string) => invoke<{ content: string; metadata?: Record<string, unknown> } | null>("load_recovery", { key }),
  clearRecovery: (key: string) => invoke("clear_recovery", { key }),
  listRecovery: () =>
    invoke<{ key: string; saved_at: string; prelude: string; bytes: number }[]>("list_recovery"),
  listTrash: () =>
    invoke<{ id: string; kind: string; name: string; deleted_at: string; files: number }[]>("list_trash"),
  restoreDeleted: (id: string) => invoke("restore_deleted", { id }),
  emptyTrash: () => invoke<number>("empty_trash"),
};
