import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../workbuddy-skills/', import.meta.url);
const required = ['description', 'description_zh', 'description_en', 'version', 'author'];
const names = (await readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
const errors = [];

for (const name of names) {
  const path = new URL(`${name}/SKILL.md`, root);
  const text = await readFile(path, 'utf8').catch(() => '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    errors.push(`${name}: missing YAML frontmatter`);
    continue;
  }
  const fields = new Map(match[1].split(/\r?\n/).map(line => {
    const index = line.indexOf(':');
    return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : ['', ''];
  }));
  if (fields.get('name') !== name) errors.push(`${name}: name must match directory`);
  for (const field of required) if (!fields.get(field)) errors.push(`${name}: missing ${field}`);
  if (!/^\d+\.\d+\.\d+$/.test(fields.get('version') || '')) errors.push(`${name}: version must be semver`);
  if (/\[TODO|TODO:/.test(text)) errors.push(`${name}: unfinished placeholder`);
  if ((await stat(path)).size < 500) errors.push(`${name}: skill body is unexpectedly small`);
}

if (!names.length) errors.push('no WorkBuddy skills found');
if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, skills: names.length, names }, null, 2));
