# Pluely 屏幕捕获防护技术文档

## 1. 概述

Pluely 是一款隐私优先的 AI 助手，其核心特性之一是**隐形模式（Invisible/Stealth Mode）**——使应用窗口不被腾讯会议、Zoom、OBS、Windows 截图工具等屏幕捕获软件捕获到。本文档详细介绍该功能的技术实现原理。

---

## 2. 技术架构

### 2.1 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Tauri 2.x (Rust)
- **跨平台支持**: Windows、macOS、Linux

### 2.2 核心实现机制

隐形模式的实现依赖于**多层技术协同**：

| 层级 | 技术手段 | 作用 |
|------|----------|------|
| **操作系统层** | `contentProtected` API | 调用系统原生 API 防止屏幕捕获 |
| **窗口层** | 透明无边框窗口 | 视觉隐蔽性 |
| **任务栏层** | `skipTaskbar` | 不在任务栏/Dock 显示 |
| **UI层** | CSS 隐形光标 | 鼠标指针不可见 |
| **交互层** | 自定义光标组件 | 应用内可视反馈 |

---

## 3. 核心实现详解

### 3.1 Content Protection (屏幕捕获防护)

#### 3.1.1 配置入口

**主窗口配置** (`src-tauri/tauri.conf.json`):

```json
{
  "app": {
    "macOSPrivateApi": true,
    "windows": [
      {
        "title": "Pluely - AI Assistant",
        "width": 600,
        "height": 54,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": false,
        "resizable": false,
        "visibleOnAllWorkspaces": true,
        "skipTaskbar": true,
        "visible": true,
        "contentProtected": true,   // ⭐ 核心配置
        "focus": false,
        "acceptFirstMouse": true,
        "shadow": false
      }
    ]
  }
}
```

**Dashboard 窗口动态创建** (`src-tauri/src/window.rs`):

```rust
// macOS 配置
#[cfg(target_os = "macos")]
let base_builder = base_builder
    .title("Pluely - Dashboard")
    .center()
    .decorations(true)
    .inner_size(1200.0, 800.0)
    .content_protected(true)   // ⭐ 屏幕保护
    .visible(true);

// Windows/Linux 配置
#[cfg(not(target_os = "macos"))]
let base_builder = base_builder
    .title("Pluely - Dashboard")
    .center()
    .decorations(true)
    .inner_size(800.0, 600.0)
    .content_protected(true)   // ⭐ 屏幕保护
    .visible(false);
```

#### 3.1.2 操作系统级实现原理

**Windows 平台**:

Tauri 的 `contentProtected` 在 Windows 上调用 Win32 API:

```c
// Windows API (由 Tauri 内部调用)
SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
```

- `WDA_EXCLUDEFROMCAPTURE` (0x00000011): Windows 10 2004+ 支持，窗口内容在屏幕捕获时显示为**透明**
- `WDA_MONITOR` (0x00000001): 旧版 Windows，窗口在捕获时显示为**黑色**

**macOS 平台**:

Tauri 调用 AppKit 的 `sharingType` 属性:

```swift
// macOS API (由 Tauri 内部调用)
window.sharingType = .none
```

设置 `NSWindowSharingType.none` 后，窗口内容无法被截屏或录屏。

**Linux 平台**:

> ⚠️ Linux 目前**不支持** `contentProtected`，因为 X11/Wayland 没有等效的原生 API。

---

### 3.2 透明无边框窗口

```json
{
  "decorations": false,      // 无边框（去掉标题栏）
  "transparent": true,       // 透明背景
  "shadow": false            // 无阴影
}
```

这些配置确保：
- 窗口没有系统标准边框，不易被注意
- 透明背景使窗口融入桌面环境
- 无阴影进一步降低视觉存在感

---

### 3.3 任务栏隐藏

#### 3.3.1 静态配置

```json
{
  "skipTaskbar": true
}
```

#### 3.3.2 动态控制 (Rust)

```rust
// src-tauri/src/shortcuts.rs

#[tauri::command]
pub fn set_app_icon_visibility<R: Runtime>(app: AppHandle<R>, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // macOS: 通过 Activation Policy 控制 Dock 图标
        let policy = if visible {
            tauri::ActivationPolicy::Regular    // 显示 Dock 图标
        } else {
            tauri::ActivationPolicy::Accessory  // 隐藏 Dock 图标
        };
        app.set_activation_policy(policy)?;
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 控制任务栏图标
        if let Some(window) = app.get_webview_window("main") {
            window.set_skip_taskbar(!visible)?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 控制面板图标
        if let Some(window) = app.get_webview_window("main") {
            window.set_skip_taskbar(!visible)?;
        }
    }

    Ok(())
}
```

---

### 3.4 隐形光标系统

#### 3.4.1 光标类型定义

```typescript
// src/lib/storage/customizable.storage.ts

export type CursorType = "invisible" | "default" | "auto";

export const DEFAULT_CUSTOMIZABLE: CustomizableState = {
  cursor: { type: "invisible" },  // 默认隐形光标
  // ...
};
```

#### 3.4.2 CSS 全局光标控制

```css
/* src/global.css */

* {
  cursor: var(--cursor-type) !important;
}
```

#### 3.4.3 JavaScript 动态更新

```typescript
// src/contexts/app.context.tsx

const updateCursor = (type: CursorType | undefined) => {
  const currentWindow = getCurrentWindow();
  const platform = getPlatform();
  
  // Linux 不支持隐形光标
  if (platform === "linux") {
    document.documentElement.style.setProperty("--cursor-type", "default");
    return;
  }
  
  const windowLabel = currentWindow.label;
  
  // Dashboard 窗口始终使用默认光标
  if (windowLabel === "dashboard") {
    document.documentElement.style.setProperty("--cursor-type", "default");
    return;
  }
  
  // 主窗口：invisible → none（隐藏）
  const safeType = type || "invisible";
  const cursorValue = type === "invisible" ? "none" : safeType;
  document.documentElement.style.setProperty("--cursor-type", cursorValue);
};
```

#### 3.4.4 自定义光标组件

当系统光标隐藏时，应用内显示自定义光标以提供视觉反馈：

```tsx
// src/components/CustomCursor.tsx

const CustomCursor = () => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ x: 0, y: 0 });
  
  useEffect(() => {
    let rafId: number;
    
    // 使用 requestAnimationFrame 实现流畅的光标跟随
    const updateCursorPosition = () => {
      if (cursorRef.current) {
        cursorRef.current.style.transform = 
          `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`;
      }
      rafId = requestAnimationFrame(updateCursorPosition);
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      positionRef.current = { x: e.clientX, y: e.clientY };
    };
    
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    rafId = requestAnimationFrame(updateCursorPosition);
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);
  
  return (
    <div
      ref={cursorRef}
      className="fixed top-0 left-0 pointer-events-none z-[9999]"
    >
      <MousePointer2 className="w-5 h-5 drop-shadow-2xl fill-secondary stroke-primary" />
    </div>
  );
};
```

---

### 3.5 macOS 特殊处理 - NSPanel

macOS 使用 `tauri-nspanel` 插件实现更高级的窗口行为：

```rust
// src-tauri/src/lib.rs

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    cocoa::appkit::NSWindowCollectionBehavior, 
    panel_delegate, 
    WebviewWindowExt
};

#[cfg(target_os = "macos")]
fn init<R: Runtime>(app_handle: &AppHandle<R>) {
    let window: WebviewWindow<R> = app_handle.get_webview_window("main").unwrap();
    let panel = window.to_panel().unwrap();
    
    // 设置窗口层级为 Float（浮动在普通窗口之上）
    const NSFloatWindowLevel: i32 = 4;
    panel.set_level(NSFloatWindowLevel);
    
    // 设置为非激活面板（不获取焦点）
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);
    
    // 设置窗口行为：
    // - FullScreenAuxiliary: 全屏模式下作为辅助窗口
    // - CanJoinAllSpaces: 在所有工作区/桌面可见
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
    );
}
```

**NSPanel 的优势**:
- 不会抢夺焦点，用户可以继续在其他应用中工作
- 可以显示在全屏应用之上
- 在所有虚拟桌面/工作区中可见

---

## 4. 用户可配置选项

用户可通过设置页面调整隐形模式：

```tsx
// src/pages/shortcuts/components/Cursor.tsx

<Select
  value={customizable.cursor.type}
  onValueChange={(value) => setCursorType(value as CursorType)}
>
  <SelectContent>
    {/* 隐形光标 - Linux 不支持 */}
    <SelectItem value="invisible" disabled={platform === "linux"}>
      Invisible
    </SelectItem>
    
    {/* 默认系统光标 */}
    <SelectItem value="default">
      Default
    </SelectItem>
    
    {/* 自动（跟随系统） */}
    <SelectItem value="auto">
      Auto
    </SelectItem>
  </SelectContent>
</Select>
```

---

## 5. 平台兼容性

| 特性 | Windows 10 2004+ | Windows 旧版 | macOS | Linux |
|------|------------------|--------------|-------|-------|
| Content Protection | ✅ 透明 | ⚠️ 黑色 | ✅ 完全支持 | ❌ 不支持 |
| 隐形光标 | ✅ | ✅ | ✅ | ❌ 强制默认 |
| 跳过任务栏 | ✅ | ✅ | ✅ (Dock) | ✅ |
| 透明窗口 | ✅ | ✅ | ✅ | ⚠️ 依赖 WM |

---

## 6. 技术限制与注意事项

1. **Linux 平台限制**:
   - X11/Wayland 无原生屏幕保护 API
   - 隐形光标强制回退为默认光标

2. **Windows 旧版本**:
   - Windows 10 2004 以下版本，窗口在捕获时显示黑色而非透明

3. **硬件截图**:
   - 物理方式（如手机拍摄屏幕）无法防护

4. **第三方工具**:
   - 某些专业截屏工具可能绕过系统保护

---

## 7. 依赖项

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api", "devtools"] }

[target.'cfg(target_os = "macos")'.dependencies]
tauri-nspanel = { git = "https://github.com/ahkohd/tauri-nspanel", branch = "v2" }
```

### Tauri 配置

```json
{
  "app": {
    "macOSPrivateApi": true   // macOS 私有 API 支持
  }
}
```

---

## 8. 总结

Pluely 的隐形模式通过以下多层机制实现屏幕捕获防护：

1. **`contentProtected: true`** - 核心机制，调用操作系统原生 API
2. **透明无边框窗口** - 视觉隐蔽
3. **跳过任务栏** - 系统级隐藏
4. **隐形光标 + 自定义光标组件** - UI 层隐蔽
5. **macOS NSPanel** - 平台特定优化

这种多层防护确保了在会议、面试等场景下，Pluely 窗口不会出现在对方的屏幕共享画面中。
