import type { TrendData, TrendPoint } from '../../types/review';

interface TrendComparisonProps {
  trend: TrendData;
}

// 折线图颜色配置 - 五个维度
const lineColors = {
  overall: '#b45309',      // 综合 - 深琥珀色
  confidence: '#059669',   // 面试自信度 - 绿色
  professionalism: '#2563eb', // 技术专业度 - 蓝色
  depth: '#9333ea',        // 技术深度 - 紫色
  theory_practice: '#dc2626', // 理论实践 - 红色
  tech_sensitivity: '#ea580c', // 技术敏感度 - 橙色
};

// SVG 折线图组件
function TrendLineChart({ sessions }: { sessions: TrendPoint[] }) {
  if (sessions.length === 0) return null;

  // 图表尺寸
  const width = 480;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 40 };
  
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // 数据点数量
  const count = sessions.length;
  const xStep = chartWidth / Math.max(count - 1, 1);
  
  // Y 轴范围 (0-100)
  const yMax = 100;
  
  // 计算坐标
  const getX = (index: number) => padding.left + index * xStep;
  const getY = (value: number) => padding.top + chartHeight - (value / yMax) * chartHeight;
  
  // 生成路径 - 五个维度
  const generatePath = (dataKey: 'overall_score' | 'confidence' | 'professionalism' | 'depth' | 'theory_practice' | 'tech_sensitivity') => {
    if (sessions.length === 0) return '';
    
    const points = sessions.map((session, i) => {
      const value = dataKey === 'overall_score' ? session.overall_score : session[dataKey];
      return `${getX(i)},${getY(value)}`;
    });
    
    return `M ${points.join(' L ')}`;
  };

  // Y 轴刻度
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <svg width={width} height={height} className="w-full h-auto" viewBox={`0 0 ${width} ${height}`}>
      {/* 背景网格 */}
      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            y1={getY(tick)}
            x2={width - padding.right}
            y2={getY(tick)}
            stroke="#d4a373"
            strokeWidth="1"
            strokeDasharray="3,3"
            opacity={0.3}
          />
          <text
            x={padding.left - 8}
            y={getY(tick)}
            textAnchor="end"
            alignmentBaseline="middle"
            className="text-[10px] fill-amber-500"
          >
            {tick}
          </text>
        </g>
      ))}
      
      {/* X 轴标签 */}
      {sessions.map((session, i) => (
        <g key={session.session_id}>
          <text
            x={getX(i)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            className="text-[9px] fill-amber-600"
          >
            {session.session_title.length > 6 
              ? session.session_title.slice(0, 6) + '...' 
              : session.session_title}
          </text>
        </g>
      ))}
      
      {/* 折线 - 综合 + 五个维度 */}
      <path d={generatePath('overall_score')} fill="none" stroke={lineColors.overall} strokeWidth="2.5" />
      <path d={generatePath('confidence')} fill="none" stroke={lineColors.confidence} strokeWidth="1.5" opacity={0.7} />
      <path d={generatePath('professionalism')} fill="none" stroke={lineColors.professionalism} strokeWidth="1.5" opacity={0.7} />
      <path d={generatePath('depth')} fill="none" stroke={lineColors.depth} strokeWidth="1.5" opacity={0.7} />
      <path d={generatePath('theory_practice')} fill="none" stroke={lineColors.theory_practice} strokeWidth="1.5" opacity={0.7} />
      <path d={generatePath('tech_sensitivity')} fill="none" stroke={lineColors.tech_sensitivity} strokeWidth="1.5" opacity={0.7} />
      
      {/* 数据点 */}
      {sessions.map((session, i) => (
        <g key={session.session_id}>
          <circle cx={getX(i)} cy={getY(session.overall_score)} r="4" fill={lineColors.overall} />
          <circle cx={getX(i)} cy={getY(session.confidence)} r="3" fill={lineColors.confidence} opacity={0.7} />
          <circle cx={getX(i)} cy={getY(session.professionalism)} r="3" fill={lineColors.professionalism} opacity={0.7} />
          <circle cx={getX(i)} cy={getY(session.depth)} r="3" fill={lineColors.depth} opacity={0.7} />
          <circle cx={getX(i)} cy={getY(session.theory_practice)} r="3" fill={lineColors.theory_practice} opacity={0.7} />
          <circle cx={getX(i)} cy={getY(session.tech_sensitivity)} r="3" fill={lineColors.tech_sensitivity} opacity={0.7} />
        </g>
      ))}
    </svg>
  );
}

// 图例组件 - 五个维度
function ChartLegend() {
  const legends = [
    { key: 'overall', label: '综合', color: lineColors.overall },
    { key: 'confidence', label: '自信度', color: lineColors.confidence },
    { key: 'professionalism', label: '专业度', color: lineColors.professionalism },
    { key: 'depth', label: '深度', color: lineColors.depth },
    { key: 'theory_practice', label: '理论实践', color: lineColors.theory_practice },
    { key: 'tech_sensitivity', label: '敏感度', color: lineColors.tech_sensitivity },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2">
      {legends.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-1.5">
          <span
            className="w-3 h-0.5 rounded"
            style={{ backgroundColor: color }}
          />
          <span className="text-[10px] text-amber-600">{label}</span>
        </div>
      ))}
    </div>
  );
}

// 盲点演变卡片组件
function GapEvolutionCard({ 
  resolved, 
  persistent, 
  newGaps 
}: { 
  resolved: string[]; 
  persistent: string[]; 
  newGaps: string[];
}) {
  return (
    <div className="space-y-3">
      {/* 已消除 */}
      {resolved.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-green-700 mb-1.5 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            已消除 ({resolved.length})
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {resolved.map((gap, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full border border-green-200"
              >
                {gap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 持续存在 */}
      {persistent.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-amber-700 mb-1.5 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            持续存在 ({persistent.length})
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {persistent.map((gap, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full border border-amber-200"
              >
                {gap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 新出现 */}
      {newGaps.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-red-700 mb-1.5 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            新出现 ({newGaps.length})
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {newGaps.map((gap, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full border border-red-200"
              >
                {gap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 无盲点变化 */}
      {resolved.length === 0 && persistent.length === 0 && newGaps.length === 0 && (
        <p className="text-xs text-amber-500 text-center py-2">暂无盲点演变数据</p>
      )}
    </div>
  );
}

// 进步摘要组件
function ProgressSummary({ sessions }: { sessions: TrendPoint[] }) {
  if (sessions.length < 2) {
    return (
      <p className="text-xs text-amber-600 text-center py-2">
        需要至少两次复盘才能生成趋势分析
      </p>
    );
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const diff = last.overall_score - first.overall_score;
  const trend = diff > 0 ? '提升' : diff < 0 ? '下降' : '持平';
  const emoji = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';

  return (
    <div className="bg-amber-100/50 rounded-lg p-3">
      <p className="text-sm text-amber-800">
        {emoji} 综合评分从 <b>{first.overall_score}</b> 分{trend}至 <b>{last.overall_score}</b> 分，
        {diff > 0 && `进步了 ${diff} 分！继续保持！`}
        {diff < 0 && `需要更多练习。`}
        {diff === 0 && `表现稳定。`}
      </p>
      {sessions.length > 2 && (
        <p className="text-xs text-amber-600 mt-1">
          共完成 {sessions.length} 次面试复盘
        </p>
      )}
    </div>
  );
}

export function TrendComparison({ trend }: TrendComparisonProps) {
  const { sessions, gap_evolution } = trend;

  return (
    <div className="space-y-6">
      {/* 评分趋势图 */}
      <div>
        <h4 className="text-sm font-medium text-amber-900 mb-3">📊 评分趋势</h4>
        {sessions.length > 0 ? (
          <>
            <div className="bg-amber-100/30 rounded-xl p-4 border border-amber-200">
              <TrendLineChart sessions={sessions} />
              <ChartLegend />
            </div>
            <div className="mt-3">
              <ProgressSummary sessions={sessions} />
            </div>
          </>
        ) : (
          <div className="bg-amber-100/30 rounded-xl p-6 border border-amber-200 text-center">
            <p className="text-sm text-amber-500">暂无历史复盘数据</p>
            <p className="text-xs text-amber-400 mt-1">完成更多面试复盘后可查看趋势</p>
          </div>
        )}
      </div>

      {/* 知识盲点演变 */}
      <div>
        <h4 className="text-sm font-medium text-amber-900 mb-3">🎯 知识盲点演变</h4>
        <div className="bg-amber-100/30 rounded-xl p-4 border border-amber-200">
          <GapEvolutionCard
            resolved={gap_evolution.resolved}
            persistent={gap_evolution.persistent}
            newGaps={gap_evolution.new_gaps}
          />
        </div>
      </div>
    </div>
  );
}
