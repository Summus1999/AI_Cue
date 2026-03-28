# AI_Cue Agent Harness 文档

> 本文档是 AI Agent 在 AI_Cue 项目中的操作指南和约束规范。
> 每次会话开始时，Agent 必须阅读此文档。
> 当 Agent 犯错时，人类工程师应更新此文档以改进约束。

---

## 1. 强制加载机制

本项目的 Cursor 规则 `.cursor/rules/agent-harness.mdc` 已配置 `alwaysApply: true`，确保每次会话都会加载本 harness 的加载指令。Agent 在响应任何用户请求之前，必须先读取本文档并遵循其约束。

每次开始新会话时，Agent 必须读取 `tasks/tasks-rag-merged-real-status.md` 查询当前任务进度，并据此开展后续工作。

`tasks/tasks-rag-merged-real-status.md` 中的进度标记约定：

- `✅️` 表示该任务或子任务已经按真实代码状态落地
- `❌️` 表示该任务或子任务仍存在缺口，不能被当作已交付能力

---

## 2. 项目上下文

- 项目名称：AI_Cue
- 目标：不被腾讯会议等屏幕捕获软件捕捉到的 AI 面试助手
- 平台：仅 Windows
- 技术栈：Tauri 2.x + React 19 + TypeScript + Vite
- 技术选型详见：`detailed introduction of technologies.md`

---

## 3. Harness 约束

### 3.1 编码前流程

- 每次进入新会话后，先读取 `tasks/tasks-rag-merged-real-status.md`
- 每次进入新会话后，还必须先盘点本地可用 skills；只要当前任务有关联，就必须先加载对应 skill，再进入分析、编码、review 或文档同步阶段
- 如果用户没有指定目标任务，则默认继续执行清单中按顺序排列的下一个 `未完成` 子任务
- 如果用户指定了目标任务，则以用户指定任务为准，但不得跳过其硬前置依赖
- 在开始编码前，必须先向用户明确说明“本次要做的具体任务编号或任务标题”
- 一次只允许推进一个明确的子任务，不得把多个未完成子任务打包一起做完
- 只做用户明确要求的事情，不允许擅作主张，未经用户确认不得自行扩展需求或修改范围

### 3.2 代码规范

- 代码简洁，遵循奥卡姆剃刀原则
- 代码注释一律使用中文
- 输出高质量代码，减少无意义的日志
- 日志默认不做脱敏处理
- 每次完成一个子任务后，必须执行全量验证，而不是只跑局部验证；如果当前环境执行验证命令或 git 命令需要权限，必须先申请提权
- 全量验证固定为两条命令：
  - `npm run build`
  - `cargo test`（在 `src-tauri` 目录执行）
- 两条命令必须严格按顺序执行，先跑 `npm run build`，再跑 `cargo test`
- 只有当上述两条命令都通过后，才允许使用 `requesting-code-review` 对本次实现做代码审查
- 如果 `requesting-code-review` 发现 Critical 或 Important 问题，必须先修复问题，然后重新执行 `npm run build`、`cargo test` 和 `requesting-code-review`，直到严重问题全部清零
- 只有当两条验证命令通过，且 code review 的 Critical / Important 问题全部清零后，才允许进入文档同步与提交流程
- 文档同步阶段必须使用 `writing-guide`，并且先更新本次子任务涉及的项目相关 markdown 文档，再进入 git 提交流程
- 提交流程固定为：
  - 更新本次子任务涉及的项目相关 markdown 文档
  - `git add` 本次子任务相关修改
  - `git commit` 生成清晰提交
  - `git push origin <当前分支>`，推送到当前本地分支对应的远端分支；如远端尚无对应分支，则使用等价的上游建立方式完成首次推送
- `tasks/tasks-rag-merged-real-status.md` 中的 `✅️` 状态可以在最终文档同步阶段一并写入，但只有当全量验证通过、code review 通过且提交、推送成功后，当前子任务才允许被视为完成
- 只有当当前子任务被视为完成后，才允许开始下一个子任务
- 如果任意一条验证失败，Agent 必须优先修复失败问题，直到全量验证通过为止
- 如果 code review 发现 Critical 或 Important 问题，Agent 必须优先修复这些问题，直到严重问题清零为止
- 如果提交或推送失败，Agent 必须停止开始下一个子任务，并在回复中明确说明失败原因
- 如果某条验证因环境或权限限制无法执行，必须在回复中明确说明

### 3.3 沟通规范

- 回答使用中文
- 输出循序渐进，每一步详细解释
- 内容深度要深，提供详细解释
- 语言风格严谨
- 有场景不确定时直接提问，不浪费时间和 token

### 3.4 文档规范

- 写 markdown 文件一律不加表示加粗的双 `*` 号
- 每个子任务在 `npm run build`、`cargo test` 和 `requesting-code-review` 都通过后，必须使用 `writing-guide` 同步更新本次变更涉及的项目相关 markdown 文档，确保文档与真实代码状态一致
- 项目相关 markdown 文档包括但不限于 `tasks/tasks-rag-merged-real-status.md`、`README.md`、`docs/` 下设计文档，以及本次子任务直接影响到的其他说明文档
- 任务进度只能更新 `tasks/tasks-rag-merged-real-status.md`
- `TODO.md` 视为历史文档，不再作为任务真值来源
- 每当完成一个子任务，必须同步更新 `tasks/tasks-rag-merged-real-status.md`
- 每当一个子任务被标记为 `✅️` 后，如果当前客户端支持 `/clear` 命令，Agent 必须立即执行 `/clear` 清理当前上下文；清理后要重新读取 `Agent.md` 和 `tasks/tasks-rag-merged-real-status.md`，再继续后续工作

### 3.5 任务执行 Workflow

每次打开一个 agent 执行任务时，都必须严格执行以下 workflow：

1. 读取 `Agent.md`
2. 读取 `tasks/tasks-rag-merged-real-status.md`
3. 盘点本地可用 skills，并先加载本次任务相关的 skills
4. 确认本次要执行的唯一子任务
5. 向用户说明本次将推进哪个子任务
6. 只在该子任务范围内修改代码
7. 代码改完后，如当前环境对验证命令有限制，先申请提权
8. 先全量执行 `npm run build`
9. 再全量执行 `cargo test`
10. 如果任意一条失败，先修复问题，再回到第 7 步继续验证
11. 只有两条命令都通过，才能使用 `requesting-code-review` 做代码审查
12. 如果 code review 发现 Critical 或 Important 问题，先修复问题，再回到第 7 步，直到严重问题全部清零
13. 严重问题清零后，才能使用 `writing-guide` 更新本次子任务涉及的项目相关 markdown 文档，并同步 `tasks/tasks-rag-merged-real-status.md`
14. 文档同步完成后，提权执行 `git add`、`git commit`
15. 提交后必须将当前分支推送到对应远端分支
16. 只有验证通过、review 通过、文档已同步且推送成功，才能把对应子任务标记为 `✅️`
17. 每个子任务标记为 `✅️` 后，都必须立即执行 `/clear` 清理当前 agent 上下文；然后重新读取 `Agent.md` 与 `tasks/tasks-rag-merged-real-status.md`
18. 只有对应子任务已标记完成并完成 `/clear` 之后，才能开始下一个子任务
19. 向用户汇报结果，并明确下一个 `未完成` 子任务是什么

### 3.6 架构设计规范

- 为项目设计架构时，必须综合考虑以下三个维度：
  - 可扩展性：架构应具备良好的模块化和抽象层次，便于后续功能迭代和插件式扩展，避免硬编码和强耦合
  - 性能：关注关键路径的响应速度、资源占用和并发处理能力，合理使用缓存、懒加载、异步处理等优化手段
  - 安全性：遵循最小权限原则，注意数据传输加密、输入校验、敏感信息保护，防范常见安全漏洞
- 技术选型倾向于使用互联网主流且成熟的技术栈，优先选择社区活跃、文档完善、生态丰富的方案，避免使用冷门或维护不活跃的技术

---

## 4. 更新记录

当 Agent 违反上述约束或出现新的规范需求时，人类工程师应在此处追加更新说明，供后续会话参考。
