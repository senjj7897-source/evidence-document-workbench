import test from 'node:test';
import assert from 'node:assert/strict';
import {quickDefaults, quickFileRole, quickInputError} from '../app/quick-defaults.js';

test('quick entry derives names without inventing audience, dates or approval facts',()=>{
  const result=quickDefaults('draft','写一份关于报告路径的说明。约300字',['市场风险管理办法.docx']);
  assert.equal(result.name,'写材料 · 市场风险管理办法');
  assert.equal(result.goal,'写一份关于报告路径的说明。约300字');
  assert.equal(result.audience,undefined);
  assert.equal(result.asOf,undefined);
  assert.ok(quickDefaults('lookup','很长的问题'.repeat(100)).name.length<=100);
});
test('quick review recognizes data files without guessing new and old document versions',()=>{
  assert.equal(quickFileRole('数据.XLSX',0),'data');
  assert.equal(quickFileRole('新稿.docx',0),'main');
  assert.equal(quickFileRole('旧稿.docx',1),'attachment');
});
test('quick entry only requires information necessary for the chosen action',()=>{
  assert.equal(quickInputError('review','',1),'');
  assert.match(quickInputError('review','',0),/放入/);
  assert.match(quickInputError('draft','',1),/要写什么/);
  assert.equal(quickInputError('draft','写份说明',0),'');
  assert.match(quickInputError('draft','说明',10,3),/12份/);
});
