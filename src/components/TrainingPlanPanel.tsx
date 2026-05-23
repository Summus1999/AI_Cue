import { useState, useEffect, type FormEvent } from 'react';
import { ArrowLeft, Target, Check, ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useTrainingPlanStore } from '../store/trainingPlan';
import type { TrainingTask } from '../services/trainingPlan';

interface TrainingPlanPanelProps {
  onBack: () => void;
}

const TYPE_LABELS: Record<TrainingTask['type'], { label: string; color: string }> = {
  mock_interview: { label: '模拟面试', color: 'bg-blue-100 text-blue-700' },
  knowledge_review: { label: '知识复习', color: 'bg-purple-100 text-purple-700' },
  project_deep_dive: { label: '项目深挖', color: 'bg-green-100 text-green-700' },
  algorithm_practice: { label: '算法练习', color: 'bg-orange-100 text-orange-700' },
  behavioral: { label: '行为面试', color: 'bg-pink-100 text-pink-700' },
  review_report: { label: '复盘回顾', color: 'bg-amber-100 text-amber-700' },
};

function TaskItem({
  task,
  onToggle,
}: {
  task: TrainingTask;
  onToggle: () => void;
}) {
  const typeInfo = TYPE_LABELS[task.type];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors cursor-pointer ${
        task.completed
          ? 'border-green-200 bg-green-50/50'
          : 'border-amber-200 bg-white hover:bg-amber-50'
      }`}
      onClick={onToggle}
    >
      <div
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
          task.completed
            ? 'bg-green-500 border-green-500'
            : 'border-amber-300'
        }`}
      >
        {task.completed && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-5 ${
            task.completed ? 'text-amber-700/60 line-through' : 'text-amber-900'
          }`}
        >
          {task.description}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          {task.completedAt && (
            <span className="text-[10px] text-amber-500">
              {new Intl.DateTimeFormat('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }).format(task.completedAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function TrainingPlanPanel({ onBack }: TrainingPlanPanelProps) {
  const {
    plan,
    createPlan,
    deletePlan,
    toggleTask,
    getTotalProgress,
    loadPlan,
  } = useTrainingPlanStore();

  const [showCreateForm, setShowCreateForm] = useState(!plan);
  const [targetPosition, setTargetPosition] = useState(plan?.targetPosition ?? '');
  const [targetCompany, setTargetCompany] = useState(plan?.targetCompany ?? '');
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set([1]));

  // 初始化时加载已有计划
  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const progress = getTotalProgress();
  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  const handleCreatePlan = (e: FormEvent) => {
    e.preventDefault();
    if (!targetPosition.trim()) return;

    createPlan(targetPosition.trim(), targetCompany.trim());
    setShowCreateForm(false);
  };

  const toggleDay = (dayNumber: number) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayNumber)) {
        next.delete(dayNumber);
      } else {
        next.add(dayNumber);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
      {/* Header */}
      <div
        data-tauri-drag-region
        className="flex-shrink-0 flex items-center justify-between h-10 px-4 bg-amber-100/80 border-b border-amber-200 select-none"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4 text-amber-700" />
          </button>
          <Target className="w-4 h-4 text-amber-700" />
          <span className="text-xs font-medium text-amber-800 tracking-wide">训练计划</span>
        </div>
        <div className="flex items-center gap-1">
          {plan && !showCreateForm && (
            <button
              onClick={() => {
                if (window.confirm('确定要删除当前训练计划吗？所有进度将丢失。')) {
                  deletePlan();
                  setShowCreateForm(true);
                }
              }}
              className="flex items-center gap-1 px-2 h-6 rounded hover:bg-red-200/50 text-xs text-amber-700 transition-colors"
              title="删除计划"
            >
              <Trash2 className="w-3 h-3" />
              删除
            </button>
          )}
          {plan && (
            <button
              onClick={() => {
                setTargetPosition(plan.targetPosition);
                setTargetCompany(plan.targetCompany);
                setShowCreateForm(!showCreateForm);
              }}
              className="flex items-center gap-1 px-2 h-6 rounded hover:bg-amber-200/60 text-xs text-amber-700 transition-colors"
              title={showCreateForm ? '查看计划' : '新建计划'}
            >
              <Plus className="w-3 h-3" />
              {showCreateForm ? '查看计划' : '新建'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Create form */}
          {showCreateForm && (
            <div className="rounded-2xl border border-amber-200 bg-white/70 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-amber-900">
                {plan ? '重新创建训练计划' : '创建训练计划'}
              </h2>
              <p className="mt-1 text-sm text-amber-700/80">
                设定目标岗位和公司，系统将为你生成一个 7 天的面试训练计划
              </p>

              <form onSubmit={handleCreatePlan} className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-amber-700">目标岗位（必填）</span>
                  <input
                    type="text"
                    value={targetPosition}
                    onChange={(e) => setTargetPosition(e.target.value)}
                    placeholder="例如：高级前端工程师 / 后端开发 / 算法工程师"
                    autoFocus
                    className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm text-amber-900 placeholder:text-amber-400 focus:border-amber-500 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-amber-700">目标公司（可选）</span>
                  <input
                    type="text"
                    value={targetCompany}
                    onChange={(e) => setTargetCompany(e.target.value)}
                    placeholder="例如：字节跳动 / 阿里 / 腾讯"
                    className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm text-amber-900 placeholder:text-amber-400 focus:border-amber-500 focus:outline-none"
                  />
                </label>

                <button
                  type="submit"
                  disabled={!targetPosition.trim()}
                  className="flex items-center gap-2 rounded-xl border border-amber-700 bg-amber-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Target className="w-4 h-4" />
                  {plan ? '重新生成计划' : '生成训练计划'}
                </button>

                {plan && (
                  <p className="text-xs text-amber-500">
                    重新生成将覆盖当前计划，已完成的任务进度将丢失
                  </p>
                )}
              </form>
            </div>
          )}

          {/* Plan display */}
          {plan && !showCreateForm && (
            <>
              {/* Summary card */}
              <div className="rounded-2xl border border-amber-200 bg-white/70 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-amber-500">Training Plan</p>
                    <h2 className="mt-2 text-xl font-semibold text-amber-950">
                      {plan.name || '面试训练计划'}
                    </h2>
                    <p className="mt-1 text-sm text-amber-700/80">
                      目标岗位：{plan.targetPosition}
                      {plan.targetCompany ? ` | ${plan.targetCompany}` : ''}
                    </p>
                  </div>
                  <div className="min-w-28 rounded-2xl bg-amber-100 px-4 py-3 text-center">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500">Progress</p>
                    <p className="mt-1 text-2xl font-semibold text-amber-900">
                      {progressPercent}%
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="h-2 bg-amber-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-600 transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-amber-600">
                    已完成 {progress.completed}/{progress.total} 个任务
                  </p>
                </div>
              </div>

              {/* Day cards */}
              <div className="space-y-3">
                {plan.days.map((day) => {
                  const dayProgress = day.tasks.filter((t) => t.completed).length;
                  const dayTotal = day.tasks.length;
                  const isExpanded = expandedDays.has(day.dayNumber);
                  const isDayComplete = dayProgress === dayTotal;

                  return (
                    <div
                      key={day.dayNumber}
                      className={`rounded-2xl border shadow-sm overflow-hidden transition-colors ${
                        isDayComplete
                          ? 'border-green-200 bg-green-50/30'
                          : 'border-amber-200 bg-white/70'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDay(day.dayNumber)}
                        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-amber-50/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
                              isDayComplete
                                ? 'bg-green-500 text-white'
                                : 'bg-amber-200 text-amber-700'
                            }`}
                          >
                            {isDayComplete ? <Check className="w-4 h-4" /> : day.dayNumber}
                          </div>
                          <div>
                            <h3
                              className={`text-sm font-semibold ${
                                isDayComplete ? 'text-amber-700' : 'text-amber-900'
                              }`}
                            >
                              {day.title}
                            </h3>
                            <p className="mt-0.5 text-xs text-amber-600">
                              {dayProgress}/{dayTotal} 个任务完成
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isDayComplete && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 font-medium">
                              完成
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-amber-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-amber-500" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-4 space-y-2">
                          {day.tasks.map((task) => (
                            <TaskItem
                              key={task.id}
                              task={task}
                              onToggle={() => toggleTask(day.dayNumber, task.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TrainingPlanPanel;
