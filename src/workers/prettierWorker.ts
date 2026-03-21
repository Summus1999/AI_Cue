/**
 * Prettier Web Worker
 * 在 Worker 线程中运行 Prettier 格式化，避免阻塞主线程
 */

// 语言到 Parser 的映射
const PARSER_MAP: Record<string, string> = {
  javascript: 'babel',
  typescript: 'typescript',
  jsx: 'babel',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
};

// 动态加载 Parser
async function loadParser(parserName: string): Promise<unknown> {
  // 注意：Prettier 3.x 内置了主要语言的 parser 插件
  // 使用动态导入加载所需 parser
  try {
    switch (parserName) {
      case 'babel':
      case 'babel-flow':
        // @ts-ignore - prettier plugins are dynamically imported
        return await import('prettier/plugins/babel');
      case 'typescript':
        // @ts-ignore
        return await import('prettier/plugins/typescript');
      case 'html':
        // @ts-ignore
        return await import('prettier/plugins/html');
      case 'css':
      case 'scss':
      case 'less':
        // @ts-ignore
        return await import('prettier/plugins/postcss');
      case 'markdown':
      case 'mdx':
        // @ts-ignore
        return await import('prettier/plugins/markdown');
      case 'yaml':
        // @ts-ignore
        return await import('prettier/plugins/yaml');
      case 'json':
        // @ts-ignore
        return await import('prettier/plugins/babel');
      default:
        // @ts-ignore
        return await import('prettier/plugins/babel');
    }
  } catch (error) {
    throw new Error(`加载 Parser "${parserName}" 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Worker 消息处理
self.onmessage = async (event: MessageEvent) => {
  const { code, language, options = {}, requestId } = event.data;
  
  // 输入验证
  if (typeof code !== 'string') {
    self.postMessage({
      requestId,
      formatted: null,
      error: '无效的代码输入',
    });
    return;
  }
  
  // 代码长度限制（500KB）
  if (code.length > 500 * 1024) {
    self.postMessage({
      requestId,
      formatted: null,
      error: '代码过长，超出格式化限制（500KB）',
    });
    return;
  }
  
  try {
    // 动态导入 Prettier standalone
    // @ts-ignore - prettier is dynamically imported
    const prettier = await import('prettier/standalone');
    
    const parserName = PARSER_MAP[language] || 'babel';
    const parser = await loadParser(parserName);
    
    const formatted = await prettier.format(code, {
      parser: parserName,
      plugins: [parser as unknown as string],
      tabWidth: options.tabWidth ?? 2,
      useTabs: options.useTabs ?? false,
      printWidth: options.printWidth ?? 80,
      semi: options.semi ?? true,
      singleQuote: options.singleQuote ?? true,
    });
    
    self.postMessage({ requestId, formatted, error: null });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // 处理常见错误类型，提供友好提示
    let friendlyMessage = errorMessage;
    if (errorMessage.includes('Unexpected token')) {
      friendlyMessage = '代码语法错误，无法格式化';
    } else if (errorMessage.includes('Cannot find module')) {
      friendlyMessage = '格式化插件加载失败';
    }
    
    self.postMessage({
      requestId,
      formatted: null,
      error: friendlyMessage,
    });
  }
};

export {};
