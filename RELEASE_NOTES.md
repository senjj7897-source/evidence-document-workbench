# Evidence Workbench v0.2.0

面向复杂任务与材料管理的智能文档工作台，把证据、判断边界和修改决策组合成可复核的工作链。

作者：jinlu lv

## 本次发布

- 本地工作台：10 个审查模块，覆盖材料归集、多文件对比、问题审查、证据定位、修改建议、写作优化与知识维护。
- 6 项独立能力：总控编排、多文件差异、证据化审查、可追溯修改、采用式风格记忆、知识状态治理。
- Codex 原生 Skills：保留严格元数据与界面声明，可逐个安装，也可整包安装。
- WorkBuddy 原生 Skills：按照 WorkBuddy Skill 字段和目录结构封装，可逐个导入，也可整包安装。
- 本地优先：工作材料、解析结果和知识库默认留在本机；公开包不含业务文档、历史输出或个人数据。

## 下载选择

- `evidence-document-workbench-v0.2.0.zip`：完整本地工作台源码与安装脚本。
- `evidence-workbench-skills-workbuddy-v1.0.0.zip`：WorkBuddy 六项能力合集。
- `evidence-workbench-skills-codex-v1.0.0.zip`：Codex 六项能力合集。
- 其余压缩包：单项 Skill，可按实际工作流组合安装。
- `SHA256SUMS.txt`：全部发布包的完整性校验值。

## WorkBuddy 使用

在 WorkBuddy 的 Skills 管理界面导入所需的 WorkBuddy 压缩包；如需本地批量安装，可在解压后的项目根目录运行 `install-workbuddy-skills.ps1`。安装脚本不会覆盖同名目录。

## 判断边界

工作台帮助整理证据、暴露矛盾并形成可回溯的修改决策，但不会把缺失材料补写成事实，也不会替代业务、合规或法律上的最终确认。

本仓库暂未附加开源许可证，著作权保留。
