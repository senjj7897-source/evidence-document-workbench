import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../', import.meta.url);
const ignored = new Set(['.git', '.sites-runtime', '.smoke-data', 'dist', 'node_modules', 'workbench-data', 'knowledge-base', '__pycache__']);
const forbiddenExtensions = new Set(['.docx', '.docm', '.xlsx', '.xlsm', '.pdf', '.zip', '.pyc']);
const sensitive = [
  /C:\\Users\\[^\\\s]+/i,
  /LAN-Share/i,
  /xwechat|wxid_/i,
  /gh[opsu]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /青岛银行/,
];
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('release-artifacts')) continue;
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    const file = decodeURIComponent(path.pathname).replace(/^\/(.:)/, '$1');
    const display = relative(decodeURIComponent(root.pathname).replace(/^\/(.:)/, '$1'), file).replaceAll('\\', '/');
    if (display === 'scripts/validate-public-source.mjs') continue;
    if (forbiddenExtensions.has(extname(entry.name).toLowerCase())) {
      findings.push(`${display}: forbidden binary type`);
      continue;
    }
    if (!/\.(?:md|mjs|js|json|yaml|yml|html|css|svg|ps1|py|txt)$/i.test(entry.name)) continue;
    const text = await readFile(path, 'utf8').catch(() => '');
    for (const pattern of sensitive) if (pattern.test(text)) findings.push(`${display}: matches ${pattern}`);
  }
}

await walk(root);
if (findings.length) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, message: 'public source boundary passed' }));
