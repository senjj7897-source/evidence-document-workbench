import { createQuickFlow } from './quick-flow.js';
const root = document.querySelector('#workspace');
const toast = document.querySelector('#notification');
const uploads = document.querySelector('#material-upload');
const S = { list: [], view: 'home', tab: 'overview', id: null, data: null, scope: 'work', advanced: false, quickKind: 'lookup', query: '', kbQuery: '', results: null, modal: null, busy: false, health: null, chosen: {}, edits: {}, forms: {}, newForm: {}, poll: null };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }) : '';
const sourceLabel = v => ({current_candidate_unverified:'版本与效力待核验',selected_snapshot:'本次选定版本',case_specific_sample:'个案表达样本',searchable:'正文可检索',converted_with_warnings:'已提取，存在解析提示',audit_extracted:'已提取位置证据',partial_spreadsheet:'表格提取范围有限',user_adopted:'用户已采用',internal_policy:'内部制度',regulatory_rule:'监管规定',case_material:'个案材料',reference:'参考资料'}[v] || '请结合原件核验');
const kindName = k => k === 'draft' ? '文稿' : '答复';
const documentTypeName = v => ({archive_container:'压缩资料包',assessment_material:'评估材料',audit_record:'审计记录',data_workpaper:'数据底稿',external_rule:'外部规定',governance_record:'治理记录',internal_policy:'内部制度',ofd_document:'OFD文件',periodic_report:'定期报告',reference_material:'参考资料',reporting_rule:'报送口径资料',subsidiary_governance:'子公司治理资料'}[v] || '参考资料');
const tag = (text, cls = '') => `<span class="tag ${cls}">${esc(text)}</span>`;
const btn = (text, action, extra = '', cls = '') => `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
const api = async (path, body, method = 'POST') => {
  const r = await fetch(path, body === undefined ? {} : { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `请求失败 (${r.status})`);
  return data;
};
let noticeTimer;
function notify(message) { toast.textContent = message; toast.classList.add('visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => toast.classList.remove('visible'), 6000); }
function fields() { return S.forms[S.id] ||= {}; }
function fieldValue(key) { return fields()[key] ?? S.data?.matter?.[key] ?? ''; }
function input(key, label, wide = false, type = 'input') {
  return `<label class="field ${wide ? 'wide' : ''}"><span>${label}</span>${type === 'textarea' ? `<textarea data-field="${key}">${esc(fieldValue(key))}</textarea>` : `<input data-field="${key}" value="${esc(fieldValue(key))}" ${key === 'asOf' ? 'placeholder="例如：2026年1月制度版本 / 2025年度数据"' : ''} />`}</label>`;
}
function reviewLink(version = false) { return `/review.html?project=${S.id}${version ? '&mode=version' : ''}`; }
function activeJob() { return S.data?.jobs.find(j => ['queued','running'].includes(j.status)); }
function outputFor(kind) { return S.data?.outputs.find(o => o.id === S.chosen[kind]) || S.data?.outputs.find(o => o.kind === kind); }
function edited(o) { return S.edits[o.id] ||= { content:o.content, title:o.title, missing:o.missing.join('\n') }; }
function dirty(o) { const e = edited(o); return e.content !== o.content || e.title !== o.title || e.missing !== o.missing.join('\n'); }

function render() {
  const focused = document.activeElement;
  const focusField = focused?.dataset?.field, outputField = focused?.dataset?.outputField, outputId = focused?.dataset?.id;
  const selection = focused?.selectionStart;
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand">专业工作台<small>MATERIALS TO DECISIONS</small></div><nav>${btn('<span class="nav-icon">▦</span>工作事项','home','',S.view !== 'library' ? 'active' : '')}${btn('<span class="nav-icon">⌕</span>查依据','quick-entry','data-kind="lookup"',S.view === 'quick' && S.quickKind === 'lookup' ? 'active' : '')}</nav><div class="sidebar-foot"><p>材料有出处<br>工作可继续，成果可复用</p><p style="margin-top:16px"><a href="/review.html">文档审查工具 ↗</a></p></div></aside><div class="main"><div class="topline"><span>个人工作空间 ${S.id && S.data ? ` / ${esc(S.data.project.name)}` : ''}</span><span><span class="status-dot"></span>${S.health?.providers?.codexLocal ? '本机 AI 可用' : '本地资料与成果'}</span></div><main class="content">${S.view === 'home' ? home() : S.view === 'library' ? library() : S.view === 'quick' ? quickFlow.view() : matterView()}</main></div></div>${modal()}`;
  document.title = `${S.data && S.view === 'matter' ? S.data.project.name : S.view === 'library' ? '资料与依据' : '工作事项'} · 专业工作台`;
  const replacement = focusField ? root.querySelector(`[data-field="${focusField}"]`) : outputField ? root.querySelector(`[data-output-field="${outputField}"][data-id="${outputId}"]`) : null;
  if(replacement){replacement.focus({preventScroll:true});if(typeof selection==='number'&&replacement.setSelectionRange)replacement.setSelectionRange(selection,selection);}
}

function home() {
  const list = S.list.filter(m => S.scope === 'all' || m.category === S.scope);
  return `<div class="heading"><div><div class="eyebrow">YOUR WORK, IN CONTEXT</div><h1>今天要处理什么？</h1><p>选一个入口，直接开始。处理过的内容会留在下面。</p></div>${btn('手动建档','new','','link')}</div>
  <div class="entry-cards">${[['查依据','找制度、看原文、回答具体问题','lookup','⌕'],['审材料','放入文件，直接查看问题','review','☷'],['写材料','说写作要求，直接拿到文稿','draft','✎']].map(([a,b,k,i])=>btn(`<span class="entry-icon">${i}</span><strong>${a}</strong><small>${b}</small><span class="entry-arrow">开始 →</span>`,'quick-entry',`data-kind="${k}"`)).join('')}</div>
  <div class="section-title"><h2>最近处理 <small class="small">${list.length}</small></h2><div class="filters">${[['work','业务事项'],['reference','参考与测试'],['all','全部']].map(([k,t])=>btn(t,'scope',`data-scope="${k}"`,S.scope===k?'active':'')).join('')}</div></div>
  <form data-form="search-matters" class="search-row"><input aria-label="搜索事项或已采用成果" id="matter-search" value="${esc(S.query)}" placeholder="搜索事项名称、背景或已采用的答复" /><button type="submit">搜索</button></form>
  <div class="matter-list">${list.length ? list.map(m=>`<article class="matter-row"><div>${btn(esc(m.name),'open',`data-id="${m.id}"`,'matter-title')} <span>${tag(m.status === 'finished' ? '已归档' : m.status === 'paused' ? '暂缓' : '办理中',m.status==='active'?'green':'')}</span><p>${esc(m.nextStep ? `下一步：${m.nextStep}` : m.goal || m.latestAnswer || '导入材料、明确目标，或继续原有审查。')}</p></div><div class="matter-meta">${m.files} 份材料 · ${m.sources} 份依据<br>${m.adopted} 份采用成果<br>${date(m.updatedAt)}</div>${btn('继续 →','open',`data-id="${m.id}"`)}</article>`).join('') : '<div class="empty"><h3>这里还没有匹配的事项</h3><p>可以新建事项，或调整搜索与分类。</p></div>'}</div>`;
}

function matterView() {
  if (!S.data) return '<div class="empty">正在读取事项…</div>';
  if (!S.advanced && ['answer','draft'].includes(S.tab)) return simpleMatterView();
  const { project, matter:m } = S.data;
  return `<div class="heading"><div><div class="eyebrow">WORK MATTER</div><h1>${esc(project.name)}</h1><div class="meta-line"><span>${esc(m.audience || '受文对象未填写')}</span><span>${esc(m.deliverable || '成果形式未填写')}</span><span>${esc(m.asOf || '适用时期未说明')}</span></div></div><div class="row"><a class="link-button" href="${reviewLink()}">审查材料 ↗</a><a class="link-button" href="${reviewLink(true)}">对比版本 ↗</a>${S.data.outputs.length?btn('回到结果','simple-result'):''}</div></div>
  <nav class="tabs" aria-label="事项工作区">${[['overview','事项概览'],['materials',`依据与材料 (${m.sources.length})`],['answer','问答'],['draft','成稿'],['outputs',`成果 (${S.data.outputs.length})`]].map(([k,t])=>btn(t,'tab',`data-tab="${k}"`,S.tab===k?'active':'')).join('')}</nav>
  ${S.data.sourceChanges.length ? '<div class="notice error">所选原始资料已变化或不可用。当前仍展示保存的依据快照；历史成果需要复核，请重新选择材料。</div>' : ''}
  ${S.tab === 'overview' ? overview() : S.tab === 'materials' ? materials() : ['answer','draft'].includes(S.tab) ? generation(S.tab) : outputsView()}`;
}

function overview() {
  const m = S.data.matter, r = S.data.review;
  return `<div class="two-columns"><section class="panel"><div class="section-title" style="margin-top:0"><h2>这次要办成什么</h2>${tag('自动保留历史材料')}</div><div class="form-grid">${input('goal','事项目标',true,'textarea')}${input('audience','受文对象')}${input('deliverable','交付形式')}${input('asOf','适用时期与口径',true)}${input('nextStep','下一步 / 待补材料',true,'textarea')}<label class="field"><span>事项状态</span><select data-field="status">${[['active','办理中'],['paused','暂缓'],['finished','已归档']].map(([k,t])=>`<option value="${k}" ${(fieldValue('status')||m.status)===k?'selected':''}>${t}</option>`).join('')}</select></label><label class="field"><span>事项分类</span><select data-field="category"><option value="work" ${m.category==='work'?'selected':''}>业务事项</option><option value="reference" ${m.category==='reference'?'selected':''}>参考与测试</option></select></label></div><div class="row form-actions">${btn('保存事项信息','save-meta','','primary')}<span class="small muted">保存背景与口径；原有审查记录继续保留。</span></div></section>
  <aside class="stack"><section class="panel"><h2>继续处理</h2><div class="next-actions"><div>${btn('1. 选定这次使用的依据 →','tab','data-tab="materials"','link')}<p>${m.sources.length} 份已选依据。可从资料库或导入材料选择。</p></div><div>${btn('2. 回答问题或形成文稿 →','tab','data-tab="answer"','link')}<p>按事项目标生成，关键表述保留原文依据。</p></div><div>${btn('3. 核对并保留采用版本 →','tab','data-tab="outputs"','link')}<p>${Object.keys(m.currentOutputs).length} 份当前采用成果。保存修改、导出Word或继续复用。</p></div></div></section><section class="panel"><h3>现有文档审查</h3><div class="review-state">${r ? `<p>${r.count} 条问题，${r.open} 条待处理</p><p class="small muted">${esc(r.stage || r.status)}</p>${r.warnings.length?`<div class="notice">${esc(r.warnings[0])}</div>`:''}` : '<p class="small muted">尚未运行审查。导入的材料可以直接交给现有审查工具。</p>'}</div><a href="${reviewLink()}">打开审查工作区 →</a></section></aside></div>`;
}

function materials() {
  const { project, matter:m } = S.data;
  return `<div class="stack"><section class="panel"><div class="row spread"><div><h2>本次选定的依据</h2><p class="small muted">明确用途与版本。新旧材料都可保留，生成只使用这里选定的内容。</p></div>${btn('从资料库选择','library','','primary')}</div>${m.sources.length ? m.sources.map(s=>`<article class="source"><div class="row spread"><h3>${esc(s.title)}</h3>${tag(s.purpose==='style'?'仅借鉴表达':s.purpose==='case'?'个案材料':'依据原文','green')}</div><p>${esc(s.origin)} · ${s.units.length} 个文本单元</p><div class="small muted">${esc(sourceLabel(s.versionStatus))} · ${esc(sourceLabel(s.extraction))}</div><div class="form-grid"><label class="field"><span>本次用途</span><select id="purpose-${s.id}" ${s.originKind==='output'?'disabled':''}><option value="reference" ${s.purpose==='reference'?'selected':''}>依据原文（效力须另核验）</option><option value="case" ${s.purpose==='case'?'selected':''}>个案材料（文内陈述）</option><option value="style" ${s.purpose==='style'?'selected':''}>仅借鉴表达</option></select></label><label class="field"><span>版本说明</span><input id="version-${s.id}" value="${esc(s.version)}" /></label><label class="field wide"><span>本次适用范围 / 已知边界</span><input id="scope-${s.id}" value="${esc(s.scope)}" /></label></div><div class="row source-actions">${btn('查看保存的原文','source-preview',`data-id="${s.id}"`)}${s.originalPath?`<a class="link-button" href="/api/matters/${S.id}/sources/${s.id}/original" target="_blank" rel="noopener">打开原件</a>`:''}${btn('保存用途与版本','save-source',`data-id="${s.id}"`)}${btn('移出本次依据','remove-source',`data-id="${s.id}"`,'link danger')}</div></article>`).join('') : '<div class="empty"><h3>先选定这次依据什么回答</h3><p>可以在资料库检索制度，也可以将下方导入文件加入本次依据。</p></div>'}</section>
  <section class="panel"><div class="section-title" style="margin-top:0"><div><h2>事项材料</h2><p class="small muted">导入后建立文件快照，并继续用于文档审查。</p></div>${btn('＋ 导入文件','upload',S.busy?'disabled':'')}</div>${project.files.map(f=>`<div class="file-row"><div><strong class="small">${esc(f.name)}</strong><br><small>${f.parse?.status==='ok'?'解析完成':f.parse?.status==='failed'?'解析失败，请在审查页查看原因':'正在解析'} · ${(f.size/1024).toFixed(0)} KB</small></div>${btn(m.sources.some(s=>s.originId===f.id)?'已加入':'加入本次依据','bind-file',`data-id="${f.id}" ${f.parse?.status!=='ok'||m.sources.some(s=>s.originId===f.id)?'disabled':''}`)}</div>`).join('') || '<p class="muted small">还没有导入文件。知识库选择的依据会独立保存，原有审查材料不受影响。</p>'}</section></div>`;
}

function library() {
  return `<div class="heading"><div><div class="eyebrow">SOURCE LIBRARY</div><h1>找到依据，再形成判断。</h1><p>检索本地资料，查看全文与原件后选入当前事项。</p></div>${S.id?btn('返回当前事项','return-matter'):''}</div><section class="panel"><form class="search-row" data-form="search-knowledge"><input id="knowledge-query" aria-label="检索本地资料" value="${esc(S.kbQuery)}" placeholder="输入制度名称、文号或业务问题，例如：风险管理办法 15号" /><button class="primary" type="submit" ${S.busy?'disabled':''}>检索资料</button></form><label class="field" style="max-width:650px"><span>将资料加入哪个事项</span><select id="target-matter"><option value="">请选择事项</option>${S.list.filter(m=>m.category==='work'||m.id===S.id).map(m=>`<option value="${m.id}" ${S.id===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><div class="notice info">检索顺序不代表证据强弱。版本标签由资料索引提供，不能据此认定现行有效；精确措辞及效力请核对原件。</div>${S.results === null ? '<div class="empty"><h3>从一个具体问题开始</h3><p>支持制度名称、文号、年度和业务关键词。</p></div>' : S.results.length ? S.results.map(r=>`<article class="search-result"><h3>${esc(r.title)}</h3><div class="row">${tag(r.period?.label||'时期待核验')}${tag(documentTypeName(r.document_type))}${tag(r.extraction_quality==='searchable'?'有可检索正文':'解析范围有限',r.extraction_quality==='searchable'?'':'amber')}</div><p>${esc(r.excerpt)}</p><div class="small muted">${esc(r.source_primary)}</div><div class="row" style="margin-top:14px">${btn('查看全文与原件','knowledge-preview',`data-id="${r.kb_id}"`)}${btn('加入本次依据','bind-knowledge',`data-id="${r.kb_id}" ${!S.id?'disabled':''}`,'primary')}</div></article>`).join('') : '<div class="empty">没有找到匹配材料，请调整关键词。</div>'}</section>`;
}

function instructionFor(kind) { return fields()[`instruction-${kind}`] ?? S.data?.jobs.find(j=>j.kind===kind)?.instruction ?? outputFor(kind)?.instruction ?? ''; }
function simpleMatterView() {
  const kind=S.tab, job=activeJob(), latest=S.data.jobs.find(j=>j.kind===kind), o=outputFor(kind);
  return `<div class="simple-result"><div class="heading"><div><h1>${kindName(kind)}</h1><p>${esc(S.data.project.name)}</p></div><div class="row">${btn('返回首页','home')}${btn('更多设置','simple-more','','link')}</div></div>
    ${S.data.sourceChanges.length?'<div class="notice error">原始资料已变化或不可用，请核对本次依据。</div>':''}
    ${job?`<div class="panel job" role="status"><span class="spinner"></span><div>${esc(job.stage)}<div class="elapsed">生成后会自动显示，可以先处理其他内容。</div></div></div>`:latest?.status==='failed'?`<div class="notice error" role="alert">${esc(latest.error)}<br>可在下方调整要求后重试，已有结果仍保留。</div>`:''}
    ${o?simpleOutput(o):!job?'<div class="panel empty">还没有生成结果，可以在下方填写要求后开始。</div>':''}
    <details class="panel result-details" ${!o&&!job?'open':''}><summary>${o?'查看要求 / 重新生成':'生成要求'}</summary><label class="field"><span>具体要求</span><textarea data-field="instruction-${kind}">${esc(instructionFor(kind))}</textarea></label><div class="row form-actions">${btn('重新生成','generate',`data-kind="${kind}" ${job||!S.data.matter.sources.some(s=>s.purpose!=='style')?'disabled':''}`)}${btn('调整参考材料','tab','data-tab="materials"','link')}</div></details></div>`;
}
function simpleOutput(o) {
  const e=edited(o), adopted=S.data.matter.currentOutputs[o.kind]===o.id;
  const all=o.paragraphs.flatMap(p=>p.evidence), evidence=all.filter((v,i,a)=>a.findIndex(x=>x.sourceId===v.sourceId&&x.unitId===v.unitId&&x.quote===v.quote)===i);
  const history=S.data.outputs.filter(x=>x.kind===o.kind);
  return `<section class="panel simple-output"><div class="row spread"><h2>直接修改正文</h2>${tag(adopted?'已采用':'草稿',adopted?'green':'')}</div>
    ${o.stale?'<div class="notice error">依据或事项口径已变，这份历史稿需要复核。</div>':''}
    ${o.evidenceCheck==='edited_requires_review'?'<div class="notice">正文已修改，原有引文需结合新文字核对。</div>':''}
    <label class="field result-title"><span>标题</span><input class="output-title" data-output-field="title" data-id="${o.id}" value="${esc(e.title)}" /></label>
    <label class="field"><span class="row spread"><span>正文</span><small data-count-for="${o.id}">${e.content.replace(/\s/g,'').length} 字符</small></span><textarea class="output-body" data-output-field="content" data-id="${o.id}">${esc(e.content)}</textarea></label>
    <div class="row output-toolbar">${btn('复制正文','copy',`data-id="${o.id}"`,'primary')}${btn('导出 Word','export',`data-id="${o.id}"`)}${btn(adopted?'已采用此稿':'采用此稿','adopt',`data-id="${o.id}" ${adopted||o.stale?'disabled':''}`)}<span class="small muted">复制或导出时会保存修改。</span></div>
    <details class="result-details"><summary>待补与待确认${e.missing.trim()?`（${e.missing.split('\n').filter(x=>x.trim()).length}项）`:'（无）'}</summary><label class="field"><span>每行一项</span><textarea data-output-field="missing" data-id="${o.id}">${esc(e.missing)}</textarea></label></details>
    <details class="result-details"><summary>查看依据（${evidence.length}处引文）</summary><p class="small muted">${esc(o.boundary)}</p><div class="evidence-list">${evidence.map(v=>`<div class="evidence"><strong>${esc(v.title)}</strong><p class="small muted">${esc(v.location)} · ${esc(v.version)}</p><blockquote>${esc(v.quote)}</blockquote>${btn('查看原文位置','evidence',`data-id="${o.id}" data-source="${v.sourceId}" data-unit="${v.unitId}"`,'link')}</div>`).join('')}</div></details>
    <details class="result-details"><summary>保存与历史版本（${history.length}版）</summary><div class="row">${btn('保存修改','save-output',`data-id="${o.id}"`)}${adopted?btn('复用这版表达','reuse',`data-id="${o.id}"`):''}</div><p class="small muted">只有明确采用的版本会成为表达参考。</p>${history.map(x=>btn(`<strong>${esc(x.title)}</strong><small>${date(x.createdAt)} · ${x.stale?'需复核':S.data.matter.currentOutputs[x.kind]===x.id?'已采用':'草稿'}</small>`,'choose-output',`data-id="${x.id}" data-kind="${x.kind}"`,'history-item '+(x.id===o.id?'selected':''))).join('')}</details></section>`;
}
async function persistOutput(o) {
  if(!dirty(o))return o;
  const snapshot={...edited(o)}, id=S.id;
  const {output}=await api(`/api/matters/${id}/outputs/${o.id}/revision`,snapshot);
  const current=S.edits[o.id];
  if(current&&Object.keys(snapshot).some(k=>current[k]!==snapshot[k]))S.edits[output.id]={...current};
  delete S.edits[o.id]; S.chosen[o.kind]=output.id;
  await refreshMatter();
  return S.data.outputs.find(x=>x.id===output.id);
}
async function saveNavigationEdits() {
  if(S.view!=='matter'||!S.data)return;
  for(const o of [...S.data.outputs])if(S.edits[o.id]&&dirty(o))await persistOutput(o);
}
function generation(kind) {
  const job = activeJob(), o = outputFor(kind), form = fields();
  const latestJob = S.data.jobs.find(j=>j.kind===kind);
  const defaultInstruction = kind==='answer' ? '请依据选定材料，说明治理架构及报告路径，形成一段可用于正式沟通的表述。区分制度要求和实际执行。' : '根据本事项材料形成正式报告工作稿。先核对事项背景、对象、金额和适用依据；不确定的审批及影响保留待补，语言简练。';
  return `<div class="stack"><section class="panel"><h2>${kind==='answer'?'这次需要回答什么':'这次需要形成什么材料'}</h2><label class="field" style="margin-top:14px"><span>具体要求</span><textarea data-field="instruction-${kind}" placeholder="${esc(defaultInstruction)}">${esc(instructionFor(kind))}</textarea></label><div class="row form-actions">${btn(kind==='answer'?'依据选定材料生成答复':'依据选定材料生成工作稿','generate',`data-kind="${kind}" ${job||S.busy||!S.data.matter.sources.some(s=>s.purpose!=='style')?'disabled':''}`,'primary')}<span class="small muted">本次选定 ${S.data.matter.sources.length} 份材料</span>${btn('查看或调整依据','tab','data-tab="materials"','link')}</div>${!S.data.matter.sources.some(s=>s.purpose!=='style')?'<div class="notice info">请先添加本事项的原始依据。表达参考只能用于措辞和结构。</div>':''}${job?`<div class="job"><span class="spinner"></span><div>${esc(job.stage)}<div class="elapsed">开始于 ${date(job.createdAt)} · 可以查看已有成果，任务会继续运行</div></div></div>`:latestJob?.status==='failed'?`<div class="notice error">${esc(latestJob.error)}<br>已有成果仍保留；本次失败未记为已完成。</div>`:''}</section>${o ? outputEditor(o) : `<section class="panel empty"><h3>${kind==='answer'?'生成的答复会留在这里':'生成的工作稿会留在这里'}</h3><p>正文、原文依据和待补项分开保存。修改后可保留新版本。</p></section>`}</div>`;
}

function outputEditor(o) {
  if (!S.advanced) return simpleOutput(o);
  const e = edited(o), adopted = S.data.matter.currentOutputs[o.kind]===o.id;
  const ev = o.paragraphs.flatMap(p=>p.evidence);
  const unique = ev.filter((v,i,a)=>a.findIndex(x=>x.sourceId===v.sourceId&&x.unitId===v.unitId&&x.quote===v.quote)===i);
  return `<div class="two-columns"><section class="panel"><div class="row spread" style="margin-bottom:18px"><h2>${kindName(o.kind)}工作稿</h2><div class="row">${tag(adopted?'本事项采用版本':'保存的草稿',adopted?'green':'')}${tag(date(o.createdAt))}</div></div>${o.stale?'<div class="notice error">事项口径或依据已变化，这份历史稿需复核。请使用当前依据重新生成。</div>':''}${o.evidenceCheck==='edited_requires_review'?'<div class="notice">正文经过修改。右侧保留的是生成时依据，修改后的对应关系需要复核。</div>':''}<label class="field"><span>标题</span><input data-output-field="title" data-id="${o.id}" value="${esc(e.title)}" /></label><label class="field" style="margin-top:15px"><span>正文 · 可以直接修改 <small data-count-for="${o.id}">${e.content.replace(/\s/g,'').length} 字符</small></span><textarea class="output-body ${o.kind}" data-output-field="content" data-id="${o.id}">${esc(e.content)}</textarea></label><label class="field" style="margin-top:15px"><span>待补与待确认（每行一项）</span><textarea data-output-field="missing" data-id="${o.id}" style="min-height:75px">${esc(e.missing)}</textarea></label><div class="row output-toolbar">${btn('保存修改为新版本','save-output',`data-id="${o.id}"`,'primary')}${btn(adopted?'当前采用版本':'设为本事项采用版本','adopt',`data-id="${o.id}" ${adopted||o.stale?'disabled':''}`)}${adopted?btn('用于其他事项的表达参考','reuse',`data-id="${o.id}"`):''}${btn('复制正文','copy',`data-id="${o.id}"`)}${btn('导出 Word','export',`data-id="${o.id}"`)}</div><p class="small muted" style="margin-top:12px">采用记录表示本次选用这份文字，不代替业务事实核验。Word含来源附件，自动检查文件结构；版式请打开后复核。</p></section>
  <aside class="stack"><section class="panel"><h3>原文依据 ${unique.length}</h3><p class="small muted">引文已匹配原文；含义与适用范围仍需核对。</p><div class="evidence-list">${unique.map(v=>`<div class="evidence"><strong>${esc(v.title)}</strong><p class="small muted">${esc(v.location)} · ${esc(v.version)}</p><blockquote>${esc(v.quote)}</blockquote>${btn('展开原文位置 →','evidence',`data-id="${o.id}" data-source="${v.sourceId}" data-unit="${v.unitId}"`,'link')}</div>`).join('')}</div><details style="margin-top:16px"><summary>本稿适用边界</summary><p class="small muted" style="margin-top:10px">${esc(o.boundary)}</p></details></section><section class="panel"><h3>同类成果历史</h3>${S.data.outputs.filter(x=>x.kind===o.kind).map(x=>btn(`<strong>${esc(x.title)}</strong><small>${date(x.createdAt)} · ${x.stale?'需复核':S.data.matter.currentOutputs[x.kind]===x.id?'本事项采用':'草稿'}${x.parentId?' · 修改版本':''}</small>`,'choose-output',`data-id="${x.id}" data-kind="${x.kind}"`,'history-item '+(x.id===o.id?'selected':''))).join('')}</section></aside></div>`;
}

function outputsView() {
  return `<section class="panel"><h2>保存的成果与采用版本</h2><p class="small muted" style="margin:8px 0 15px">再次打开时，可以继续查看当时的正文、选定依据和修改过程。</p>${S.data.outputs.length?S.data.outputs.map(o=>`<article class="output-card"><div class="row spread"><h3>${esc(o.title)}</h3><div class="row">${tag(kindName(o.kind))}${tag(o.stale?'需复核':S.data.matter.currentOutputs[o.kind]===o.id?'本事项采用版本':'草稿',o.stale?'amber':S.data.matter.currentOutputs[o.kind]===o.id?'green':'')}</div></div><p>${esc(o.content.slice(0,250))}${o.content.length>250?'…':''}</p><div class="row">${btn('继续查看与修改','choose-output',`data-id="${o.id}" data-kind="${o.kind}"`)}${S.data.matter.currentOutputs[o.kind]===o.id?btn('用于其他事项的表达参考','reuse',`data-id="${o.id}"`):''}${btn('导出 Word','export',`data-id="${o.id}"`)}<span class="small muted">${date(o.createdAt)} · ${o.missing.length} 项待补/待确认</span></div></article>`).join(''):'<div class="empty">还没有生成成果。先选择依据，再进入问答或成稿。</div>'}</section>`;
}

function modal() {
  const m = S.modal;
  if (!m) return '';
  if (m.kind === 'reuse') return `<div class="modal-backdrop"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">复用已经采用的表达</h2>${btn('×','close','aria-label="关闭"')}</div><p class="small muted">${esc(m.title)}</p><p class="notice info">仅借鉴结构和表达。业务事实、金额、日期和审批状态仍需目标事项自己的原始依据。</p><label class="field"><span>用于哪个事项</span><select id="reuse-target"><option value="">请选择事项</option>${S.list.filter(x=>x.id!==S.id).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><div class="row form-actions">${btn('加入表达参考并打开','confirm-reuse',`data-id="${m.outputId}"`,'primary')}${btn('取消','close')}</div></section></div>`;
  if (m.kind === 'new') return `<div class="modal-backdrop"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">新建工作事项</h2><p class="small muted">先交代这件事，材料和细节可以随后补充。</p></div>${btn('×','close','aria-label="关闭"')}</div><form data-form="create"><div class="form-grid"><label class="field wide"><span>事项名称</span><input id="new-name" required maxlength="100" placeholder="例如：制度执行情况答复" value="${esc(S.newForm.name||'')}" autofocus /></label><label class="field wide"><span>这次希望完成什么</span><textarea id="new-goal" placeholder="说明任务、受文对象与希望得到的成果">${esc(S.newForm.goal||'')}</textarea></label><label class="field"><span>受文对象</span><input id="new-audience" value="${esc(S.newForm.audience||'')}" placeholder="例如：内部评审或外部沟通" /></label><label class="field"><span>交付形式</span><select id="new-deliverable"><option>正式答复</option><option ${m.next==='draft'?'selected':''}>正式报告</option><option ${m.next==='review'?'selected':''}>审查意见</option><option ${m.next==='version'?'selected':''}>修订说明</option></select></label></div><div class="row form-actions"><button class="primary" type="submit" ${S.busy?'disabled':''}>${S.busy?'正在创建…':'创建并继续'}</button>${btn('取消','close','type="button"')}</div></form></section></div>`;
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${esc(m.title)}</h2><p class="small muted">${esc(m.subtitle||'')}</p></div>${btn('×','close','aria-label="关闭"')}</div>${m.notice?`<div class="notice">${esc(m.notice)}</div>`:''}<div class="source-text" id="source-fulltext">${m.html || esc(m.text)}</div><div class="row">${m.original?`<a class="link-button" target="_blank" rel="noopener" href="${m.original}">打开原件</a>`:''}${m.kbId?btn('加入本次依据','bind-knowledge',`data-id="${m.kbId}" ${!S.id?'disabled':''}`,'primary'):''}${btn('关闭','close')}</div></section></div>`;
}

async function refreshList() { S.list = (await api(`/api/matters?q=${encodeURIComponent(S.view==='home'?S.query:'')}`)).matters; }
async function refreshMatter() { S.data = await api(`/api/matters/${S.id}`); }
function route() { history.pushState({},'',S.view==='quick'?`/?quick=${S.quickKind}${S.id?`&matter=${S.id}`:''}`:S.view==='matter'?`/?matter=${S.id}&tab=${S.tab}${S.advanced?'&advanced=1':''}`:S.view==='library'?`/?view=library${S.id?`&matter=${S.id}`:''}`:'/'); }
async function openMatter(id, tab=null) { S.id=id; S.view='matter'; S.modal=null; await refreshMatter(); if(!tab && S.data.review && !S.data.outputs.length){location.href=reviewLink();return;} S.tab=tab||S.data.outputs[0]?.kind||activeJob()?.kind||'materials'; S.advanced=!['answer','draft'].includes(S.tab); route(); render(); startPoll(); }
function startPoll() {
  clearTimeout(S.poll);
  if (!activeJob()) return;
  const id = S.id;
  S.poll = setTimeout(async()=>{
    try {
      const data = await api(`/api/matters/${id}`);
      if (S.id!==id) return;
      const previous = activeJob(); S.data=data;
      if (!activeJob() && previous) { const done=data.jobs.find(j=>j.id===previous.id); if(done?.outputId) S.chosen[done.kind]=done.outputId; notify(done?.status==='completed'?'草稿已生成，请核对正文与依据。':done?.error||'执行结束'); }
      if (S.view==='matter' && ['answer','draft'].includes(S.tab) && !S.modal && (previous?.stage!==activeJob()?.stage || previous?.status!==activeJob()?.status)) render();
      startPoll();
    } catch(e) { notify(e.message); S.poll=setTimeout(startPoll,5000); }
  },3500);
}

async function runAction(action, b) {
  const d = b.dataset;
  if(quickFlow.busy && ['home','open','new','library','quick-entry'].includes(action)) throw new Error('正在处理文件，请稍等。');
  if(['home','open','quick-entry','library','choose-output','continue-draft','new'].includes(action)) await saveNavigationEdits();
  if(await quickFlow.action(action,d))return;
  if(action==='simple-more'){S.advanced=true;route();render();return;}
  if(action==='simple-result'){S.tab=S.data.outputs[0]?.kind||'answer';S.advanced=false;route();render();return;}
  if(action==='continue-draft'){quickFlow.start('draft',S.data);return;}
  if (action==='close') { S.modal=null; render(); return; }
  if (action==='home') { S.view='home'; S.id=null; S.data=null; await refreshList(); route(); render(); return; }
  if (action==='new'||action==='quick') { S.modal={kind:'new',next:d.kind}; render(); setTimeout(()=>document.querySelector('#new-name')?.focus(),0); return; }
  if (action==='scope') { S.scope=d.scope; render(); return; }
  if (action==='open') { await openMatter(d.id); return; }
  if (action==='tab') { S.advanced=true; S.tab=d.tab; S.view='matter'; route(); render(); startPoll(); return; }
  if (action==='return-matter') { await openMatter(S.id,'materials'); return; }
  if (action==='library') { S.view='library'; await refreshList(); route(); render(); return; }
  if (action==='save-meta') { await api(`/api/matters/${S.id}`,{...fields(),revision:S.data.matter.revision},'PATCH'); S.forms[S.id]={}; await refreshMatter(); render(); notify('事项背景和下一步已保存'); return; }
  if (action==='upload') { uploads.click(); return; }
  if (action==='bind-file'||action==='bind-knowledge') {
    if (!S.id) throw new Error('请先选择要加入的事项');
    await api(`/api/matters/${S.id}/sources`,{kind:action==='bind-file'?'file':'knowledge',id:d.id});
    await refreshMatter(); S.modal=null; render(); notify('已保存本次依据快照，可以继续问答或成稿。'); return;
  }
  if (action==='knowledge-preview') {
    const item=await api(`/api/knowledge/item?id=${encodeURIComponent(d.id)}`);
    S.modal={kind:'preview',title:item.record.title,subtitle:item.record.source_primary,text:item.text.includes('## 正文')?item.text.slice(item.text.indexOf('## 正文')).replace(/^## 正文[^\n]*\n/, ''):item.text.replace(/^---[\s\S]*?---\s*/,''),kbId:d.id,notice:'此处为检索提取稿，版本标签及效力需对照原件核验。',original:item.originalAvailable?`/api/knowledge/item?id=${encodeURIComponent(d.id)}&original=1`:null}; render(); return;
  }
  if (action==='source-preview'||action==='evidence') {
    const o=action==='evidence'?S.data.outputs.find(o=>o.id===d.id):null;
    const s=o?o.sourceSnapshot.find(s=>s.id===d.source):S.data.matter.sources.find(s=>s.id===d.id);
    S.modal={kind:'preview',title:s.title,subtitle:`${s.version} · ${s.scope}`,html:s.units.map(u=>`<div ${u.id===d.unit?'id="selected-unit" style="background:#fff0cb;padding:8px"':''}><span class="muted small">[${esc(u.label)}]</span> ${esc(u.text)}</div>`).join(''),original:s.originalPath&&S.data.matter.sources.some(x=>x.id===s.id)?`/api/matters/${S.id}/sources/${s.id}/original`:null}; render(); setTimeout(()=>document.querySelector('#selected-unit')?.scrollIntoView({block:'center'}),0); return;
  }
  if (action==='save-source'||action==='remove-source') {
    const body=action==='save-source'?{purpose:document.querySelector(`#purpose-${d.id}`).value,version:document.querySelector(`#version-${d.id}`).value,scope:document.querySelector(`#scope-${d.id}`).value,revision:S.data.matter.revision}:{};
    await api(`/api/matters/${S.id}/sources/${d.id}`,body,action==='save-source'?'PATCH':'DELETE'); await refreshMatter(); render(); notify('本次依据已更新，旧成果会保留并提示复核。'); return;
  }
  if (action==='generate') {
    const instruction=instructionFor(d.kind);
    if (!instruction.trim()) throw new Error('请填写这次需要回答的问题或成稿要求');
    if(Object.keys(fields()).some(k=>!k.startsWith('instruction-'))) throw new Error('事项信息尚未保存，请先在概览中保存背景与口径。');
    await api(`/api/matters/${S.id}/generate`,{kind:d.kind,instruction}); await refreshMatter(); render(); startPoll(); return;
  }
  if (action==='choose-output') { S.advanced=false; S.chosen[d.kind]=d.id; S.tab=d.kind; route(); render(); return; }
  let o=S.data?.outputs.find(o=>o.id===d.id);
  if(['adopt','copy','export'].includes(action)&&o){o=await persistOutput(o);render();}
  if (action==='reuse') {
    if(dirty(o)) throw new Error('请先保存并采用当前修改，再复用表达');
    S.list=(await api('/api/matters')).matters; S.modal={kind:'reuse',outputId:o.id,title:o.title}; render(); return;
  }
  if (action==='confirm-reuse') {
    const target=document.querySelector('#reuse-target').value;
    if(!target) throw new Error('请选择接收表达参考的事项');
    await api(`/api/matters/${target}/sources`,{kind:'output',projectId:S.id,id:d.id});
    await openMatter(target,'materials'); notify('表达参考已加入；生成时需另选事实依据。'); return;
  }
  if (action==='save-output') {
    if (!dirty(o)) { notify('正文与保存版本一致'); return; }
    const result=await api(`/api/matters/${S.id}/outputs/${o.id}/revision`,edited(o)); delete S.edits[o.id]; S.chosen[o.kind]=result.output.id; await refreshMatter(); render(); notify('修改已保存为新版本，旧稿仍保留。'); return;
  }
  if (action==='adopt') {
    if(dirty(o)) throw new Error('请先保存当前修改，再设为采用版本');
    await api(`/api/matters/${S.id}/outputs/${o.id}/adopt`,{}); await refreshMatter(); render(); notify('已记录为本事项采用版本，可在首页搜索复用。'); return;
  }
  if (action==='copy') { await navigator.clipboard.writeText(edited(o).content); notify('正文已复制'); return; }
  if (action==='export') {
    if(dirty(o)) throw new Error('请先保存修改，再导出对应版本');
    notify('正在生成 Word，并检查正文完整性…');
    const response=await fetch(`/api/matters/${S.id}/outputs/${o.id}/docx`);
    if(!response.ok) throw new Error((await response.json()).error);
    const blob=await response.blob(), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=`${o.title}.docx`; document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);notify('Word已导出，包含正文、待补项和来源附件。');return;
  }
}

let actionBusy=false;
root.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
  if(actionBusy)return;
  actionBusy=true;
  b.disabled=true;
  try { await runAction(b.dataset.action,b); } catch(error) { notify(error.message); } finally { actionBusy=false;if(b.isConnected)b.disabled=false; }
});
root.addEventListener('input',e=>{
  const t=e.target;
  quickFlow.input(t);
  if(t.dataset.field)fields()[t.dataset.field]=t.value;
  if(t.dataset.outputField) { const o=S.data.outputs.find(o=>o.id===t.dataset.id); edited(o)[t.dataset.outputField]=t.value; if(t.dataset.outputField==='content'){const count=root.querySelector(`[data-count-for="${o.id}"]`);if(count)count.textContent=`${t.value.replace(/\s/g,'').length} 字符`;} }
  if(t.id.startsWith('new-'))S.newForm[t.id.slice(4)]=t.value;
});
root.addEventListener('change',async e=>{
  quickFlow.change(e.target);
  if(e.target.dataset.field)fields()[e.target.dataset.field]=e.target.value;
  if(e.target.id==='target-matter'){S.id=e.target.value||null;if(S.id)await refreshMatter();render();}
});
root.addEventListener('submit',async e=>{
  const form=e.target;if(!form.dataset.form)return;e.preventDefault();if(S.busy)return;
  if(form.dataset.form==='quick'){await quickFlow.submit();return;}
  const submit=form.querySelector('[type="submit"]');S.busy=true;if(submit)submit.disabled=true;
  try {
    if(form.dataset.form==='create') {
      const next=S.modal.next;
      const payload=await api('/api/matters',{name:document.querySelector('#new-name').value,goal:document.querySelector('#new-goal').value,audience:document.querySelector('#new-audience').value,deliverable:document.querySelector('#new-deliverable').value});
      S.newForm={};await refreshList();await openMatter(payload.project.id,next==='review'||next==='version'?'materials':'overview');
    } else if(form.dataset.form==='search-matters'){S.query=document.querySelector('#matter-search').value;await refreshList();}
    else {S.kbQuery=document.querySelector('#knowledge-query').value;S.results=(await api(`/api/knowledge?q=${encodeURIComponent(S.kbQuery)}`)).results;}
  } catch(error){notify(error.message);}finally{S.busy=false;render();}
});
uploads.addEventListener('change',async()=>{
  const files=[...uploads.files];uploads.value='';if(!S.id||!files.length)return;S.busy=true;
  try{for(const f of files){notify(`正在导入并解析：${f.name}`);const r=await fetch(`/api/projects/${S.id}/files`,{method:'POST',headers:{'X-File-Name':encodeURIComponent(f.name),'X-File-Role':'attachment'},body:f});const payload=await r.json();if(!r.ok)throw new Error(payload.error);}await refreshMatter();notify('材料已导入，请选择要用于问答或成稿的依据。');}
  catch(e){notify(e.message);}finally{S.busy=false;render();}
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.modal){S.modal=null;render();}});
window.addEventListener('beforeunload',e=>{if(quickFlow.pending||quickFlow.busy||S.data?.outputs.some(o=>S.edits[o.id]&&dirty(o))||Object.keys(S.forms[S.id]||{}).some(k=>!k.startsWith('instruction-'))){e.preventDefault();e.returnValue='';}});
async function init(){
  try{
    S.health=await api('/api/health');
    const p=new URLSearchParams(location.search);
    S.id=p.get('matter'); S.data=S.id?await api(`/api/matters/${S.id}`):null;
    if(p.has('quick')){
      await refreshList();quickFlow.start(['lookup','review','draft'].includes(p.get('quick'))?p.get('quick'):'lookup',S.data,false);return;
    }
    S.view=p.get('view')==='library'?'library':S.id?'matter':'home';
    await refreshList();
    if(S.id){
      if(S.view==='matter'&&!p.get('tab')&&S.data.review&&!S.data.outputs.length){location.replace(reviewLink());return;}
      S.tab=p.get('tab')||S.data.outputs[0]?.kind||activeJob()?.kind||'materials';
      S.advanced=p.get('advanced')==='1'||!['answer','draft'].includes(S.tab);
    }
    render();startPoll();
  }catch(e){root.innerHTML=`<div class="empty"><h2>工作台暂时无法读取</h2><p>${esc(e.message)}</p><a href="/">返回首页</a></div>`;}
}
window.addEventListener('popstate',async()=>{clearTimeout(S.poll);try{await saveNavigationEdits();await init();}catch(e){notify(e.message);}});
const quickFlow=createQuickFlow({state:S,api,esc,btn,render,route,openMatter,notify});
const quickUpload=document.querySelector('#quick-upload');
quickUpload.addEventListener('change',()=>{quickFlow.addFiles([...quickUpload.files]);quickUpload.value='';});
root.addEventListener('dragover',e=>{if(e.target.closest('[data-quick-drop]'))e.preventDefault();});
root.addEventListener('drop',e=>{if(e.target.closest('[data-quick-drop]')){e.preventDefault();quickFlow.addFiles([...e.dataTransfer.files]);}});
init();
