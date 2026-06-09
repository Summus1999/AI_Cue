/**
 * 波形可视化组件
 * 使用 Canvas 绘制实时音频波形
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { audioVisualizer, WaveformData } from '../services/audioVisualizer';
import { createLogger } from '../services/logger';

const log = createLogger('WaveformVisualizer');

// ============== 类型定义 ==============

/** 可视化模式 */
type VisualizerMode = 'bar' | 'line';

/** 组件 Props */
interface WaveformVisualizerProps {
  /** 可视化模式 */
  mode?: VisualizerMode;
  /** 画布宽度 */
  width?: number;
  /** 画布高度 */
  height?: number;
  /** 前景色（默认咖啡色主题） */
  color?: string;
  /** 背景色 */
  backgroundColor?: string;
  /** 是否正在录音 */
  isActive: boolean;
  /** 灵敏度（0.1 ~ 2.0） */
  sensitivity?: number;
  /** 自定义类名 */
  className?: string;
}

// ============== 常量 ==============

// 咖啡色主题色
const DEFAULT_COLOR = '#8B4513'; // SaddleBrown
const DEFAULT_BG_COLOR = 'transparent';
const DEFAULT_SENSITIVITY = 1.0;

// ============== 组件实现 ==============

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  mode = 'bar',
  width = 200,
  height = 40,
  color = DEFAULT_COLOR,
  backgroundColor = DEFAULT_BG_COLOR,
  isActive,
  sensitivity = DEFAULT_SENSITIVITY,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const dataRef = useRef<WaveformData | null>(null);
  const prevDataRef = useRef<number[]>([]);

  /**
   * 平滑过渡函数
   */
  const smoothTransition = useCallback(
    (prev: number[], current: number[], factor: number): number[] => {
      if (prev.length !== current.length || prev.length === 0) {
        return current;
      }
      return current.map((value, i) => {
        const prevValue = prev[i] || 0;
        return prevValue + (value - prevValue) * factor;
      });
    },
    []
  );

  /**
   * 柱状图模式绘制
   */
  const drawBars = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      waveform: number[],
      w: number,
      h: number
    ) => {
      const barCount = waveform.length;
      const gap = 1; // 柱子之间的间隔
      const barWidth = Math.max(1, (w - gap * (barCount - 1)) / barCount);
      const centerY = h / 2;

      waveform.forEach((value, i) => {
        // 放大波形值（原始值通常在 0-0.3 范围）
        const amplifiedValue = Math.min(1, value * 3);
        const barHeight = Math.max(2, amplifiedValue * h * 0.9);
        const x = i * (barWidth + gap);
        const y = centerY - barHeight / 2;

        ctx.fillRect(x, y, barWidth, barHeight);
      });
    },
    []
  );

  /**
   * 波形线模式绘制
   */
  const drawLine = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      waveform: number[],
      w: number,
      h: number
    ) => {
      const centerY = h / 2;
      const step = w / (waveform.length - 1);

      ctx.lineWidth = 2;
      ctx.beginPath();

      // 绘制上半部分
      waveform.forEach((value, i) => {
        // 放大波形值
        const amplifiedValue = Math.min(1, value * 3);
        const x = i * step;
        const y = centerY - amplifiedValue * centerY * 0.9;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      // 绘制下半部分（镜像）
      for (let i = waveform.length - 1; i >= 0; i--) {
        const amplifiedValue = Math.min(1, waveform[i] * 3);
        const x = i * step;
        const y = centerY + amplifiedValue * centerY * 0.9;
        ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    },
    []
  );

  /**
   * 绘制函数
   */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清空画布（必须用 clearRect，因为背景可能是透明的）
    ctx.clearRect(0, 0, width, height);
    
    // 如果有背景色且不是透明，填充背景
    if (backgroundColor && backgroundColor !== 'transparent') {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    const data = dataRef.current;
    if (!data || !isActive) {
      // 非活动状态，绘制静态线
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    // 应用灵敏度（基础放大 + 用户灵敏度）
    const waveform = data.waveform.map((v) => Math.min(1, v * sensitivity));

    // 平滑过渡
    const smoothedWaveform = smoothTransition(prevDataRef.current, waveform, 0.3);
    prevDataRef.current = smoothedWaveform;

    // 根据模式绘制
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    if (mode === 'bar') {
      drawBars(ctx, smoothedWaveform, width, height);
    } else {
      drawLine(ctx, smoothedWaveform, width, height);
    }
  }, [
    mode,
    width,
    height,
    color,
    backgroundColor,
    isActive,
    sensitivity,
    smoothTransition,
    drawBars,
    drawLine,
  ]);

  // 订阅数据更新
  useEffect(() => {
    if (!isActive) {
      log.debug('Not active, clearing data');
      dataRef.current = null;
      prevDataRef.current = [];
      // 停止时绘制一次静态状态
      draw();
      return;
    }

    log.debug('Active, subscribing to audioVisualizer...');
    
    // 订阅更新
    const unsubscribe = audioVisualizer.subscribe((data) => {
      log.trace('Received waveform data:', { rms: data.rms, waveformLength: data.waveform.length });
      dataRef.current = data;
    });

    // 启动渲染循环
    let running = true;
    const renderLoop = () => {
      if (!running) return;
      draw();
      animationRef.current = requestAnimationFrame(renderLoop);
    };
    animationRef.current = requestAnimationFrame(renderLoop);

    return () => {
      log.debug('Unsubscribing...');
      running = false;
      unsubscribe();
      cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, draw]);

  // 页面可见性监听：避免页面不可见时浪费 CPU
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(animationRef.current);
      }
      // 页面可见时不需要手动重启，因为 useEffect 会在依赖变化时重新启动
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ display: 'block' }}
    />
  );
};

export default WaveformVisualizer;
export type { WaveformVisualizerProps, VisualizerMode };
