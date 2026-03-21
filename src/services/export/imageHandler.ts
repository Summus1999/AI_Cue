import { invoke } from '@tauri-apps/api/core';

/**
 * 图片处理方式
 */
export type ImageHandling = 'embed' | 'extract';

/**
 * 图片处理器选项
 */
export interface ImageHandlerOptions {
  handling: ImageHandling;
  outputDir?: string;           // 提取模式下的输出目录
  imageQuality?: number;        // 压缩质量 0-100
  maxWidth?: number;            // 最大宽度
}

/**
 * 处理后的图片结果
 */
export interface ProcessedImage {
  imageData?: string;   // Base64 数据（内嵌模式）
  imagePath?: string;   // 相对路径（外部文件模式）
}

/**
 * 图片处理器
 */
export class ImageHandler {
  /**
   * 处理消息中的图片
   */
  async processImage(
    messageId: string,
    base64Data: string,
    options: ImageHandlerOptions
  ): Promise<ProcessedImage> {
    if (options.handling === 'embed') {
      // 内嵌模式：可选压缩后返回 Base64
      const compressed = options.imageQuality
        ? await this.compressImage(base64Data, options.imageQuality)
        : base64Data;
      return { imageData: compressed };
    }

    // 提取模式：保存为独立文件
    const fileName = `image_${messageId}.png`;
    const filePath = `${options.outputDir}/images/${fileName}`;

    // 调用 Tauri 命令写入文件
    const bytes = this.base64ToBytes(base64Data);
    await invoke('write_binary_file', {
      path: filePath,
      data: Array.from(bytes),
    });

    return { imagePath: `./images/${fileName}` };
  }

  /**
   * 压缩图片（使用 Canvas API）
   */
  private async compressImage(base64: string, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 canvas 上下文'));
          return;
        }

        ctx.drawImage(img, 0, 0);
        const compressed = canvas.toDataURL('image/jpeg', quality / 100);
        resolve(compressed.split(',')[1]);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = `data:image/png;base64,${base64}`;
    });
  }

  /**
   * Base64 转 Uint8Array
   */
  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
