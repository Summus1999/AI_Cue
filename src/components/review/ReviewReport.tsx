import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle, Lightbulb, Clock } from 'lucide-react';
import type { ReviewReport, MessageScore, SessionInsight, InsightType, TimingStats } from '../../types/review';

interface ReviewReportProps {
  report: ReviewReport;
  onExportPdf?: () => void;
  timingStats?: TimingStats;  // 回答用时统计
}

// 时间格式化工具函数
function formatTimeDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins > 0) {
    return `${mins}分${secs.toString().padStart(2, '0')}秒`;
  }
  return `${secs}秒`;
}

// 根据用时获取颜色样式
function getTimingColorClass(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 60) return 'text-green-600 bg-green-100';
  if (seconds <= 180) return 'text-amber-600 bg-amber-100';
  return 'text-red-500 bg-red-100';
}

// 根据用时获取柱状图颜色
function getBarColorClass(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 60) return 'bg-green-500';
  if (seconds <= 180) return 'bg-amber-500';
  return 'bg-red-500';
}

// 五边形雷达图组件 - 展示五个维度
function RadarChart({ 
  confidence, 
  professionalism, 
  depth, 
  theory_practice, 
  tech_sensitivity 
}: { 
  confidence: number; 
  professionalism: number; 
  depth: number; 
  theory_practice: number; 
  tech_sensitivity: number; 
}) {
  // 雷达图参数
  const centerX = 100;
  const centerY = 90;
  const maxRadius = 70;
  
  // 将分数转换为半径（0-100 -> 0-maxRadius）
  const r1 = (confidence / 100) * maxRadius;        // 面试自信度 - 顶部
  const r2 = (professionalism / 100) * maxRadius; // 技术专业度 - 右上
  const r3 = (depth / 100) * maxRadius;           // 技术深度 - 右下
  const r4 = (theory_practice / 100) * maxRadius; // 理论实践 - 左下
  const r5 = (tech_sensitivity / 100) * maxRadius; // 技术敏感度 - 左上
  
  // 五个顶点的角度（从顶部开始，顺时针分布）
  const angle1 = -Math.PI / 2;                      // 顶部 - 自信度
  const angle2 = -Math.PI / 2 + (2 * Math.PI / 5); // 右上 - 专业度
  const angle3 = -Math.PI / 2 + (4 * Math.PI / 5); // 右下 - 技术深度
  const angle4 = -Math.PI / 2 + (6 * Math.PI / 5); // 左下 - 理论实践
  const angle5 = -Math.PI / 2 + (8 * Math.PI / 5); // 左上 - 技术敏感度
  
  // 计算顶点坐标
  const p1 = { x: centerX + r1 * Math.cos(angle1), y: centerY + r1 * Math.sin(angle1) };
  const p2 = { x: centerX + r2 * Math.cos(angle2), y: centerY + r2 * Math.sin(angle2) };
  const p3 = { x: centerX + r3 * Math.cos(angle3), y: centerY + r3 * Math.sin(angle3) };
  const p4 = { x: centerX + r4 * Math.cos(angle4), y: centerY + r4 * Math.sin(angle4) };
  const p5 = { x: centerX + r5 * Math.cos(angle5), y: centerY + r5 * Math.sin(angle5) };
  
  // 外圈顶点（最大值）
  const max1 = { x: centerX + maxRadius * Math.cos(angle1), y: centerY + maxRadius * Math.sin(angle1) };
  const max2 = { x: centerX + maxRadius * Math.cos(angle2), y: centerY + maxRadius * Math.sin(angle2) };
  const max3 = { x: centerX + maxRadius * Math.cos(angle3), y: centerY + maxRadius * Math.sin(angle3) };
  const max4 = { x: centerX + maxRadius * Math.cos(angle4), y: centerY + maxRadius * Math.sin(angle4) };
  const max5 = { x: centerX + maxRadius * Math.cos(angle5), y: centerY + maxRadius * Math.sin(angle5) };
  
  return (
    <svg width="220" height="200" viewBox="0 0 200 200" className="mx-auto">
      {/* 背景网格 - 同心五边形 */}
      {[0.25, 0.5, 0.75, 1].map((scale, i) => {
        const sr = maxRadius * scale;
        const points = [angle1, angle2, angle3, angle4, angle5].map(
          (angle) => `${centerX + sr * Math.cos(angle)},${centerY + sr * Math.sin(angle)}`
        ).join(' ');
        return (
          <polygon
            key={i}
            points={points}
            fill="none"
            stroke="#d4a373"
            strokeWidth="1"
            opacity={0.3}
          />
        );
      })}
      
      {/* 轴线 */}
      {[angle1, angle2, angle3, angle4, angle5].map((angle, i) => (
        <line 
          key={i}
          x1={centerX} 
          y1={centerY} 
          x2={centerX + maxRadius * Math.cos(angle)} 
          y2={centerY + maxRadius * Math.sin(angle)} 
          stroke="#d4a373" 
          strokeWidth="1" 
          opacity={0.4} 
        />
      ))}
      
      {/* 数据区域 - 五边形 */}
      <polygon
        points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y} ${p5.x},${p5.y}`}
        fill="#b45309"
        fillOpacity={0.3}
        stroke="#b45309"
        strokeWidth="2"
      />
      
      {/* 数据点 */}
      <circle cx={p1.x} cy={p1.y} r="4" fill="#b45309" />
      <circle cx={p2.x} cy={p2.y} r="4" fill="#b45309" />
      <circle cx={p3.x} cy={p3.y} r="4" fill="#b45309" />
      <circle cx={p4.x} cy={p4.y} r="4" fill="#b45309" />
      <circle cx={p5.x} cy={p5.y} r="4" fill="#b45309" />
      
      {/* 标签 */}
      <text x={max1.x} y={max1.y - 10} textAnchor="middle" className="text-[9px] fill-amber-800">
        自信度 {confidence}
      </text>
      <text x={max2.x + 8} y={max2.y - 5} textAnchor="start" className="text-[9px] fill-amber-800">
        专业度 {professionalism}
      </text>
      <text x={max3.x + 8} y={max3.y + 10} textAnchor="start" className="text-[9px] fill-amber-800">
        深度 {depth}
      </text>
      <text x={max4.x - 8} y={max4.y + 10} textAnchor="end" className="text-[9px] fill-amber-800">
        理论实践 {theory_practice}
      </text>
      <text x={max5.x - 8} y={max5.y - 5} textAnchor="end" className="text-[9px] fill-amber-800">
        敏感度 {tech_sensitivity}
      </text>
    </svg>
  );
}

// 洞察卡片组件
function InsightCard({ insight, isExpanded, onToggle }: { insight: SessionInsight; isExpanded: boolean; onToggle: () => void }) {
  const typeConfig: Record<InsightType, { icon: React.ReactNode; bgColor: string; textColor: string; label: string }> = {
    knowledge_gap: {
      icon: <AlertCircle className="w-4 h-4" />,
      bgColor: 'bg-red-100',
      textColor: 'text-red-600',
      label: '知识盲点',
    },
    strength: {
      icon: <CheckCircle className="w-4 h-4" />,
      bgColor: 'bg-green-100',
      textColor: 'text-green-600',
      label: '优势项',
    },
    suggestion: {
      icon: <Lightbulb className="w-4 h-4" />,
      bgColor: 'bg-amber-100',
      textColor: 'text-amber-600',
      label: '改进建议',
    },
  };

  const config = typeConfig[insight.insight_type];
  const priorityLabels = ['低', '中', '高'];

  return (
    <div className="bg-amber-100/50 border border-amber-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-amber-100/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`${config.bgColor} ${config.textColor} p-1 rounded`}>
            {config.icon}
          </span>
          <span className="text-sm font-medium text-amber-900">{insight.title}</span>
          {insight.insight_type === 'knowledge_gap' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              insight.priority >= 2 ? 'bg-red-200 text-red-700' :
              insight.priority === 1 ? 'bg-amber-200 text-amber-700' :
              'bg-gray-200 text-gray-600'
            }`}>
              {priorityLabels[insight.priority] || '低'}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-amber-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-500" />
        )}
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 text-sm text-amber-700 border-t border-amber-200 pt-2">
          {insight.detail}
        </div>
      )}
    </div>
  );
}

// 消息评分卡片组件（显示应聘者作答评分）
function MessageScoreCard({ score, index }: { score: MessageScore; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-amber-100/30 border border-amber-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-amber-100/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-amber-500 font-mono">Q{index + 1}</span>
          <div className="flex items-center gap-2">
            {score.topic_tags.slice(0, 2).map((tag, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-amber-200/60 text-amber-700 rounded">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${
            score.overall_score >= 80 ? 'text-green-600' :
            score.overall_score >= 60 ? 'text-amber-600' :
            'text-red-500'
          }`}>
            {score.overall_score}分
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-amber-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-amber-500" />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-amber-200 pt-2 space-y-2">
          {/* 五个维度分数 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-amber-600">
            <span>自信度: <b className="text-amber-800">{score.confidence_score}</b></span>
            <span>专业度: <b className="text-amber-800">{score.professionalism_score}</b></span>
            <span>技术深度: <b className="text-amber-800">{score.depth_score}</b></span>
            <span>理论实践: <b className="text-amber-800">{score.theory_practice_score}</b></span>
            <span>技术敏感度: <b className="text-amber-800">{score.tech_sensitivity_score}</b></span>
          </div>
          {/* AI 反馈 */}
          {score.feedback && (
            <div className="bg-amber-800/5 rounded p-2 text-xs text-amber-700">
              <span className="text-amber-500">💡 </span>
              {score.feedback}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 洞察列表组件
function InsightSection({ 
  title, 
  icon, 
  insights, 
  type 
}: { 
  title: string; 
  icon: React.ReactNode; 
  insights: SessionInsight[]; 
  type: InsightType;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const filteredInsights = insights.filter(i => i.insight_type === type);

  if (filteredInsights.length === 0) return null;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-medium text-amber-900">
        {icon}
        {title} ({filteredInsights.length})
      </h4>
      <div className="space-y-2">
        {filteredInsights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            isExpanded={expandedIds.has(insight.id)}
            onToggle={() => toggleExpand(insight.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function ReviewReport({ report, timingStats }: ReviewReportProps) {
  const [showAllScores, setShowAllScores] = useState(false);

  // 取前 5 条或全部
  const displayedScores = showAllScores 
    ? report.message_scores 
    : report.message_scores.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* 综合评分区域 */}
      <div className="bg-amber-800/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-lg font-bold text-amber-900">综合评分</h4>
            <p className="text-xs text-amber-600 mt-0.5">
              基于 {report.scored_count} 条作答的评估
            </p>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold ${
              report.overall_score >= 80 ? 'text-green-600' :
              report.overall_score >= 60 ? 'text-amber-600' :
              'text-red-500'
            }`}>
              {report.overall_score}
              <span className="text-lg text-amber-400">/100</span>
            </div>
          </div>
        </div>

        {/* 雷达图 */}
        <RadarChart
          confidence={Math.round(report.dimension_averages.confidence)}
          professionalism={Math.round(report.dimension_averages.professionalism)}
          depth={Math.round(report.dimension_averages.depth)}
          theory_practice={Math.round(report.dimension_averages.theory_practice)}
          tech_sensitivity={Math.round(report.dimension_averages.tech_sensitivity)}
        />
      </div>

      {/* 知识盲点 */}
      <InsightSection
        title="知识盲点"
        icon={<span className="text-red-500">🔴</span>}
        insights={report.insights}
        type="knowledge_gap"
      />

      {/* 回答用时统计 */}
      {timingStats && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <Clock className="w-4 h-4 text-amber-600" />
            回答用时统计
          </h4>

          {/* 概览卡片区 */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-amber-100/50 rounded-lg p-2 text-center">
              <div className="text-xs text-amber-600">总时长</div>
              <div className="text-sm font-bold text-amber-900">{formatTimeDuration(timingStats.totalDurationMs)}</div>
            </div>
            <div className="bg-amber-100/50 rounded-lg p-2 text-center">
              <div className="text-xs text-amber-600">平均用时</div>
              <div className="text-sm font-bold text-amber-900">{formatTimeDuration(timingStats.averageDurationMs)}</div>
            </div>
            <div className="bg-green-100/50 rounded-lg p-2 text-center">
              <div className="text-xs text-green-600">最快</div>
              <div className="text-sm font-bold text-green-700">{formatTimeDuration(timingStats.fastestDurationMs)}</div>
            </div>
            <div className="bg-red-100/50 rounded-lg p-2 text-center">
              <div className="text-xs text-red-500">最慢</div>
              <div className="text-sm font-bold text-red-600">{formatTimeDuration(timingStats.slowestDurationMs)}</div>
            </div>
          </div>

          {/* 每题用时列表 */}
          <div className="space-y-1.5">
            {timingStats.questionTimings.map((timing, idx) => {
              // 计算柱状图宽度比例（相对于最慢回答）
              const barWidth = Math.max(10, (timing.durationMs / timingStats.slowestDurationMs) * 100);
              
              return (
                <div key={idx} className="bg-amber-50 border border-amber-200/50 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-amber-500 font-mono shrink-0">Q{timing.questionIndex + 1}</span>
                      <span className="text-xs text-amber-700 truncate" title={timing.questionContent}>
                        {timing.questionContent.length > 50 
                          ? timing.questionContent.substring(0, 50) + '...' 
                          : timing.questionContent}
                      </span>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${getTimingColorClass(timing.durationMs)}`}>
                      {formatTimeDuration(timing.durationMs)}
                    </span>
                  </div>
                  {/* 水平柱状图 */}
                  <div className="h-1.5 bg-amber-200/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${getBarColorClass(timing.durationMs)}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 用时说明 */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-amber-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              &lt;60秒 优秀
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              60-180秒 正常
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              &gt;180秒 较慢
            </span>
          </div>
        </div>
      )}

      {/* 优势项 */}
      <InsightSection
        title="优势项"
        icon={<span className="text-green-500">🟢</span>}
        insights={report.insights}
        type="strength"
      />

      {/* 改进建议 */}
      <InsightSection
        title="改进建议"
        icon={<span className="text-amber-500">💡</span>}
        insights={report.insights}
        type="suggestion"
      />

      {/* 逐题作答评分详情 */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium text-amber-900">
          📋 你的作答评分
        </h4>
        <div className="space-y-2">
          {displayedScores.map((score, index) => (
            <MessageScoreCard key={score.id} score={score} index={index} />
          ))}
        </div>
        {report.message_scores.length > 5 && (
          <button
            onClick={() => setShowAllScores(!showAllScores)}
            className="w-full py-2 text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded-lg transition-colors"
          >
            {showAllScores ? '收起' : `查看全部 ${report.message_scores.length} 条评分`}
          </button>
        )}
      </div>
    </div>
  );
}
