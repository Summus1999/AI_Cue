export interface TrainingTask {
  id: string;
  description: string;
  type: 'mock_interview' | 'knowledge_review' | 'project_deep_dive' | 'algorithm_practice' | 'behavioral' | 'review_report';
  completed: boolean;
  completedAt: number | null;
}

export interface TrainingDay {
  dayNumber: number;
  title: string;
  tasks: TrainingTask[];
}

export interface TrainingPlan {
  id: string;
  name: string;
  targetPosition: string;
  targetCompany: string;
  createdAt: number;
  days: TrainingDay[];
}

// 7天训练计划的每日主题，按面试准备的自然递进顺序排列：
// 先包装个人经历 → 再补技术基础 → 再练算法系统设计 → 最后软技能 + 全真模拟
const DAY_TITLES = [
  '简历深挖与自我介绍',
  '项目经历深度包装',
  '技术基础查漏补缺',
  '算法与代码能力',
  '系统设计与架构',
  '行为面试与软技能',
  '全真模拟面试',
];

// 每天的具体任务模板。
// 任务类型对应：mock_interview=模拟面试 / knowledge_review=知识复习 / project_deep_dive=项目深挖
// algorithm_practice=算法练习 / behavioral=行为面试 / review_report=复盘回顾
// 每天3个任务，第一项是当天的核心训练，最后一项是回顾/检查。

const DAY_TASKS: Record<number, Omit<TrainingTask, 'id' | 'completed' | 'completedAt'>[]> = {
  1: [
    { type: 'mock_interview', description: '完成一次"简历深挖"模式的模拟面试，让 AI 追问你的核心项目' },
    { type: 'knowledge_review', description: '用 STAR 原则重新梳理 2 个核心项目的描述话术' },
    { type: 'review_report', description: '查看模拟面试的复盘报告，标记发现的知识盲点' },
  ],
  2: [
    { type: 'project_deep_dive', description: '选择"项目经历包装"模板，将最复杂的项目包装为面试话术' },
    { type: 'knowledge_review', description: '整理项目的技术难点、量化指标和设计取舍' },
    { type: 'mock_interview', description: '用"JD 匹配"模板做一次面试，检查经历与目标岗位的匹配度' },
  ],
  3: [
    { type: 'knowledge_review', description: '用"八股文问答"模板测试计算机网络和操作系统基础' },
    { type: 'knowledge_review', description: '用"八股文问答"模板测试数据库和编程语言特性' },
    { type: 'mock_interview', description: '做一次混合技术面试，覆盖今天复习的知识点' },
  ],
  4: [
    { type: 'algorithm_practice', description: '用"算法题讲解"模板，完成 3 道中等难度算法题的讲解练习' },
    { type: 'algorithm_practice', description: '练习时间空间复杂度分析，每道题至少给出两种解法' },
    { type: 'mock_interview', description: '做一次包含算法题的模拟面试（可以截图题目让 AI 讲解）' },
  ],
  5: [
    { type: 'knowledge_review', description: '复习缓存设计、消息队列、分布式一致性等系统设计基础' },
    { type: 'knowledge_review', description: '设计一个实际系统（如短链服务、秒杀系统），让 AI 追问设计细节' },
    { type: 'mock_interview', description: '做一次以系统设计为主的模拟面试' },
  ],
  6: [
    { type: 'behavioral', description: '用"行为面试"模板，练习团队协作和冲突处理类问题' },
    { type: 'behavioral', description: '准备 3 个体现主动性和学习能力的真实案例' },
    { type: 'mock_interview', description: '做一次行为面试 + 技术面试的综合模拟' },
  ],
  7: [
    { type: 'mock_interview', description: '做一次完整的全真模拟面试（包含简历深挖 + 技术 + 算法 + 行为）' },
    { type: 'review_report', description: '回顾本周所有复盘报告，对比进步趋势' },
    { type: 'knowledge_review', description: '整理本周发现的知识盲点，制定下一轮的复习计划' },
  ],
};

let idCounter = 0;

function generateTaskId(): string {
  idCounter += 1;
  return `task-${Date.now()}-${idCounter}`;
}

export function generateTrainingPlan(
  targetPosition: string,
  targetCompany: string,
): TrainingPlan {
  const now = Date.now();

  const days: TrainingDay[] = Array.from({ length: 7 }, (_, i) => {
    const dayNumber = i + 1;
    const templates = DAY_TASKS[dayNumber] || DAY_TASKS[1];

    return {
      dayNumber,
      title: DAY_TITLES[i] || `第 ${dayNumber} 天`,
      tasks: templates.map((t) => ({
        ...t,
        id: generateTaskId(),
        completed: false,
        completedAt: null,
      })),
    };
  });

  return {
    id: `plan-${now}`,
    name: `${targetCompany ? targetCompany + ' ' : ''}面试训练计划`,
    targetPosition,
    targetCompany,
    createdAt: now,
    days,
  };
}

export function getTotalProgress(plan: TrainingPlan): { completed: number; total: number } {
  const total = plan.days.reduce((sum, d) => sum + d.tasks.length, 0);
  const completed = plan.days.reduce(
    (sum, d) => sum + d.tasks.filter((t) => t.completed).length,
    0,
  );
  return { completed, total };
}

export function getDayProgress(day: TrainingDay): { completed: number; total: number } {
  const total = day.tasks.length;
  const completed = day.tasks.filter((t) => t.completed).length;
  return { completed, total };
}
