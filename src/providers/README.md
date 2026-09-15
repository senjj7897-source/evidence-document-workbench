# AI provider adapter contract

工作台不直接依赖某一个模型。每个语义执行器通过 `registerSemanticProvider()` 注册，最少提供：

```js
registerSemanticProvider({
  id: "provider-id",
  label: "页面展示名称",
  priority: 50,
  capabilities: { analysis: true, rewrite: true, assessment: true },
  isAvailable: async () => true,
  analyze: async ({ projectId, runId, items, modules, model }) => ({
    provider: "provider-id",
    issues: [],
    diagnostics: {},
  }),
  rewrite: async ({ projectId, runId, issue, instruction, model }) => ({
    suggestedText: "",
    rationale: "",
    diagnostics: {},
  }),
  assess: async ({ projectId, runId, items, model }) => ({
    provider: "provider-id",
    assessment: {
      overallRating: "较为完整",
      executiveSummary: "",
      strengths: [],
      items: [],
      roadmap: [],
    },
    diagnostics: {},
  }),
});
```

`assessment` 是独立报告能力，不写入问题清单，也不增加问题数量。`auto` 按优先级选择当前可用的执行器；手动选择则使用精确 `id`。新增 API 模型时，实现对应能力并注册即可，文件快照、模块选择、问题库和导出无需改动。

事项问答和成稿使用同一注册表的可选 `compose` 能力。适配器设置 `capabilities.compose = true`，实现 `compose({projectId, outputStem, prompt, schemaName, timeoutMs})`，返回 `{payload}`；`payload`遵循所给输出Schema。具体模型只负责结构化生成，正文和来源位置验证仍由事项层执行。默认使用`codex-local`，可通过`WORKBENCH_COMPOSE_PROVIDER`指定已注册的其他执行器。
