import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWithProvider, composeWithProvider, listSemanticProviders, registerSemanticProvider, resolveSemanticProvider, rewriteWithProvider } from "../src/providers/index.mjs";

test("replaceable provider registry supports discovery, exact selection and shared contracts", async () => {
  registerSemanticProvider({
    id: "contract-test",
    label: "合约测试模型",
    priority: 1000,
    capabilities: { analysis: true, rewrite: true },
    isAvailable: async () => true,
    analyze: async ({ modules }) => ({ issues: [{ module: modules[0] }], diagnostics: { mocked: true } }),
    rewrite: async ({ instruction }) => ({ suggestedText: `候选：${instruction}`, rationale: "mock", diagnostics: { mocked: true } }),
  });
  const providers = await listSemanticProviders();
  assert.ok(providers.some(provider => provider.id === "codex-local"));
  assert.ok(providers.some(provider => provider.id === "contract-test" && provider.available));
  assert.equal((await resolveSemanticProvider("contract-test", "analysis")).id, "contract-test");
  const analysis = await analyzeWithProvider({ providerId: "contract-test", modules: ["logic"] });
  assert.equal(analysis.provider, "contract-test");
  assert.equal(analysis.issues[0].module, "logic");
  const rewrite = await rewriteWithProvider({ providerId: "contract-test", instruction: "简洁" });
  assert.equal(rewrite.provider, "contract-test");
  assert.equal(rewrite.suggestedText, "候选：简洁");
});

test('work composition uses the replaceable provider contract and rejects missing capabilities', async () => {
  const expected = {title:'答复',paragraphs:[],missing:[],boundary:'选定材料范围'};
  registerSemanticProvider({id:'compose-test',label:'成稿合约测试',analyze:async()=>({issues:[]}),compose:async args=>{
    assert.equal(args.schemaName,'work-output.schema.json');
    assert.equal(args.prompt,'用户选定的上下文');
    return {payload:expected};
  }});
  const result=await composeWithProvider({providerId:'compose-test',schemaName:'work-output.schema.json',prompt:'用户选定的上下文'});
  assert.equal(result.provider,'compose-test');
  assert.deepEqual(result.payload,expected);
  registerSemanticProvider({id:'no-compose',label:'无成稿能力',capabilities:{analysis:true,compose:true},analyze:async()=>({issues:[]})});
  await assert.rejects(resolveSemanticProvider('no-compose','compose'),/不可用/);
});
