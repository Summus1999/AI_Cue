# AI_Cue 面向字节 Android AI Agent 岗位的包装方案

## 总体定位

不要把 AI_Cue 说成原生 Android 项目。更稳妥的定位是：

> 我主导/深度参与了一个端侧 AI Agent 面试助手项目，围绕实时场景感知、个人知识记忆、多模型调用、RAG 检索增强、语音/截图输入和低干扰桌面交互，完成了从产品链路到工程落地的完整闭环。当前实现是 Windows Tauri 桌面端，但架构设计与端侧 AI Agent 的 Android 落地高度相似，我也能清楚说明如何迁移到 Android。

这个口径既尊重项目真实技术栈，又能命中岗位 JD 中的 AI Agent、情景感知、个性化记忆、模型调用、性能优化和工程落地。

## JD 能力点映射

| JD 要求 | AI_Cue 中可对应的能力 | 面试表达重点 |
| --- | --- | --- |
| 情景感知 | 语音输入、截图选区、会话上下文、助手/面试官模式、RAG 检索策略 | 用户当前问题、屏幕内容、历史上下文和知识库共同决定 AI 回答 |
| 个性化记忆 | SQLite 会话持久化、消息搜索、RAG 知识库、用户配置、Embedding 检索 | 不只是一次性聊天，而是能沉淀个人资料、岗位 JD、历史问答和技术文档 |
| 模型调用与交互 | Qwen、OpenAI Compatible、Claude，多 Provider 抽象，流式输出，失败降级 | 把模型能力封装成稳定产品链路，而不是简单调接口 |
| 算法产品化 | 文档解析、OCR fallback、分块、Embedding、向量检索、citation | 关注解析质量、召回效果、引用可信度和异常状态恢复 |
| 端侧工程化 | Tauri 本地应用、Rust 后端、SQLite、任务进度、启动恢复、结构化日志 | 能处理本地存储、后台任务、错误恢复、性能和用户体验 |
| 评测与工具建设 | 前端 Vitest、Rust 集成测试、Windows CI、RAG 导入/重建/异常重试任务注册表 | 有测试和验证闭环，不依赖手工点击验收 |
| Android 原生能力 | 当前项目没有直接实现 | 主动说明技术栈差异，并给出 Kotlin、Compose、Room、WorkManager、ForegroundService 等迁移方案 |

## 简历项目描述

项目名称建议：

AI_Cue：端侧 AI Agent 面试助手 / 个人知识增强问答系统

简历描述建议控制在 4 到 6 条：

- 设计并落地端侧 AI Agent 助手，支持语音输入、截图题解、流式对话、会话上下文管理和多模型 Provider 接入，覆盖真实面试中的实时辅助场景。
- 建设个人知识记忆能力，完成 Markdown/PDF/代码文件导入、OCR fallback、智能分块、Embedding 入库、向量检索和 citation 展示，使回答可追溯到具体文档片段。
- 抽象模型调用层，支持 Qwen、OpenAI Compatible、Claude 等模型，聊天链路支持 RAG context 注入、失败降级、继续生成和重试，提升 AI 功能稳定性。
- 设计本地数据与任务状态体系，使用 SQLite 持久化会话、知识库、索引状态和配置，支持导入进度、重建索引、异常重试和启动恢复。
- 补齐工程质量闭环，建设前端回归测试、Rust 集成测试和 Windows CI，覆盖知识库导入、检索、citation、启动恢复和 UI 交互。

如果简历必须强化 Android 相关性，可以单独加一条“迁移设计”，不要写成已上线功能：

- 针对 Android 端落地，完成迁移方案设计：使用 Kotlin + Compose + MVVM/MVI 承载交互层，Room 承接本地记忆，WorkManager 处理后台索引，ForegroundService 处理语音链路，并围绕启动、内存、网络与电量做分层优化。

## 四分钟面试讲述主线

### 1. 背景

面试场景里，用户需要低干扰、实时、上下文相关的 AI 辅助。普通聊天机器人只能回答当前输入，缺少对屏幕、语音、历史会话和个人资料的理解。

### 2. 方案

我把系统拆成四层：输入层、记忆层、模型层和交互层。

- 输入层处理文本、语音和截图，让系统具备基础情景感知能力。
- 记忆层使用 SQLite + RAG，把简历、JD、技术文档和历史会话转成可检索的个人知识。
- 模型层用 Provider 抽象接入 Qwen、OpenAI Compatible 和 Claude，并支持流式输出、继续生成和失败降级。
- 交互层负责低干扰窗口、引用展示、知识库管理和任务进度反馈。

### 3. 难点

RAG 不是简单调 embedding 接口。真正难点在于文档解析质量、OCR fallback 触发条件、分块粒度、Embedding 失败状态、引用可信度、索引任务恢复，以及 retrieval 失败时如何不影响主聊天链路。

### 4. 结果

项目形成了一个可运行的端侧 AI Agent 闭环：能感知输入场景，能使用个人知识库，能调用不同模型，能返回带引用的回答，也有导入、重建、异常重试、启动恢复和测试验证链路。

### 5. Android 迁移

如果迁到 Android，核心架构不变，替换系统能力即可：SQLite 替换为 Room，后台索引交给 WorkManager，语音常驻链路放到 ForegroundService，截图/屏幕能力评估 MediaProjection，UI 使用 Compose，网络流式请求用 OkHttp/WebSocket。

## Android 迁移方案

### 架构拆分

```text
UI 层：Compose 聊天页、知识库页、设置页
状态层：ViewModel + StateFlow，按 MVI 管理输入、消息、索引任务和错误状态
数据层：Room 存会话、消息、知识库文档、chunk、embedding 元数据
任务层：WorkManager 跑文档解析、分块、embedding、重建索引和失败重试
模型层：Repository 封装聊天模型、embedding 模型、流式输出、取消和重试
系统能力层：ForegroundService 处理语音链路，MediaProjection/系统分享入口处理截图或屏幕上下文
```

### 模块对应

| 当前 AI_Cue 模块 | Android 迁移模块 | 说明 |
| --- | --- | --- |
| React 组件 | Compose Screen | 聊天、知识库、设置页均可按状态驱动改写 |
| Zustand store | ViewModel + StateFlow | 保存 UI 状态、任务状态、错误状态 |
| SQLite | Room | 会话、消息、知识库、文档、chunk、索引状态 |
| Tauri command | Repository / UseCase | 把跨端命令改成本地用例层 |
| Rust RAG task registry | WorkManager + Room task table | 支持后台索引、进度查询、失败恢复 |
| Stream chat service | OkHttp SSE/WebSocket | 支持首 token 延迟监控、取消、重试 |
| Windows OCR | ML Kit OCR / 系统 OCR 能力 | 处理图片、扫描 PDF 或截图文本 |

## Android 深挖答案准备

### 启动优化

回答口径：

AI Agent 应用启动时不能把模型配置同步、知识库恢复、历史会话加载、网络探测都放在主线程。Android 迁移时，我会把启动拆成关键路径和延迟路径：首屏只加载最近会话和基础配置；知识库统计、索引恢复、网络探测放到后台任务；Compose 页面用骨架屏承接加载状态。这样能缩短首屏时间，也避免启动阶段阻塞输入。

可结合 AI_Cue 说：

当前项目已经有启动编排和 RAG runtime 配置同步，迁移到 Android 时会对应到 ViewModel 初始化、Repository 配置同步和 WorkManager 恢复任务。

### 内存优化

回答口径：

知识库和聊天记录容易产生大对象。Android 端不能一次性把所有 chunk、embedding、历史消息加载进内存。我的处理方式是分页加载消息和文档列表；embedding 向量只在检索阶段按需读取；PDF/OCR 解析按页处理；流式回答边到边渲染，避免拼接超大字符串；图片和截图走压缩与生命周期释放。

可结合 AI_Cue 说：

AI_Cue 的 RAG 链路已经把文档、chunk、embedding 拆表持久化，这个设计迁移到 Room 后仍然成立。

### 电量与网络优化

回答口径：

AI Agent 的耗电主要来自常驻语音、网络流式请求、后台 embedding 和 OCR。Android 端我会限制后台索引条件，例如充电、Wi-Fi、空闲状态下执行；长任务放 WorkManager；语音链路使用 ForegroundService 明确告知用户；网络请求做指数退避、取消和重试；RAG 检索优先使用本地缓存，减少重复请求。

可结合 AI_Cue 说：

当前项目已有失败降级、重建索引、异常重试和结构化日志，迁移到 Android 时会进一步结合系统调度策略控制资源消耗。

## 模型交互深挖答案准备

### 流式输出如何取消和重试

回答口径：

流式输出需要把一次请求建模成可取消任务。前端/Android UI 只消费增量 token，不直接持有底层连接。用户点击取消时，ViewModel 通知 Repository 取消请求，同时把当前 assistant 消息标记为 interrupted。继续生成时，用原始用户问题、已生成内容和上下文重新构造请求；重试时，回滚失败回答并复用同一次用户输入。

AI_Cue 对应能力：

项目已经支持继续生成、重试消息和 retrieval context 注入。面试时可以重点讲“继续生成/重试不是单纯再发一次请求，而是要恢复原用户上下文和请求元数据”。

### RAG 失败如何降级

回答口径：

RAG 失败不能让主聊天不可用。我会把 retrieval 作为聊天前置增强步骤，而不是强依赖。流程是：先判断 RAG 开关、知识库 ready 状态和 provider 配置；检索成功则注入 prompt context 和 citations；检索为空或失败则记录错误并降级到普通聊天；最终回答仍然能返回，只是没有引用。

AI_Cue 对应能力：

项目当前聊天链路已经覆盖 retrieval off、empty result、failure fallback 和 continue generate 场景，说明这是经过测试验证的产品行为。

## 端到端评测方案

评测不要只看“回答好不好”，要拆成可量化指标：

| 评测维度 | 指标 | 采集方式 |
| --- | --- | --- |
| 检索质量 | Top-K 命中率、citation 准确率、无关召回率 | 固定知识库 + 标注问题集 |
| 生成体验 | 首 token 延迟、完整回答耗时、中断恢复成功率 | 结构化日志 + 前端埋点 |
| 稳定性 | RAG 失败降级成功率、导入失败可恢复率、重试成功率 | 自动化测试 + 手工场景 |
| 端侧资源 | 启动耗时、内存峰值、后台任务耗时、电量消耗 | Android Profiler / 系统日志 |
| 用户价值 | 回答可用率、引用可解释率、面试复盘完成率 | 小规模试用记录 |

## 面试风险与应对

| 风险问题 | 推荐回答 |
| --- | --- |
| 这不是 Android 项目，为什么投 Android？ | 这个项目不是原生 Android，我不会把它包装成 Android 已上线项目。但它解决的是端侧 AI Agent 的核心问题：输入感知、个人记忆、模型调用、后台任务和性能体验。Android 是这些能力的目标承载平台，我已经准备了清晰迁移方案。 |
| 你没有 Android 实战怎么办？ | 我的优势是 AI Agent 产品链路和工程闭环。Android 侧我会用 Kotlin、Compose、Room、WorkManager、ForegroundService 承接这些模块。为了补齐原生经验，我会准备一个轻量 Demo，证明我能把核心链路落到 Android。 |
| 你项目里算法部分做到什么程度？ | 我没有训练大模型，重点是把模型和 RAG 能力产品化。包括文档解析、OCR fallback、分块、embedding、向量检索、citation、失败降级和任务恢复。 |
| 如果知识库很大怎么办？ | 不一次性加载。文档、chunk、embedding 拆表存储；导入和索引用后台任务；检索按 Top-K 拉取；UI 分页展示；Android 上用 WorkManager 控制后台条件。 |
| 如何证明效果？ | 用固定问题集和标注知识库评测 Top-K 命中率、citation 准确率、首 token 延迟、失败降级成功率和资源消耗。 |

## 面试前补强清单

- 准备一个 Android Demo：Kotlin + Compose，实现聊天页、知识库列表页、流式输出 mock 和 Room 持久化会话。
- 写一份 Android 迁移设计图：模块拆分、线程模型、后台任务、缓存策略、权限申请、性能优化和电量控制。
- 准备 3 个 Android 深挖答案：启动优化、内存优化、电量与网络优化，每个答案都绑定到 AI Agent 场景。
- 准备 2 个模型交互深挖答案：流式输出如何取消/重试，RAG 失败如何降级。
- 准备 1 个端到端评测方案：固定问题集、知识库命中率、citation 准确率、首 token 延迟、失败降级成功率和资源指标。

## 推荐最终话术

我不会把 AI_Cue 描述成已经上线的 Android 项目。它更准确的定位是端侧 AI Agent 工程项目：我围绕面试场景做了输入感知、个人知识记忆、多模型调用、RAG 检索增强、引用展示和任务恢复。这个项目让我完整经历了从 AI 能力到端侧产品闭环的过程。面向 Android 落地时，我会把现有架构迁移到 Kotlin + Compose + Room + WorkManager + ForegroundService，并重点处理启动、内存、网络、电量和权限问题。
