import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { getMatter, listMatters, createMatter, patchMatter, searchKnowledge, knowledgeItem, bindSource, changeSource, startGeneration, saveOutputRevision, adoptOutput, exportOutput } from './matters.mjs';

function sendFile(response, path, filename) {
  const types = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
    'Content-Disposition': `${extname(path) === '.pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  createReadStream(path).on('error', () => response.destroy()).pipe(response);
}

export async function handleWorkApi(request, response, url, { sendJson, readJsonBody }) {
  const method = request.method;
  const json = data => { sendJson(response, 200, data); return true; };
  if (url.pathname === '/api/knowledge' && method === 'GET') return json({ results: await searchKnowledge(url.searchParams.get('q')) });
  if (url.pathname === '/api/knowledge/item' && method === 'GET') {
    const item = await knowledgeItem(url.searchParams.get('id'));
    if (url.searchParams.get('original') === '1') {
      if (!item.originalAvailable) { sendJson(response, 404, { error: '原件当前不可用，提取稿仍可查看。' }); return true; }
      sendFile(response, item.originalPath, item.record.title + extname(item.originalPath)); return true;
    }
    return json(item);
  }
  if (url.pathname === '/api/matters') {
    if (method === 'GET') return json({ matters: await listMatters(url.searchParams.get('q') || '') });
    if (method === 'POST') return json(await createMatter(await readJsonBody(request)));
  }
  const match = url.pathname.match(/^\/api\/matters\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
  if (!match) return false;
  const [, id, action = ''] = match;
  if (!action && method === 'GET') return json(await getMatter(id));
  if (!action && method === 'PATCH') return json({ matter: await patchMatter(id, await readJsonBody(request)) });
  if (action === 'sources' && method === 'POST') return json({ matter: await bindSource(id, await readJsonBody(request)) });
  const sourceMatch = action.match(/^sources\/([a-zA-Z0-9_-]+)(\/original)?$/);
  if (sourceMatch) {
    if (sourceMatch[2] && method === 'GET') {
      const { matter } = await getMatter(id);
      const source = matter.sources.find(s => s.id === sourceMatch[1]);
      if (!source?.originalPath) { sendJson(response, 404, { error: '原件不可用' }); return true; }
      sendFile(response, source.snapshotPath || source.originalPath, source.title + extname(source.snapshotPath || source.originalPath)); return true;
    }
    if (['PATCH', 'DELETE'].includes(method)) return json({ matter: await changeSource(id, sourceMatch[1], await readJsonBody(request), method === 'DELETE') });
  }
  if (action === 'generate' && method === 'POST') {
    sendJson(response, 202, { job: await startGeneration(id, await readJsonBody(request)) }); return true;
  }
  const out = action.match(/^outputs\/([a-zA-Z0-9_-]+)\/(revision|adopt|docx)$/);
  if (out) {
    if (out[2] === 'revision' && method === 'POST') return json({ output: await saveOutputRevision(id, out[1], await readJsonBody(request)) });
    if (out[2] === 'adopt' && method === 'POST') return json({ matter: await adoptOutput(id, out[1]) });
    if (out[2] === 'docx' && method === 'GET') {
      const result = await exportOutput(id, out[1]);
      sendFile(response, result.path, result.output.title + '.docx'); return true;
    }
  }
  return false;
}
