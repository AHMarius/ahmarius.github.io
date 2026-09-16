const POST_REQUIRED = ['title', 'slug', 'date', 'status', 'page'];
const PAGE_REQUIRED = ['name', 'slug'];
const POST_STATUSES = ['published', 'draft'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validatePostMeta(meta) {
  const issues = [];
  for (const field of POST_REQUIRED) {
    const value = meta[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      issues.push(`Missing required field '${field}'.`);
    }
  }
  if (meta.status && !POST_STATUSES.includes(meta.status)) {
    issues.push(`status must be one of ${POST_STATUSES.join(', ')}; got '${meta.status}'.`);
  }
  if (meta.status === 'published' && (!meta.date || meta.date === 'null')) {
    issues.push('Published posts must set a date (YYYY-MM-DD).');
  }
  if (meta.slug && !SLUG_RE.test(meta.slug)) {
    issues.push(`Slug '${meta.slug}' is not a lowercase-hyphen slug.`);
  }
  if (meta.date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    issues.push(`date '${meta.date}' is not in YYYY-MM-DD format.`);
  }
  const publishAt = meta.publishAt || meta.publish_at || meta.publishedAt;
  if (publishAt && !/^\d{4}-\d{2}-\d{2}$/.test(publishAt)) {
    issues.push(`publishAt '${publishAt}' is not in YYYY-MM-DD format.`);
  }
  return issues;
}

export function validatePageMeta(meta) {
  const issues = [];
  for (const field of PAGE_REQUIRED) {
    const value = meta[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      issues.push(`Missing required field '${field}'.`);
    }
  }
  if (meta.slug && !SLUG_RE.test(meta.slug)) {
    issues.push(`Slug '${meta.slug}' is not a lowercase-hyphen slug.`);
  }
  return issues;
}

export function schemaErrorsToString(file, issues) {
  if (issues.length === 0) return '';
  return `${file}: ${issues.join('; ')}`;
}

export function assertValidMeta(file, issues, strict) {
  if (issues.length === 0) return;
  const msg = schemaErrorsToString(file, issues);
  if (strict) {
    throw new Error(`Invalid frontmatter in ${msg}`);
  }
  console.warn(`[lint-warning] ${msg}`);
}
