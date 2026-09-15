import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveRuntime } from '../src/runtime.mjs';
const temp = await mkdtemp(join(tmpdir(), 'matter-test-'));
process.env.WORKBENCH_DATA_DIR = temp;
process.env.WORKBENCH_KNOWLEDGE_DIR = join(temp,'missing-knowledge');
const work = await import('../src/matters.mjs');
const storage = await import('../src/storage.mjs');
after(async()=>{ assert.ok(resolve(temp).startsWith(resolve(tmpdir(), 'matter-test-'))); await rm(temp,{recursive:true,force:true}); });

const source = { id:'source1', hash:'hash1', purpose:'reference', version:'2026年1月原版', scope:'仅制度要求', units:[{id:'L1',label:'第1行',text:'董事会承担市场风险管理的最终责任。'}] };
const payload = {title:'答复',paragraphs:[{text:'依所选制度，董事会承担最终责任。',kind:'source_statement',evidence:[{sourceId:'source1',unitId:'L1',quote:'董事会承担市场风险管理的最终责任。'}]}],missing:[],boundary:'实际执行待核验'};

test('missing knowledge library is explicit and does not prevent a new local matter',async()=>{
  await assert.rejects(work.searchKnowledge('市场风险'),e=>e.statusCode===503 && /先导入事项文件/.test(e.message));
  assert.ok((await work.createMatter({name:'尚未接入资料库'})).project.id);
});

test('business stress tests stay in work; development regressions and discarded runs are references',()=>{
  assert.equal(work.defaultMatter({name:'市场风险压力测试管理办法',files:[{}]}).category,'work');
  assert.equal(work.defaultMatter({name:'整体改进评估回归-1',files:[{}]}).category,'reference');
  assert.equal(work.defaultMatter({name:'初轮-含修订混读-勿用',files:[{}]}).category,'reference');
  assert.equal(work.defaultMatter({name:'未命名审查任务',files:[]}).category,'reference');
});
test('a source quote must exist at the claimed location; style cannot support a fact',()=>{
  assert.equal(work.validateGeneration(payload,[source]).paragraphs[0].evidence[0].location,'第1行');
  const forged=structuredClone(payload); forged.paragraphs[0].evidence[0].quote='高级管理层承担最终责任';
  assert.throws(()=>work.validateGeneration(forged,[source]),/无法匹配/);
  const wrong=structuredClone(payload); wrong.paragraphs[0].evidence[0].unitId='L2';
  assert.throws(()=>work.validateGeneration(wrong,[source]),/无法匹配/);
  assert.throws(()=>work.validateGeneration(payload,[{...source,purpose:'style'}]),/无法匹配/);
  const empty=structuredClone(payload);empty.paragraphs[0].evidence=[];
  assert.throws(()=>work.validateGeneration(empty,[source]),/缺少来源/);
});
test('context changes invalidate results while next-step and status changes do not',()=>{
  const m={...work.defaultMatter({name:'测试',files:[]}),goal:'回答职责',sources:[source]};
  assert.equal(work.contextDigest(m),work.contextDigest({...m,nextStep:'交给用户',status:'finished'}));
  assert.notEqual(work.contextDigest(m),work.contextDigest({...m,asOf:'2027年度'}));
  assert.notEqual(work.contextDigest(m),work.contextDigest({...m,sources:[{...source,scope:'实际执行'}]}));
});
test('path boundary rejects traversal and identifiers cannot leave the project',()=>{
  assert.throws(()=>work.within(temp,'../outside'),/范围/);
  assert.throws(()=>storage.projectDir('../outside'),/identifier/);
});
test('matter updates preserve legacy files and reject stale concurrent edits',async()=>{
  const p=await storage.createProject('原有制度审查'); const before=await readFile(storage.projectManifestPath(p.id),'utf8');
  await work.patchMatter(p.id,{goal:'准备答复',revision:0});
  const results=await Promise.allSettled([work.patchMatter(p.id,{audience:'A',revision:1}),work.patchMatter(p.id,{audience:'B',revision:1})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected')[0].reason.statusCode,409);
  assert.equal(await readFile(storage.projectManifestPath(p.id),'utf8'),before);
});
test('edits create immutable revisions, adoption is explicit, changed context blocks adoption',async()=>{
  const {project,matter}=await work.createMatter({name:'版本验收',goal:'答复'});
  const output={...work.validateGeneration(payload,[source]),id:'output1',kind:'answer',status:'draft',createdAt:new Date().toISOString(),sourceSnapshot:[source],contextDigest:work.contextDigest(matter),evidenceCheck:'quote_match_passed',originalContent:'依所选制度，董事会承担最终责任。'};
  const path=join(storage.projectDir(project.id),'work','outputs','output1.json');await storage.writeJsonAtomic(path,output);
  const revision=await work.saveOutputRevision(project.id,output.id,{content:'根据材料，董事会承担最终责任。'});
  assert.equal(revision.parentId,output.id);assert.equal(revision.evidenceCheck,'edited_requires_review');
  assert.equal((await work.loadOutput(project.id,output.id)).content,output.content);
  assert.deepEqual((await work.getMatter(project.id)).matter.currentOutputs,{});
  await work.adoptOutput(project.id,revision.id);
  assert.equal((await work.getMatter(project.id)).matter.currentOutputs.answer,revision.id);
  await work.patchMatter(project.id,{asOf:'下一年度'});
  assert.ok((await work.getMatter(project.id)).outputs.every(o=>o.stale));
  await assert.rejects(work.adoptOutput(project.id,output.id),/已变化/);
});
test('reusable wording requires explicit adoption and is always a style-only source',async()=>{
  const {project,matter}=await work.createMatter({name:'来源事项'});
  const output={...work.validateGeneration(payload,[source]),id:'output2',kind:'answer',status:'draft',createdAt:new Date().toISOString(),sourceSnapshot:[source],contextDigest:work.contextDigest(matter)};
  await storage.writeJsonAtomic(join(storage.projectDir(project.id),'work','outputs','output2.json'),output);
  const target=await work.createMatter({name:'新事项'});
  await assert.rejects(work.bindSource(target.project.id,{kind:'output',projectId:project.id,id:output.id}),/采用版本/);
  await work.adoptOutput(project.id,output.id);
  const m=await work.bindSource(target.project.id,{kind:'output',projectId:project.id,id:output.id});
  assert.equal(m.sources[0].purpose,'style');
  await assert.rejects(work.changeSource(target.project.id,m.sources[0].id,{purpose:'reference'}),/只能作为表达参考/);
  assert.equal((await work.getMatter(target.project.id)).matter.sources[0].purpose,'style');
  await assert.rejects(work.startGeneration(target.project.id,{kind:'answer',instruction:'请答复'}),/先从资料库/);
});
test('interrupted jobs become failed without discarding saved outputs',async()=>{
  const {project}=await work.createMatter({name:'中断恢复'});
  await storage.writeJsonAtomic(join(storage.projectDir(project.id),'work','jobs','job1.json'),{id:'job1',status:'running',createdAt:new Date().toISOString()});
  const data=await work.getMatter(project.id);assert.equal(data.jobs[0].status,'failed');assert.match(data.jobs[0].error,/服务重启/);
});
test('imported source has an immutable original snapshot and detects changed originals',async()=>{
  const p=await storage.createProject('原件变化检测');
  const sourcePath=join(storage.projectDir(p.id),'snapshots','file1.docx');await writeFile(sourcePath,'original test bytes');
  p.files.push({id:'file1',name:'制度.docx',storedName:'file1.docx',sha256:await storage.hashFile(sourcePath),parse:{status:'ok'}});await storage.saveProject(p);
  await storage.writeJsonAtomic(join(storage.projectDir(p.id),'extracted','file1.forensic.json'),{blocks:[{text:'董事会承担市场风险管理的最终责任。',location:{label:'第1段'}}]});
  const m=await work.bindSource(p.id,{kind:'file',id:'file1'});
  assert.equal(await readFile(m.sources[0].snapshotPath,'utf8'),'original test bytes');
  await writeFile(sourcePath,'changed');
  assert.deepEqual((await work.getMatter(p.id)).sourceChanges,[m.sources[0].id]);
  assert.equal(await readFile(m.sources[0].snapshotPath,'utf8'),'original test bytes');
});

test('Word export preserves edited text and evidence boundaries without template title borders',async()=>{
  const {project,matter}=await work.createMatter({name:'导出核验'});
  const output={...work.validateGeneration(payload,[source]),id:'word1',kind:'answer',createdAt:new Date().toISOString(),sourceSnapshot:[{...source,title:'选定制度'}],contextDigest:work.contextDigest(matter),evidenceCheck:'edited_requires_review',contentCheck:'requires_review'};
  output.content='一、职责分工。依所选制度，董事会承担最终责任。\n\n二、核验边界。实际履职情况需另行核验。';
  await storage.writeJsonAtomic(join(storage.projectDir(project.id),'work','outputs','word1.json'),output);
  const exported=await work.exportOutput(project.id,output.id);
  const {python}=await resolveRuntime();
  await promisify(execFile)(python,['-c',`import sys,zipfile,xml.etree.ElementTree as E
from docx import Document
p=sys.argv[1]
d=Document(p)
assert d.paragraphs[0].text=='答复'
assert any('正文经修改' in x.text for x in d.paragraphs)
assert any('最终责任' in x.text for x in d.paragraphs)
assert next(x for x in d.paragraphs if x.text.startswith('二、')).style.name=='Normal'
with zipfile.ZipFile(p) as z:
 assert not list(E.fromstring(z.read('word/styles.xml')).iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pBdr'))`,exported.path],{windowsHide:true});
});
