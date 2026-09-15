# Evidence Workbench · 证据工作台

面向复杂任务与材料管理的智能文档工作台，把证据、判断边界和修改决策组合成可复核的工作链。

Evidence Workbench 适用于制度、审计、风控、法务和复杂管理材料。它保存文件版本和原文位置，将确定性核验、语义审查、修改建议与最终采用衔接起来，便于复核每项结论是如何形成的。

[产品介绍页](https://senjj7897-source.github.io/evidence-document-workbench/) · [最新 Release](https://github.com/senjj7897-source/evidence-document-workbench/releases/latest)

## 为什么需要它

复杂材料处理中，原文事实、可确认缺口和风险推断容易混在一起。结论如果没有说明来自哪份文件、哪个版本和哪个位置，就难以复核；材料不完整时，也不能用“未发现问题”代替“当前无法核验”。

Evidence Workbench 把输出约束为：

`原文位置 -> 对比或依据 -> 结论类型 -> 影响 -> 修改建议 -> 处理状态`

## 五项核心能力

1. **多文件实质差异对比**：比较事实、数字、规则、范围、公式和语义变化，不止字符差异。
2. **证据链文档审查**：检查错误、冲突、数据不一致和执行闭环缺口，并主动查找后文与附件反证。
3. **可追溯文档优化**：从准确性、完整性、可执行性、结构、表达和格式等维度提出修改，不改写未知事实。
4. **已采纳文风记忆**：只从明确采用的终稿或指定样本学习表达，不把个案事实迁移到下一份材料。
5. **知识状态治理**：将时效、定稿、材料角色、组织范围和解析质量分开管理，不用文件名或日期代替效力证据。

## WorkBuddy：开箱即用

每项能力分别提供 Codex 与 WorkBuddy 宿主包：正文方法一致，入口元数据按各自官方格式生成和验证。WorkBuddy 用户不需要运行网页应用即可使用核心方法：

1. 从 [最新 Release](https://github.com/senjj7897-source/evidence-document-workbench/releases/latest) 下载任一独立 Skill ZIP。
2. 在 WorkBuddy 的「专家·技能·连接器 -> 技能」中选择添加或导入 Skill。
3. 把待处理文件放进当前工作空间，直接调用 Skill 或用自然语言描述任务。

完整能力包也可解压后运行：

```powershell
.\install-workbuddy-skills.ps1
```

独立包：

| Skill | 适用任务 |
| --- | --- |
| [`evidence-workbench`](skills/evidence-workbench/) | 一次任务涉及多种能力时的总入口 |
| [`multi-document-diff`](skills/multi-document-diff/) | 多文件、版本或口径差异 |
| [`evidence-document-review`](skills/evidence-document-review/) | 错误、冲突、缺口和数据审查 |
| [`traceable-document-improvement`](skills/traceable-document-improvement/) | 修改建议、优化和正式成稿 |
| [`adopted-style-memory`](skills/adopted-style-memory/) | 从已采纳文本积累文风 |
| [`knowledge-status-governance`](skills/knowledge-status-governance/) | 制度状态、版本和知识库治理 |

Codex 版本位于 `skills/`，WorkBuddy 版本位于 `workbuddy-skills/`。Release 中两类宿主包使用明确后缀，避免导入错误。

WorkBuddy 官方格式参考：[Skill 开发说明](https://open.workbuddy.cn/docs/skill)。

## 本地工作台

### 环境

- Windows 10/11
- Node.js 20+
- Python 3.10+
- 首次安装依赖需要网络
- Microsoft Word 为精确页码映射的可选增强项

### 一条命令启动

```powershell
.\install-and-run.ps1
```

打开 `http://127.0.0.1:4180/`。数据默认写入未纳入版本控制的 `workbench-data/`；也可指定独立目录：

```powershell
.\install-and-run.ps1 -DataDirectory 'D:\EvidenceWorkbenchData'
```

Codex 用户还可以一次安装全部 Skills：

```powershell
.\install-codex-skills.ps1
```

## 10 个审查模块

工作台注册了冲突检测、逻辑闭环、数据核验、文字校对、逐句精审、写作优化、版本差异、开放发现、深度建议和整体改进评估。确定性模块可独立运行；语义分析、深度建议和改写需要可用的模型执行器。

## 架构

```text
导入文件或文件夹
        |
        v
不可变快照 + SHA-256
        |
        +--> 审计级解析：页 / 条 / 段 / 表 / 单元格 / 公式 / 修订
        +--> 快速正文：用于检索与语义处理
        |
        v
确定性核验 + 模型语义审查
        |
        v
统一问题库 -> 原文证据 -> 修改建议 -> 人工采用 -> 可追溯复用
```

文件解析、位置、公式、版本、哈希和精确比较由本地代码负责；模型负责语义判断与受控改写。两层可以替换，但不能互相冒充。

## 数据与隐私

此公开仓库经过白名单打包，不包含任何用户导入文件、业务资料、工作台项目、分析结果、个人文风样本、运行日志或本地知识库。应用默认不修改原文件。

“本机 Codex”是调用本机已配置的模型服务，并不等同于离线推理。使用模型时，选定文本可能交给对应模型服务处理。仅确定性核验不调用模型。

## 证据边界

- 处理完成不等于审查完整。
- 审查完整不等于问题已解决。
- 问题已解决不等于材料可直接提交。
- 自动提取文本不证明签章、公式、隐藏区域、修订、批注、版式、正式发布或现行有效。
- 本项目提供审查与知识组织能力，不替代法律、监管、审计或业务责任人的最终判断。

## 验证

```powershell
pnpm install --frozen-lockfile
npm test
```

## 发布物

GitHub Release 提供本地工作台程序包、六个独立 Skill ZIP、完整 Skill 合集及 SHA-256 校验清单。仓库的 GitHub Pages 目录位于 [`docs/`](docs/)。

## 许可

当前版本未附加开源许可证，著作权保留。公开可见不等于授权复制、修改或再分发；如需开放源代码许可，可在后续版本中单独确定。
