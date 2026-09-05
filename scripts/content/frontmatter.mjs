import matter from 'gray-matter';

export function parseFrontmatter(fileContent) {
  const parsed = matter(String(fileContent), {
    engines: {
      yaml: (s) => {
        const obj = {};
        let currentKey = null;
        const lines = s.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          if (/^\s*-\s+/.test(line)) {
            const item = line.replace(/^\s*-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
            if (currentKey) {
              if (!Array.isArray(obj[currentKey])) obj[currentKey] = [];
              obj[currentKey].push(item);
            }
            continue;
          }
          const m = line.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
          if (!m) continue;
          const key = m[1].trim();
          const value = m[2].trim();
          if (value === '') {
            currentKey = key;
            obj[key] = [];
          } else {
            currentKey = null;
            obj[key] = value.replace(/^['"]|['"]$/g, '');
          }
        }
        return obj;
      },
    },
  });
  return { meta: parsed.data || {}, body: (parsed.content || '').trim() };
}

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const str = String(value).replace(/"/g, '\\"');
  return `"${str}"`;
}

export function serializeFrontmatter(meta, body = '') {
  const keys = Object.keys(meta || {});
  const lines = ['---'];
  for (const key of keys) {
    const value = meta[key];
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      const arr = value.filter((v) => v !== undefined && v !== null && v !== '');
      if (arr.length === 0) lines.push('  []');
      for (const item of arr) lines.push(`  - ${String(item).replace(/"/g, '\\"')}`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(value)) {
        lines.push(`  ${k2}: ${yamlScalar(v2)}`);
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---', '');
  const bodyText = String(body || '').trim();
  if (bodyText) lines.push(bodyText);
  return lines.join('\n') + '\n';
}
