import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle, Lightbulb } from 'lucide-react';
import type { ReviewReport, MessageScore, SessionInsight, InsightType } from '../../types/review';

interface ReviewReportProps {
  report: ReviewReport;
  onExportPdf?: () => void;
}

// 雷达图组件
function RadarChart({ completeness, accuracy, clarity }: { completeness: number; accuracy: number; clarity: number }) {
  // 雷达图参数
  const centerX = 100;
  const centerY = 90;
  const maxRadius = 70;
  
  // 将分数转换为半径（0-100 -> 0-maxRadius）
  const r1 = (completeness / 100) * maxRadius;
  const r2 = (accuracy / 100) * maxRadius;
  const r3 = (clarity / 100) * maxRadius;
  
  // 三个顶点的角度（均匀分布，从顶部开始）
  const angle1 = -Math.PI / 2;       // 顶部 - 完整性
  const angle2 = -Math.PI / 2 + (2 * Math.PI / 3);  // 右下 - 准确性
  const angle3 = -Math.PI / 2 + (4 * Math.PI / 3);  // 左下 - 清晰度
  
  // 计算顶点坐标
  const p1 = { x: centerX + r1 * Math.cos(angle1), y: centerY + r1 * Math.sin(angle1) };
  const p2 = { x: centerX + r2 * Math.cos(angle2), y: centerY + r2 * Math.sin(angle2) };
  const p3 = { x: centerX + r3 * Math.cos(angle3), y: centerY + r3 * Math.sin(angle3) };
  
  // 外圈顶点（最大值）
  const max1 = { x: centerX + maxRadius * Math.cos(angle1), y: centerY + maxRadius * Math.sin(angle1) };
  const max2 = { x: centerX + maxRadius * Math.cos(angle2), y: centerY + maxRadius * Math.sin(angle2) };
  const max3 = { x: centerX + maxRadius * Math.cos(angle3), y: centerY + maxRadius * Math.sin(angle3) };
  
  return (
    <svg width="200" height="180" viewBox="0 0 200 180" className="mx-auto">
      {/* 背景网格 - 三个同心三角形 */}
      {[0.33, 0.66, 1].map((scale, i) => {
        const sr = maxRadius * scale;
        const sp1 = { x: centerX + sr * Math.cos(angle1), y: centerY + sr * Math.sin(angle1) };
        const sp2 = { x: centerX + sr * Math.cos(angle2), y: centerY + sr * Math.sin(angle2) };
        const sp3 = { x: centerX + sr * Math.cos(angle3), y: centerY + sr * Math.sin(angle3) };
        return (
          <polygon
            key={i}
            points={`${sp1.x},${sp1.y} ${sp2.x},${sp2.y} ${sp3.x},${sp3.y}`}
            fill="none"
            stroke="#d4a373"
            strokeWidth="1"
            opacity={0.3}
          />
        );
      })}
      
      {/* 轴线 */}
      <line x1={centerX} y1={centerY} x2={max1.x} y2={max1.y} stroke="#d4a373" strokeWidth="1" opacity={0.4} />
      <line x1={centerX} y1={centerY} x2={max2.x} y2={max2.y} stroke="#d4a373" strokeWidth="1" opacity={0.4} />
      <line x1={centerX} y1={centerY} x2={max3.x} y2={max3.y} stroke="#d4a373" strokeWidth="1" opacity={0.4} />
      
      {/* 数据区域 */}
      <polygon
        points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
        fill="#b45309"
        fillOpacity={0.3}
        stroke="#b45309"
        strokeWidth="2"
      />
      
      {/* 数据点 */}
      <circle cx={p1.x} cy={p1.y} r="4" fill="#b45309" />
      <circle cx={p2.x} cy={p2.y} r="4" fill="#b45309" />
      <circle cx={p3.x} cy={p3.y} r="4" fill="#b45309" />
      
      {/* 标签 */}
      <text x={max1.x} y={max1.y - 8} textAnchor="middle" className="text-[10px] fill-amber-800">
        完整性 {completeness}
      </text>
      <text x={max2.x + 20} y={max2.y + 5} textAnchor="start" className="text-[10px] fill-amber-800">
        准确性 {accuracy}
      </text>
      <text x={max3.x - 20} y={max3.y + 5} textAnchor="end" className="text-[10px] fill-amber-800">
        清晰度 {clarity}
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
          {/* 三个维度分数 */}
          <div className="flex items-center gap-4 text-xs text-amber-600">
            <span>完整性: <b className="text-amber-800">{score.completeness_score}</b></span>
            <span>准确性: <b className="text-amber-800">{score.accuracy_score}</b></span>
            <span>清晰度: <b className="text-amber-800">{score.clarity_score}</b></span>
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

export function ReviewReport({ report }: ReviewReportProps) {
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
          completeness={Math.round(report.dimension_averages.completeness)}
          accuracy={Math.round(report.dimension_averages.accuracy)}
          clarity={Math.round(report.dimension_averages.clarity)}
        />
      </div>

      {/* 知识盲点 */}
      <InsightSection
        title="知识盲点"
        icon={<span className="text-red-500">🔴</span>}
        insights={report.insights}
        type="knowledge_gap"
      />

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
