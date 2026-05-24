import { useState, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, MessageCircle, Settings, Database, UserCheck, Check } from 'lucide-react';

interface OnboardingDialogProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

// 引导步骤按用户认知顺序排列：先介绍价值 → 配置模型 → 创建知识库 → 选择模式 → 确认就绪
// 最后一步"准备就绪"是确认页，isLast 为 true 时按钮文案变为"开始使用"
const STEPS = [
  {
    icon: MessageCircle,
    title: '欢迎使用 AI_Cue',
    description: 'AI_Cue 是你的个人 AI 面试训练助手。它可以根据你的简历、岗位 JD、项目经历和技术资料，提供模拟面试、实时问答和复盘分析。',
    bullets: [
      '基于个人知识库生成个性化回答',
      '支持语音输入和截图题解',
      '提供模拟面试和复盘报告',
    ],
  },
  {
    icon: Settings,
    title: '配置 AI 模型',
    description: '在使用之前，需要先配置一个 AI 模型。支持千问 (Qwen)、OpenAI 兼容接口和 Claude 等多种模型。',
    bullets: [
      '打开设置 → 选择模型提供商',
      '填写 API Key 和模型名称',
      '支持私有化部署（自定义 Base URL）',
    ],
  },
  {
    icon: Database,
    title: '创建个人知识库',
    description: '知识库是 AI_Cue 的核心能力。导入你的简历、岗位 JD 和技术文档后，AI 的回答会更有针对性，并且能追溯到具体文档片段。',
    bullets: [
      '创建知识库并导入文档',
      '支持 Markdown、PDF、代码文件',
      '回答带引用来源标注',
    ],
  },
  {
    icon: UserCheck,
    title: '选择面试模式',
    description: 'AI_Cue 支持两种面试模式，你可以随时切换。',
    bullets: [
      '助手模式：AI 辅助你回答问题，提供思路和话术',
      '面试官模式：AI 扮演面试官，根据 JD 和简历模拟真实面试',
      '面试结束后可生成复盘报告',
    ],
  },
  {
    icon: Check,
    title: '准备就绪',
    description: '你已经了解了 AI_Cue 的核心能力。现在可以选择开始模拟面试，或者先去完善知识库。',
    bullets: [
      '随时在设置中重新打开本引导',
      '建议先导入简历和 JD 体验最佳效果',
      '按 Ctrl+Shift+R 开始语音输入',
    ],
  },
];

export function OnboardingDialog({ isOpen, onComplete, onSkip }: OnboardingDialogProps) {
  const [step, setStep] = useState(0);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handlePrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  if (!isOpen) {
    return null;
  }

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-6 pt-6">
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-700">
            {step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-700 transition-colors"
          >
            跳过引导
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-6 py-6">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 mx-auto">
            <current.icon className="w-7 h-7 text-amber-600" />
          </div>

          <h2 className="mt-5 text-center text-lg font-semibold text-amber-900">
            {current.title}
          </h2>

          <p className="mt-2 text-center text-sm leading-6 text-amber-700/80">
            {current.description}
          </p>

          <ul className="mt-5 space-y-2">
            {current.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2 text-sm text-amber-800">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between px-6 pb-6 pt-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={isFirst}
            className="flex items-center gap-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            上一步
          </button>

          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`block w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-amber-600' : 'bg-amber-200'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleNext}
            className="flex items-center gap-1 rounded-xl border border-amber-700 bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
          >
            {isLast ? '开始使用' : '下一步'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default OnboardingDialog;
