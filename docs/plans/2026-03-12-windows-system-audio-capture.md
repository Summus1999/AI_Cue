# Windows System Audio Capture Implementation Plan

> For Claude: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Goal: 将当前错误的简化音频录制实现替换为 Windows `WASAPI loopback` 方案，恢复项目可编译状态，并支持捕获默认播放设备的系统总输出音频，在停止录音后一次性返回标准 `WAV` 数据。

Architecture: 保留前端现有录音按钮交互，Rust 端重构为“命令层 + 录音器状态机 + Windows 底层采集实现”三层结构。采集阶段按设备原始格式抓取 PCM，停止时统一转换为项目标准输出格式，为后续实时转写预留扩展点。

Tech Stack: Tauri 2.x, React 19, TypeScript, Rust 2021, Windows WASAPI, WAV encoding

---

### Task 1: 固化当前设计边界

Files:
- Verify: `docs/plans/2026-03-12-windows-system-audio-capture-design.md`
- Create: `docs/plans/2026-03-12-windows-system-audio-capture.md`

Step 1: 复核设计边界

确认以下范围已冻结：

- 仅支持 Windows
- 仅捕获默认播放设备
- 仅停止后返回 `WAV`
- 暂不做设备选择 UI
- 暂不做实时转写

Step 2: 记录实现约束

实现时必须遵守：

- 不再沿用 `cpal` 的错误采集路径
- 不把 WASAPI 细节暴露给前端
- 不在本轮引入额外产品需求

Step 3: 检查当前构建失败证据

Run: `cargo build`
Expected: 在旧实现下失败，作为重构前基线

Run: `npm run build`
Expected: 在前端类型错误存在时失败，作为前端修复前基线

### Task 2: 重构 Rust 音频模块目录

Files:
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Replace: `src-tauri/src/audio.rs`
- Create: `src-tauri/src/audio/mod.rs`
- Create: `src-tauri/src/audio/types.rs`
- Create: `src-tauri/src/audio/recorder.rs`
- Create: `src-tauri/src/audio/windows_wasapi.rs`

Step 1: 移除单文件实现入口

将 `src-tauri/src/audio.rs` 从单文件模块改为目录模块，避免继续在旧文件中累积错误逻辑。

Step 2: 建立公共导出层

在 `src-tauri/src/audio/mod.rs` 中统一导出：

- `start_recording`
- `stop_recording`
- 需要的类型定义

Step 3: 建立类型层

在 `types.rs` 中定义：

- 录音状态枚举
- 输入格式信息结构
- 录音错误类型

Step 4: 建立录音器层

在 `recorder.rs` 中定义：

- 全局单例录音器
- 当前 session 管理
- `start` / `stop` 状态切换逻辑

Step 5: 调整命令层接入点

让 `commands.rs` 只作为薄封装，不再承载任何采集细节。

Step 6: 更新库入口

在 `lib.rs` 中将 `mod audio;` 指向目录模块，保持对外命令不变。

### Task 3: 实现录音状态机和会话生命周期

Files:
- Modify: `src-tauri/src/audio/types.rs`
- Modify: `src-tauri/src/audio/recorder.rs`

Step 1: 先写最小状态机

定义状态：

- `Idle`
- `Starting`
- `Recording`
- `Stopping`
- `Failed`

Step 2: 定义会话对象

会话至少包含：

- 停止信号
- 线程句柄
- 原始 PCM 缓冲区
- 输入格式信息

Step 3: 实现 `start`

要求：

- 非 `Idle` 状态时拒绝重复开始
- 只有线程和采集初始化成功后才切为 `Recording`
- 初始化失败时回退为 `Failed` 或 `Idle`

Step 4: 实现 `stop`

要求：

- 未录音时返回明确错误
- 发送停止信号
- 等待线程退出
- 获取原始 PCM 数据
- 交给后续编码层处理

Step 5: 明确错误回传语义

对前端返回简洁错误文本，对内部保留详细上下文。

### Task 4: 接入 Windows WASAPI loopback 采集

Files:
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/audio/windows_wasapi.rs`
- Modify: `src-tauri/src/audio/recorder.rs`

Step 1: 补充 Windows 依赖

在 `Cargo.toml` 中加入实现 `WASAPI loopback` 所需的 Windows 依赖和特性。

Step 2: 初始化 COM

在采集线程内完成 COM 初始化和线程级资源管理，不把 COM 生命周期泄漏到外层。

Step 3: 获取默认渲染设备

通过 Windows 音频设备枚举接口获取默认播放设备。

Step 4: 获取混音格式

读取设备 mix format，作为原始采集格式。

Step 5: 初始化 loopback capture

使用共享模式和 loopback 标志初始化 audio client，并建立 capture client。

Step 6: 实现采集循环

循环中执行：

- 读取可用缓冲
- 复制 PCM 数据到内存缓冲
- 检查停止信号
- 正确处理空缓冲和异常路径

Step 7: 线程退出时释放资源

确保 capture client、audio client 和 COM 资源在线程退出前被完整释放。

### Task 5: 实现 PCM 到标准 WAV 的转换

Files:
- Modify: `src-tauri/src/audio/types.rs`
- Modify: `src-tauri/src/audio/recorder.rs`
- Modify: `src-tauri/src/audio/windows_wasapi.rs`

Step 1: 固定项目输出格式

输出目标统一为：

- mono
- 16kHz
- PCM16
- WAV

Step 2: 处理声道转换

若设备是双声道或多声道，停止录音后统一下混为单声道。

Step 3: 处理采样率转换

若设备采样率不是 16kHz，停止录音后统一重采样到 16kHz。

Step 4: 处理位深统一

将输出统一整理为 PCM16。

Step 5: 输出 WAV

将标准 PCM16 数据编码为 `Vec<u8>` 形式的 `WAV` 并返回上层。

Step 6: 验证空音频与短音频场景

确保极短录音或静音场景下不会因为样本数过少而崩溃。

### Task 6: 修复 Tauri 命令层与前端构建问题

Files:
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/App.tsx`

Step 1: 精简命令层

命令层仅调用录音器导出的接口，不保留噪声日志。

Step 2: 修复 `TypeScript` 未使用符号

移除未使用的：

- `loadConfig`
- `RecordingStatus`

Step 3: 修复定时器类型

将浏览器端定时器引用改为兼容浏览器环境的写法，不能依赖 `NodeJS.Timeout`。

Step 4: 对齐录音按钮状态

要求：

- 后端成功开始后再设置前端录音中状态
- 停止失败时恢复 UI
- 失败提示保持简洁

### Task 7: 清理旧逻辑并压缩噪声

Files:
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/audio/*`
- Modify: `src/App.tsx`

Step 1: 删除旧采集思路残留

移除所有基于错误采集路径的代码和说明，避免未来误导。

Step 2: 删除无意义日志

移除高频调试 `println!` 与无价值 `console.log`，仅保留关键状态日志和错误日志。

Step 3: 校正提示文案

确保 UI 文案准确描述“录制电脑输出音频”，不暗示麦克风采集。

### Task 8: 逐步验证构建

Files:
- Verify: `src-tauri/src/audio/mod.rs`
- Verify: `src-tauri/src/audio/types.rs`
- Verify: `src-tauri/src/audio/recorder.rs`
- Verify: `src-tauri/src/audio/windows_wasapi.rs`
- Verify: `src-tauri/src/commands.rs`
- Verify: `src/App.tsx`

Step 1: 验证 Rust 编译

Run: `cargo build`
Expected: 编译通过，无类型错误

Step 2: 验证前端编译

Run: `npm run build`
Expected: `tsc` 通过，`vite build` 通过

Step 3: 验证 Tauri 项目整体启动

Run: `npm run tauri dev`
Expected: 应用可启动，录音按钮可点击

### Task 9: 手工功能验收

Files:
- Verify: `src/App.tsx`
- Verify: `src-tauri/src/audio/windows_wasapi.rs`

Step 1: 播放系统音频进行录制

操作：

- 在系统中播放一段可辨识音频
- 点击录音按钮开始
- 等待 3 到 5 秒
- 点击停止

Expected:

- 成功返回非空 `WAV` 数据

Step 2: 验证输出内容

将返回的音频数据保存为本地调试文件并试听。

Expected:

- 音频内容与系统输出一致

Step 3: 验证静音场景

在系统没有明显音频输出时重复测试。

Expected:

- 不崩溃
- 可返回合法但近似静音的 `WAV`

Step 4: 验证重复操作

连续执行 3 次以上开始/停止。

Expected:

- 无状态错乱
- 无资源泄漏迹象

Step 5: 验证异常路径

在默认播放设备不可用或被切换时观察行为。

Expected:

- 返回明确错误
- UI 状态可恢复

### Task 10: 为后续实时转写预留扩展点

Files:
- Modify: `src-tauri/src/audio/types.rs`
- Modify: `src-tauri/src/audio/recorder.rs`
- Modify: `src-tauri/src/audio/windows_wasapi.rs`

Step 1: 保留原始 PCM 中间表示

不要让底层采集逻辑直接耦合到一次性 `WAV` 封装。

Step 2: 将采集与编码分离

让“采集 PCM”和“输出 WAV”成为两个明确阶段。

Step 3: 预留分块输出扩展点

即使本轮不实现实时转写，也要让采集循环未来可以按块输出 PCM 给 ASR 层。

Step 4: 保持当前接口最小化

本轮对外仍然只暴露：

- `start_audio_recording`
- `stop_audio_recording`

避免提早暴露不稳定 API。

### Task 11: 收尾验证

Files:
- Verify: `docs/plans/2026-03-12-windows-system-audio-capture-design.md`
- Verify: `docs/plans/2026-03-12-windows-system-audio-capture.md`
- Verify: `src-tauri/src/audio/*`
- Verify: `src/App.tsx`

Step 1: 复核需求是否完全匹配

确认最终实现没有偏离以下范围：

- Windows only
- 默认播放设备
- 系统总输出音频
- stop 后返回 `WAV`

Step 2: 复核日志与注释

确保日志克制，注释必要且准确。

Step 3: 复核残留风险

记录当前已知风险，例如：

- 不支持设备选择
- 不支持实时转写
- 多格式设备上的转换精度仍需实测

Step 4: 准备进入编码

待用户确认后，再进入实现阶段。
