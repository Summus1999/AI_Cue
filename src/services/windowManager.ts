// 窗口状态管理服务
import { getCurrentWindow, availableMonitors, LogicalPosition, LogicalSize, cursorPosition } from '@tauri-apps/api/window';
import { loadConfig, saveConfig, WindowBounds } from '../store/config';

// 注意：不要在模块顶层调用 getCurrentWindow()，因为在 Tauri IPC 就绪前可能导致错误

/**
 * 设置窗口透明度（使用 CSS opacity 实现）
 * @param opacity 不透明度，范围 0.2~1.0，步长 0.05
 */
export async function setWindowOpacity(opacity: number): Promise<void> {
  // 1. 校验范围：clamp 到 [0.2, 1.0]
  const clamped = Math.min(1.0, Math.max(0.2, Math.round(opacity * 20) / 20));
  // 2. 使用 CSS 控制透明度（不需要 Tauri 权限）
  document.documentElement.style.opacity = String(clamped);
  // 3. 同步更新悬停恢复的基准透明度
  updateBaseOpacity(clamped);
}

/**
 * 初始化窗口透明度（应用启动时调用）
 * @param opacity 从配置读取的透明度值
 */
export async function initWindowOpacity(opacity: number): Promise<void> {
  await setWindowOpacity(opacity);
}

// ============= 窗口位置和大小记忆功能 =============

// 防抖定时器
let boundsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 保存当前窗口位置和大小（500ms 防抖）
 * @param mode 当前模式：'main' 或 'compact'，不传则自动根据当前紧凑模式状态判断
 */
export async function saveWindowBounds(mode?: 'main' | 'compact'): Promise<void> {
  const actualMode = mode ?? (compactModeEnabled ? 'compact' : 'main');
  if (boundsDebounceTimer) {
    clearTimeout(boundsDebounceTimer);
  }
  boundsDebounceTimer = setTimeout(async () => {
    try {
      const appWindow = getCurrentWindow();
      const position = await appWindow.outerPosition();
      const size = await appWindow.outerSize();
      const bounds: WindowBounds = {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };
      const config = await loadConfig();
      config.window.bounds[actualMode] = bounds;
      await saveConfig(config);
    } catch (err) {
      console.warn('保存窗口位置失败:', err);
    }
  }, 500);
}

/**
 * 恢复窗口位置和大小
 * @param mode 目标模式：'main' 或 'compact'
 */
export async function restoreWindowBounds(mode: 'main' | 'compact' = 'main'): Promise<void> {
  try {
    const config = await loadConfig();
    const bounds = config.window.bounds[mode];
    const appWindow = getCurrentWindow();
    
    if (!bounds) {
      // 无保存的位置，使用默认位置（主显示器右下角附近）
      await applyDefaultBounds(appWindow, mode);
      return;
    }

    // 验证位置是否在可用显示器范围内
    const isValid = await validateBoundsInMonitors(bounds);
    
    if (isValid) {
      await appWindow.setPosition(new LogicalPosition(bounds.x, bounds.y));
      await appWindow.setSize(new LogicalSize(bounds.width, bounds.height));
    } else {
      // 降级：移至主显示器中央
      console.warn('窗口位置超出可用屏幕区域，执行降级');
      await centerOnPrimaryMonitor(appWindow, bounds.width, bounds.height);
    }
  } catch (err) {
    console.warn('恢复窗口位置失败:', err);
  }
}

/**
 * 检查 bounds 是否在任一可用显示器范围内（至少 50px 可见）
 */
async function validateBoundsInMonitors(bounds: WindowBounds): Promise<boolean> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) return false;
    
    const minVisible = 50; // 至少 50px 在屏幕内
    
    for (const monitor of monitors) {
      const mx = monitor.position.x;
      const my = monitor.position.y;
      const mw = monitor.size.width;
      const mh = monitor.size.height;
      
      // 检查窗口是否与该显示器有至少 minVisible 的重叠
      const overlapX = Math.min(bounds.x + bounds.width, mx + mw) - Math.max(bounds.x, mx);
      const overlapY = Math.min(bounds.y + bounds.height, my + mh) - Math.max(bounds.y, my);
      
      if (overlapX >= minVisible && overlapY >= minVisible) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 将窗口居中到主显示器
 */
async function centerOnPrimaryMonitor(appWindow: ReturnType<typeof getCurrentWindow>, width: number, height: number): Promise<void> {
  try {
    const monitors = await availableMonitors();
    const primary = monitors[0]; // 第一个通常是主显示器
    if (!primary) return;
    
    const mw = primary.size.width;
    const mh = primary.size.height;
    const mx = primary.position.x;
    const my = primary.position.y;
    
    // 如果尺寸超出屏幕，调整为屏幕的 80%
    const finalWidth = Math.min(width, Math.floor(mw * 0.8));
    const finalHeight = Math.min(height, Math.floor(mh * 0.8));
    
    const centerX = mx + Math.floor((mw - finalWidth) / 2);
    const centerY = my + Math.floor((mh - finalHeight) / 2);
    
    await appWindow.setSize(new LogicalSize(finalWidth, finalHeight));
    await appWindow.setPosition(new LogicalPosition(centerX, centerY));
  } catch (err) {
    console.warn('居中窗口失败:', err);
  }
}

/**
 * 应用默认窗口位置（首次安装时使用）
 */
async function applyDefaultBounds(_appWindow: ReturnType<typeof getCurrentWindow>, mode: 'main' | 'compact'): Promise<void> {
  if (mode === 'compact') {
    // 紧凑模式默认：不做调整，保持 tauri.conf.json 默认
    return;
  }
  // 完整模式：默认位置由 tauri.conf.json 控制（440×640），不额外调整
  // 首次启动位置交给系统决定
}

// ====== 悬停恢复模块 ======

let hoverRestoreEnabled = false;
let baseOpacity = 0.8;  // 基准透明度（从配置读取）
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let isHovering = false;

/**
 * 更新基准透明度（当用户通过滑块调节时调用）
 */
export function updateBaseOpacity(opacity: number): void {
  baseOpacity = Math.min(1.0, Math.max(0.2, opacity));
}

/**
 * 启用/禁用悬停恢复功能
 */
export function enableHoverRestore(enabled: boolean, currentOpacity: number): void {
  baseOpacity = currentOpacity;
  
  if (enabled && !hoverRestoreEnabled) {
    // 启用：注册事件
    hoverRestoreEnabled = true;
    document.documentElement.addEventListener('mouseenter', handleMouseEnter);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);
  } else if (!enabled && hoverRestoreEnabled) {
    // 禁用：注销事件，清理定时器
    hoverRestoreEnabled = false;
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    isHovering = false;
    document.documentElement.removeEventListener('mouseenter', handleMouseEnter);
    document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
  }
}

function handleMouseEnter(): void {
  if (!hoverRestoreEnabled) return;
  
  isHovering = true;
  
  // 取消任何待执行的离开恢复
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  
  // 立即恢复到 100% 不透明（使用 CSS 透明度）
  document.documentElement.style.opacity = '1';
}

function handleMouseLeave(): void {
  if (!hoverRestoreEnabled) return;
  
  isHovering = false;
  
  // 300ms 延迟后恢复基准透明度
  if (leaveTimer) {
    clearTimeout(leaveTimer);
  }
  leaveTimer = setTimeout(() => {
    if (!isHovering && hoverRestoreEnabled) {
      // 使用 CSS 透明度恢复基准值
      document.documentElement.style.opacity = String(baseOpacity);
    }
    leaveTimer = null;
  }, 300);
}

/**
 * 清理悬停恢复资源
 */
export function cleanupHoverRestore(): void {
  enableHoverRestore(false, baseOpacity);
}

// ====== 穿透模式模块 ======

let passthroughEnabled = false;
let passthroughPollTimer: number | null = null;
// 记录上一次的穿透状态，避免频繁调用 setIgnoreCursorEvents
let lastIgnoreCursorState: boolean | null = null;

/**
 * 获取穿透模式状态
 */
export function isPassthroughEnabled(): boolean {
  return passthroughEnabled;
}

/**
 * 切换穿透模式
 */
export async function togglePassthrough(): Promise<boolean> {
  return await setPassthrough(!passthroughEnabled);
}

/**
 * 设置穿透模式
 * @param enabled 是否启用穿透
 * @returns 新的穿透状态
 */
export async function setPassthrough(enabled: boolean): Promise<boolean> {
  try {
    const appWindow = getCurrentWindow();
    passthroughEnabled = enabled;
    
    if (enabled) {
      // 开启穿透：设置 data 属性用于 CSS 视觉提示
      document.documentElement.dataset.passthrough = 'true';
      // 默认设为穿透状态
      await appWindow.setIgnoreCursorEvents(true);
      lastIgnoreCursorState = true;
      // 启动轮询：每 50ms 检查光标是否在交互区域
      startPassthroughPolling();
    } else {
      // 关闭穿透：清除 data 属性，停止轮询
      delete document.documentElement.dataset.passthrough;
      stopPassthroughPolling();
      await appWindow.setIgnoreCursorEvents(false);
      lastIgnoreCursorState = null;
    }
    
    return passthroughEnabled;
  } catch (err) {
    console.warn('设置穿透模式失败:', err);
    return passthroughEnabled;
  }
}

/**
 * 启动穿透模式轮询
 * 使用 setInterval 配合 cursorPosition() API 检测光标位置
 */
function startPassthroughPolling(): void {
  stopPassthroughPolling(); // 清除已有的定时器
  
  passthroughPollTimer = window.setInterval(async () => {
    if (!passthroughEnabled) return;
    
    try {
      const appWindow = getCurrentWindow();
      // 获取光标的物理像素位置
      const cursorPos = await cursorPosition();
      // 获取窗口内部尺寸（物理像素）
      const windowSize = await appWindow.innerSize();
      // 获取窗口位置（物理像素）
      const windowPos = await appWindow.outerPosition();
      
      // cursorPosition 返回的是屏幕绝对坐标，需要转换为窗口内相对坐标
      const relativeX = cursorPos.x - windowPos.x;
      const relativeY = cursorPos.y - windowPos.y;
      
      // 判断光标是否在交互区域
      const isInInteractiveZone = checkCursorInInteractiveZone(
        relativeX, relativeY, windowSize.width, windowSize.height
      );
      
      // 只有状态变化时才调用 API，避免频繁 IPC 调用
      if (isInInteractiveZone && lastIgnoreCursorState !== false) {
        await appWindow.setIgnoreCursorEvents(false);
        lastIgnoreCursorState = false;
      } else if (!isInInteractiveZone && lastIgnoreCursorState !== true) {
        await appWindow.setIgnoreCursorEvents(true);
        lastIgnoreCursorState = true;
      }
    } catch (_err) {
      // 光标可能在窗口外或其他错误，保持当前状态
    }
  }, 50); // 50ms 轮询间隔（20fps）
}

/**
 * 停止穿透模式轮询
 */
function stopPassthroughPolling(): void {
  if (passthroughPollTimer !== null) {
    clearInterval(passthroughPollTimer);
    passthroughPollTimer = null;
  }
}

/**
 * 检查光标是否在交互区域
 * @param x 光标相对于窗口的 X 坐标（物理像素）
 * @param y 光标相对于窗口的 Y 坐标（物理像素）
 * @param windowWidth 窗口宽度（物理像素）
 * @param windowHeight 窗口高度（物理像素）
 */
function checkCursorInInteractiveZone(
  x: number, y: number,
  windowWidth: number, windowHeight: number
): boolean {
  // 光标在窗口外，保持穿透
  if (x < 0 || x > windowWidth || y < 0 || y > windowHeight) {
    return false;
  }
  
  // 获取 DPI 缩放比例，将物理像素转换为 CSS 像素
  const dpr = window.devicePixelRatio || 1;
  const cssY = y / dpr;
  const cssWindowHeight = windowHeight / dpr;
  
  // 标题栏区域（顶部 40px CSS 像素）始终是交互区域
  if (cssY >= 0 && cssY <= 40) {
    return true;
  }
  
  // 底部输入区域（底部 60px CSS 像素）也是交互区域
  if (cssY >= cssWindowHeight - 60) {
    return true;
  }
  
  // 其他区域穿透
  return false;
}

/**
 * 清理穿透模式资源
 */
export function cleanupPassthrough(): void {
  if (passthroughEnabled) {
    setPassthrough(false);
  }
}

// ====== 紧凑模式模块 ======

let compactModeEnabled = false;

/**
 * 获取紧凑模式状态
 */
export function isCompactMode(): boolean {
  return compactModeEnabled;
}

/**
 * 切换紧凑模式
 * @returns 新的紧凑模式状态
 */
export async function toggleCompactMode(): Promise<boolean> {
  const newMode = !compactModeEnabled;
  await setCompactMode(newMode);
  return compactModeEnabled;
}

/**
 * 设置紧凑模式
 */
export async function setCompactMode(enabled: boolean): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const currentMode = compactModeEnabled ? 'compact' : 'main';
    
    // 1. 保存当前模式的窗口位置
    await saveWindowBoundsImmediate(currentMode);
    
    // 2. 切换模式
    compactModeEnabled = enabled;
    const targetMode = enabled ? 'compact' : 'main';
    
    // 3. 调整窗口最小尺寸
    if (enabled) {
      // 紧凑模式：更小的最小尺寸
      await appWindow.setMinSize(new LogicalSize(200, 80));
    } else {
      // 完整模式：恢复原始最小尺寸（tauri.conf.json 中的 380×500）
      await appWindow.setMinSize(new LogicalSize(380, 500));
    }
    
    // 4. 恢复目标模式的位置（若有记忆），否则使用默认紧凑尺寸
    const config = await loadConfig();
    const targetBounds = config.window.bounds[targetMode];
    
    if (targetBounds) {
      await appWindow.setSize(new LogicalSize(targetBounds.width, targetBounds.height));
      await appWindow.setPosition(new LogicalPosition(targetBounds.x, targetBounds.y));
    } else if (enabled) {
      // 首次进入紧凑模式，使用默认尺寸
      await appWindow.setSize(new LogicalSize(320, 160));
    }
    
    // 5. 持久化紧凑模式状态
    config.window.compactMode.enabled = enabled;
    await saveConfig(config);
  } catch (err) {
    console.warn('切换紧凑模式失败:', err);
  }
}

/**
 * 立即保存窗口位置（不防抖，用于模式切换前）
 */
async function saveWindowBoundsImmediate(mode: 'main' | 'compact'): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();
    const bounds: WindowBounds = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
    const config = await loadConfig();
    config.window.bounds[mode] = bounds;
    await saveConfig(config);
  } catch (err) {
    console.warn('立即保存窗口位置失败:', err);
  }
}

/**
 * 初始化紧凑模式状态（应用启动时调用）
 */
export function initCompactMode(enabled: boolean): void {
  compactModeEnabled = enabled;
}
