import { quickDefaults, quickFileRole, quickInputError } from './quick-defaults.js';

export function createQuickFlow({ state:S, api, esc, btn, render, route, openMatter, notify }) {
  const sessions=new Map();
  let q = {kind:'lookup',instruction:'',files:[],selected:[],results:null,projectId:null,busy:false,progress:'',error:'',existing:null};
  const button = (label, action, extra='', cls='') => btn(label,action,`type="button" ${extra}`,cls);
  const names = {lookup:'查依据',review:'审材料',draft:'写材料'};
  const selection = () => q.existing?.matter.sources.filter(s=>s.purpose!=='style') || [];
  const totalFiles = () => (q.existing?.project.files.length || 0) + q.files.filter(f=>!f.uploadedId).length;
  function progress(text) { q.progress=text; render(); }
  function start(kind='lookup', existing=null, navigate=true) {
    if(q.busy) { notify('正在处理材料，请稍等。'); return; }
    sessions.set(`${q.kind}:${q.projectId||''}`,q);
    const cached=sessions.get(`${kind}:${existing?.project.id||''}`);
    if(q.kind!==kind || q.projectId!==(existing?.project.id||null)) q=cached?.projectId===(existing?.project.id||null)?cached:{kind,instruction:existing?.matter.goal||'',files:[],selected:[],results:null,projectId:existing?.project.id||null,busy:false,progress:'',error:'',existing};
    S.view='quick'; S.quickKind=kind; S.id=existing?.project.id||null; S.data=existing; S.modal=null;
    if(navigate)route(); render();
    document.querySelector('#quick-instruction')?.focus();
  }
  function fileRows() {
    return [...(q.existing?.project.files||[]).map(f=>`<div class="quick-file"><span>${esc(f.name)}</span><small>${f.parse?.status==='ok'?'已导入':'解析未完成'}</small></div>`), ...q.files.filter(f=>!f.uploadedId).map((f,i)=>`<div class="quick-file"><span>${esc(f.file.name)}</span>${button('移除','quick-remove',`data-id="${f.id}" aria-label="移除 ${esc(f.file.name)}" ${q.busy?'disabled':''}`,'link')}</div>`)].join('');
  }
  function results() {
    if(q.results===null)return '';
    if(!q.results.length)return '<div class="notice">暂未找到相关资料，可以换个制度名、文号或关键词，也可以直接放入文件。</div>';
    return `<section class="quick-results"><h3>${q.kind==='draft'?'选择写作参考资料':'找到的资料'}</h3><p class="small muted">${q.kind==='draft'?'选好后点击“生成文稿”。':''}按原件版本使用，不自动认定现行效力。</p>${q.results.map(r=>`<article class="quick-source"><div class="row">${q.kind==='draft'?`<input type="checkbox" data-quick-source="${r.kb_id}" aria-label="选用 ${esc(r.title)}" ${q.selected.includes(r.kb_id)?'checked':''} ${q.busy?'disabled':''} />`:''}<h3>${esc(r.title)}</h3></div><p>${esc(r.excerpt)}</p><div class="row">${button('查看原文','quick-preview',`data-id="${r.kb_id}"`)}${q.kind==='lookup'?button('根据这份资料回答','quick-answer',`data-id="${r.kb_id}" ${q.busy?'disabled':''}`):''}<span class="small muted">${esc(r.period?.label||'版本请核对原件')}</span></div></article>`).join('')}</section>`;
  }
  function view() {
    const lookup=q.kind==='lookup', review=q.kind==='review';
    return `<div class="quick-page"><div class="heading"><div><h1>${names[q.kind]}</h1><p>${lookup?'搜制度名称、文号，或者直接输入问题。':review?'放入要审的材料，直接开始。':'说清楚要写什么，再放入参考材料。'}</p></div>${button('返回首页','home')}</div><section class="panel quick-panel"><form data-form="quick">
      ${!review?`<label class="field"><span>${lookup?'想查什么':'写作要求'}</span><textarea id="quick-instruction" ${q.busy?'disabled':''} placeholder="${lookup?'例如：2026年1月版管理办法中，季度报告报送给谁？':'例如：根据这些材料写一段300字的正式答复，语气简洁，并区分制度要求与实际情况。'}">${esc(q.instruction)}</textarea></label>`:''}
      ${!lookup?`<div class="quick-drop" data-quick-drop><p>${review?'把文件拖到这里':'放入草稿或参考资料'}</p><div class="row">${button('选择文件','quick-upload',q.busy?'disabled':'')}<small>Word、Excel、PDF</small></div>${fileRows()}</div>`:''}
      ${selection().length?`<div class="small muted">沿用已有的 ${selection().length} 份依据。</div>`:''}
      ${q.kind==='draft'?`<details class="quick-library"><summary>从已有资料库找参考</summary><div class="search-row"><input id="quick-query" aria-label="参考资料关键词" placeholder="制度名、文号或主题" value="${esc(q.searchQuery||'')}" />${button('查找参考','quick-search',q.busy?'disabled':'')}</div></details>`:''}
      ${q.error?`<div class="notice error" role="alert">${esc(q.error)}${q.projectId?`<br><a href="/review.html?project=${q.projectId}">查看材料与解析情况 →</a>`:''}</div>`:''}${q.busy?`<div class="job" role="status"><span class="spinner"></span>${esc(q.progress)}</div>`:''}
      ${results()}
      <div class="row form-actions"><button class="primary" type="submit" ${q.busy?'disabled':''}>${lookup?'查找依据':review?'开始审查':'生成文稿'}</button><span class="small muted">${review?'检查逻辑、矛盾、文字和数据。':lookup?'可直接查看原件，也可根据资料回答。':'完成后可直接修改、复制或导出。'}</span></div>
    </form></section></div>`;
  }
  async function search() {
    const query=(q.searchQuery||q.instruction).trim();
    if(!query)throw new Error('输入要找的制度名、文号或问题。');
    progress('正在查找本地资料…');
    q.results=(await api(`/api/knowledge?q=${encodeURIComponent(query)}`)).results.slice(0,6);
  }
  async function ensureMatter() {
    if(!q.projectId){
      const data=await api('/api/matters',quickDefaults(q.kind,q.instruction,q.files.map(f=>f.file.name)));
      q.projectId=data.project.id; q.existing=data; S.id=data.project.id; S.data=data;
      history.replaceState({},'',`/?quick=${q.kind}&matter=${q.projectId}`);
    }
    for(const f of q.files){
      if(f.uploadedId)continue;
      progress(`正在读取 ${f.file.name}…`);
      const response=await fetch(`/api/projects/${q.projectId}/files`,{method:'POST',headers:{'X-File-Name':encodeURIComponent(f.file.name),'X-File-Role':quickFileRole(f.file.name,q.existing.project.files.length)},body:f.file});
      const data=await response.json(); if(!response.ok)throw new Error(data.error);
      f.uploadedId=data.file.id; q.existing.project=data.project;
      if(data.file.parse?.status!=='ok')throw new Error(`${f.file.name}没有完成解析，已保存文件，请在材料详情中检查。`);
    }
    q.existing=await api(`/api/matters/${q.projectId}`);
    if(q.existing.project.files.some(f=>f.parse?.status!=='ok'))throw new Error('部分文件尚未解析完成，请在“事项详情”中检查后继续。');
  }
  async function writeFromSources(kind='draft', chosenId=null) {
    const selected=chosenId?[chosenId]:q.selected;
    if(!chosenId&&!totalFiles()&&!selection().length&&!selected.length){await search();return;}
    progress('正在准备这次材料…'); await ensureMatter();
    const existing=q.existing.matter.sources;
    const newIds=q.files.map(f=>f.uploadedId);
    const files=q.existing.project.files.filter(f=>!existing.some(s=>s.originKind==='file'&&s.originId===f.id)&&(!selection().length||newIds.includes(f.id)));
    for(const file of files)await api(`/api/matters/${q.projectId}/sources`,{kind:'file',id:file.id});
    for(const id of selected)if(!existing.some(s=>s.originKind==='knowledge'&&s.originId===id))await api(`/api/matters/${q.projectId}/sources`,{kind:'knowledge',id});
    await api(`/api/matters/${q.projectId}/generate`,{kind,instruction:kind==='answer'?`${q.instruction}\n请根据选定资料回答；若用户只输入资料名称，简要说明其内容和适用边界。`:q.instruction});
    await openMatter(q.projectId,kind);
    q.files=[];
  }
  async function guarded(fn) {
    if(q.busy)return;
    q.busy=true;q.error='';
    try{await fn();}catch(e){q.error=e.message;}
    finally{q.busy=false;q.progress='';render();}
  }
  async function submit() {
    const error=quickInputError(q.kind,q.instruction,totalFiles(),q.selected.length);
    if(error){q.error=error;render();return;}
    await guarded(async()=>{
      if(q.kind==='lookup'){await search();return;}
      if(q.kind==='draft'){await writeFromSources();return;}
      progress('正在准备审查…');await ensureMatter();
      await api(`/api/projects/${q.projectId}/analyze`,{modules:['conflict','logic','data','proofread'],provider:'auto'});
      q.files=[];q.busy=false;location.href=`/review.html?project=${q.projectId}`;
    });
  }
  async function action(action, d) {
    if(action==='quick-entry'){start(d.kind);return true;}
    if(action==='quick-upload'){document.querySelector('#quick-upload').click();return true;}
    if(action==='quick-remove'){q.files=q.files.filter(f=>f.id!==d.id);render();return true;}
    if(action==='quick-search'){await guarded(search);return true;}
    if(action==='quick-answer'){await guarded(()=>writeFromSources('answer',d.id));return true;}
    if(action==='quick-preview'){
      const item=await api(`/api/knowledge/item?id=${encodeURIComponent(d.id)}`);
      const start=item.text.indexOf('## 正文');
      S.modal={kind:'preview',title:item.record.title,subtitle:item.record.source_primary,text:start>=0?item.text.slice(start).replace(/^## 正文[^\n]*\n/,''):item.text,original:item.originalAvailable?`/api/knowledge/item?id=${encodeURIComponent(d.id)}&original=1`:null};render();return true;
    }
    return false;
  }
  function addFiles(files){
    if(q.busy)return;
    for(const file of files){
      if(file.size>150*1024*1024){q.error=`${file.name}超过150MB。`;continue;}
      if(!/\.(docx?|xlsx?|xlsm|pdf|csv)$/i.test(file.name)){q.error=`暂不支持 ${file.name}，请使用Word、Excel或PDF。`;continue;}
      if(!q.files.some(f=>f.file.name===file.name&&f.file.size===file.size&&f.file.lastModified===file.lastModified))q.files.push({id:crypto.randomUUID(),file});
    }
    render();
  }
  return {view,start,action,submit,addFiles,get busy(){return q.busy;},get pending(){return q.files.some(f=>!f.uploadedId);},input(t){if(t.id==='quick-instruction')q.instruction=t.value;if(t.id==='quick-query')q.searchQuery=t.value;},change(t){if(t.dataset.quickSource){q.selected=t.checked?[...q.selected,t.dataset.quickSource]:q.selected.filter(id=>id!==t.dataset.quickSource);}}};
}
