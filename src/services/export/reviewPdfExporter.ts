import { ExportStrategy, ExportFormat } from './types';
import type { ReviewReport, SessionInsight, MessageScore } from '../../types/review';

/**
 * 复盘报告数据（用于导出）
 */
export interface ReviewExportData {
  reviewReport: ReviewReport;
}

/**
 * 复盘报告 PDF 导出器（生成 HTML 中间产物，由 Edge 转换为 PDF）
 */
export class ReviewPdfExporter implements ExportStrategy {
  readonly format: ExportFormat = 'review_pdf';
  readonly fileExtension = '.pdf';
  readonly mimeType = 'application/pdf';

  async export(data: any): Promise<string> {
    const reviewData = data as ReviewExportData;
    return this.generateHtml(reviewData.reviewReport);
  }

  getDefaultFileName(sessionTitle: string): string {
    const safeTitle = this.sanitizeFilename(sessionTitle || '未命名会话');
    const date = new Date().toISOString().split('T')[0];
    return `${safeTitle}_复盘报告_${date}.pdf`;
  }

  private sanitizeFilename(title: string): string {
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getScoreColor(score: number): string {
    if (score >= 80) return '#4CAF50'; // 绿色
    if (score >= 60) return '#FFC107'; // 黄色
    return '#F44336'; // 红色
  }

  private getScoreGradient(score: number): string {
    if (score >= 80) return 'linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%)';
    if (score >= 60) return 'linear-gradient(90deg, #FFC107 0%, #FFE082 100%)';
    return 'linear-gradient(90deg, #F44336 0%, #FFCDD2 100%)';
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private generateHtml(report: ReviewReport): string {
    const styles = this.generateStyles();
    const coverSection = this.generateCoverSection(report);
    const scoreOverviewSection = this.generateScoreOverviewSection(report);
    const insightsSection = this.generateInsightsSection(report);
    const detailsSection = this.generateDetailsSection(report);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>面试复盘报告 - ${this.escapeHtml(report.session_title)}</title>
    ${styles}
</head>
<body>
    ${coverSection}
    ${scoreOverviewSection}
    ${insightsSection}
    ${detailsSection}
</body>
</html>`;
  }

  private generateStyles(): string {
    return `<style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #3E2723;
        max-width: 210mm;
        margin: 0 auto;
        padding: 20mm 15mm;
        background: #FFFDF7;
      }
      h1 {
        font-size: 28px;
        color: #3E2723;
        margin-bottom: 10px;
      }
      h2 {
        font-size: 20px;
        color: #4E342E;
        margin-bottom: 15px;
        padding-bottom: 8px;
        border-bottom: 2px solid #D7CCC8;
      }
      h3 {
        font-size: 16px;
        color: #5D4037;
        margin-bottom: 10px;
      }

      /* 封面区域 */
      .cover {
        text-align: center;
        padding: 40px 0;
        margin-bottom: 30px;
        background: linear-gradient(135deg, #EFEBE9 0%, #D7CCC8 100%);
        border-radius: 12px;
        page-break-after: always;
      }
      .cover h1 {
        font-size: 32px;
        margin-bottom: 20px;
      }
      .cover-info {
        color: #6D4C41;
        margin: 10px 0;
        font-size: 16px;
      }
      .cover-score {
        font-size: 64px;
        font-weight: bold;
        margin: 30px 0;
      }
      .cover-score-label {
        font-size: 18px;
        color: #8D6E63;
      }

      /* 面试背景 */
      .interview-context {
        background: #FFF8E1;
        border-left: 4px solid #6D4C41;
        padding: 15px 20px;
        margin: 20px 0;
        border-radius: 0 8px 8px 0;
      }
      .interview-context-item {
        margin: 5px 0;
        color: #5D4037;
      }
      .interview-context-item strong {
        color: #3E2723;
      }

      /* 评分概览 */
      .score-overview {
        margin-bottom: 30px;
        page-break-inside: avoid;
      }
      .dimension-scores {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        margin-top: 20px;
      }
      .dimension-card {
        flex: 1;
        background: #EFEBE9;
        border-radius: 8px;
        padding: 20px;
        text-align: center;
      }
      .dimension-name {
        font-size: 14px;
        color: #6D4C41;
        margin-bottom: 10px;
      }
      .dimension-score {
        font-size: 36px;
        font-weight: bold;
      }
      .score-bar-container {
        margin-top: 15px;
      }
      .score-bar {
        height: 8px;
        background: #D7CCC8;
        border-radius: 4px;
        overflow: hidden;
      }
      .score-bar-fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      /* 洞察区域 */
      .insights-section {
        margin-bottom: 30px;
        page-break-before: always;
      }
      .insight-category {
        margin-bottom: 25px;
        page-break-inside: avoid;
      }
      .insight-list {
        list-style: none;
      }
      .insight-item {
        background: #FFF8E1;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 10px;
        border-left: 4px solid;
      }
      .insight-item.knowledge_gap {
        border-left-color: #F44336;
        background: #FFEBEE;
      }
      .insight-item.strength {
        border-left-color: #4CAF50;
        background: #E8F5E9;
      }
      .insight-item.suggestion {
        border-left-color: #2196F3;
        background: #E3F2FD;
      }
      .insight-title {
        font-weight: bold;
        color: #3E2723;
        margin-bottom: 5px;
      }
      .insight-detail {
        color: #5D4037;
        font-size: 13px;
      }
      .insight-priority {
        display: inline-block;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 10px;
      }
      .priority-high {
        background: #FFCDD2;
        color: #C62828;
      }
      .priority-medium {
        background: #FFE082;
        color: #F57F17;
      }
      .priority-low {
        background: #C8E6C9;
        color: #2E7D32;
      }

      /* 详情表格 */
      .details-section {
        page-break-before: always;
      }
      .details-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
        font-size: 12px;
      }
      .details-table th,
      .details-table td {
        padding: 12px 10px;
        border: 1px solid #D7CCC8;
        text-align: center;
      }
      .details-table th {
        background: #EFEBE9;
        color: #4E342E;
        font-weight: 600;
      }
      .details-table tr:nth-child(even) {
        background: #FFF8E1;
      }
      .details-table tr:hover {
        background: #EFEBE9;
      }
      .feedback-cell {
        text-align: left;
        max-width: 300px;
        word-wrap: break-word;
        font-size: 11px;
        color: #5D4037;
      }
      .topic-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        justify-content: center;
      }
      .topic-tag {
        display: inline-block;
        background: #D7CCC8;
        color: #4E342E;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
      }
      .mini-score-bar {
        width: 60px;
        height: 6px;
        background: #D7CCC8;
        border-radius: 3px;
        overflow: hidden;
        display: inline-block;
        vertical-align: middle;
        margin-left: 8px;
      }
      .mini-score-bar-fill {
        height: 100%;
        border-radius: 3px;
      }

      /* 统计信息 */
      .stats-row {
        display: flex;
        justify-content: space-around;
        background: #EFEBE9;
        padding: 15px;
        border-radius: 8px;
        margin-top: 20px;
      }
      .stat-item {
        text-align: center;
      }
      .stat-value {
        font-size: 24px;
        font-weight: bold;
        color: #4E342E;
      }
      .stat-label {
        font-size: 12px;
        color: #8D6E63;
      }

      /* 打印优化 */
      @media print {
        body {
          padding: 15mm 10mm;
          background: white;
        }
        .cover {
          page-break-after: always;
        }
        .insights-section,
        .details-section {
          page-break-before: always;
        }
        .insight-category,
        .dimension-card {
          page-break-inside: avoid;
        }
      }
    </style>`;
  }

  private generateCoverSection(report: ReviewReport): string {
    const scoreColor = this.getScoreColor(report.overall_score);
    const contextHtml = report.interview_context
      ? `<div class="interview-context">
          <div class="interview-context-item"><strong>目标公司：</strong>${this.escapeHtml(report.interview_context.company)}</div>
          <div class="interview-context-item"><strong>目标职位：</strong>${this.escapeHtml(report.interview_context.position)}</div>
          ${report.interview_context.jdHighlights ? `<div class="interview-context-item"><strong>JD 要点：</strong>${this.escapeHtml(report.interview_context.jdHighlights)}</div>` : ''}
        </div>`
      : '';

    return `
    <div class="cover">
      <h1>面试复盘报告</h1>
      <p class="cover-info">会话：${this.escapeHtml(report.session_title)}</p>
      ${contextHtml}
      <div class="cover-score" style="color: ${scoreColor}">
        ${Math.round(report.overall_score)}
        <span style="font-size: 24px;">/100</span>
      </div>
      <p class="cover-score-label">综合评分</p>
      <p class="cover-info">生成时间：${this.formatDate(report.completed_at)}</p>
      <div class="stats-row">
        <div class="stat-item">
          <div class="stat-value">${report.message_count}</div>
          <div class="stat-label">作答总数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${report.scored_count}</div>
          <div class="stat-label">已评分数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${report.insights.length}</div>
          <div class="stat-label">洞察数量</div>
        </div>
      </div>
    </div>`;
  }

  private generateScoreOverviewSection(report: ReviewReport): string {
    const dims = report.dimension_averages;
    
    const dimensionCard = (name: string, score: number) => {
      const color = this.getScoreColor(score);
      const gradient = this.getScoreGradient(score);
      return `
        <div class="dimension-card">
          <div class="dimension-name">${name}</div>
          <div class="dimension-score" style="color: ${color}">${Math.round(score)}</div>
          <div class="score-bar-container">
            <div class="score-bar">
              <div class="score-bar-fill" style="width: ${score}%; background: ${gradient};"></div>
            </div>
          </div>
        </div>`;
    };

    return `
    <div class="score-overview">
      <h2>评分概览</h2>
      <div class="dimension-scores">
        ${dimensionCard('面试自信度', dims.confidence)}
        ${dimensionCard('技术专业度', dims.professionalism)}
        ${dimensionCard('技术深度', dims.depth)}
        ${dimensionCard('理论实践', dims.theory_practice)}
        ${dimensionCard('技术敏感度', dims.tech_sensitivity)}
      </div>
    </div>`;
  }

  private generateInsightsSection(report: ReviewReport): string {
    const knowledgeGaps = report.insights.filter(i => i.insight_type === 'knowledge_gap');
    const strengths = report.insights.filter(i => i.insight_type === 'strength');
    const suggestions = report.insights.filter(i => i.insight_type === 'suggestion');

    const renderInsightList = (insights: SessionInsight[], type: string) => {
      if (insights.length === 0) {
        return '<p style="color: #8D6E63; font-style: italic;">暂无数据</p>';
      }
      return `<ul class="insight-list">
        ${insights.map(insight => {
          const priorityClass = insight.priority >= 3 ? 'priority-high' : (insight.priority >= 2 ? 'priority-medium' : 'priority-low');
          const priorityText = insight.priority >= 3 ? '高' : (insight.priority >= 2 ? '中' : '低');
          return `
            <li class="insight-item ${type}">
              <div class="insight-title">
                ${this.escapeHtml(insight.title)}
                <span class="insight-priority ${priorityClass}">优先级：${priorityText}</span>
              </div>
              <div class="insight-detail">${this.escapeHtml(insight.detail)}</div>
            </li>`;
        }).join('')}
      </ul>`;
    };

    return `
    <div class="insights-section">
      <div class="insight-category">
        <h2>知识盲点</h2>
        ${renderInsightList(knowledgeGaps, 'knowledge_gap')}
      </div>
      
      <div class="insight-category">
        <h2>优势项</h2>
        ${renderInsightList(strengths, 'strength')}
      </div>
      
      <div class="insight-category">
        <h2>改进建议</h2>
        ${renderInsightList(suggestions, 'suggestion')}
      </div>
    </div>`;
  }

  private generateDetailsSection(report: ReviewReport): string {
    if (report.message_scores.length === 0) {
      return `
      <div class="details-section">
        <h2>应聘者作答评分</h2>
        <p style="color: #8D6E63; font-style: italic; text-align: center; padding: 40px;">暂无评分数据</p>
      </div>`;
    }

    const renderScoreWithBar = (score: number) => {
      const color = this.getScoreColor(score);
      const gradient = this.getScoreGradient(score);
      return `
        <span style="color: ${color}; font-weight: bold;">${Math.round(score)}</span>
        <div class="mini-score-bar">
          <div class="mini-score-bar-fill" style="width: ${score}%; background: ${gradient};"></div>
        </div>`;
    };

    const rows = report.message_scores.map((ms: MessageScore, index: number) => {
      const tags = ms.topic_tags && ms.topic_tags.length > 0
        ? `<div class="topic-tags">${ms.topic_tags.map(tag => `<span class="topic-tag">${this.escapeHtml(tag)}</span>`).join('')}</div>`
        : '-';
      
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${renderScoreWithBar(ms.confidence_score)}</td>
          <td>${renderScoreWithBar(ms.professionalism_score)}</td>
          <td>${renderScoreWithBar(ms.depth_score)}</td>
          <td>${renderScoreWithBar(ms.theory_practice_score)}</td>
          <td>${renderScoreWithBar(ms.tech_sensitivity_score)}</td>
          <td>${renderScoreWithBar(ms.overall_score)}</td>
          <td>${tags}</td>
          <td class="feedback-cell">${this.escapeHtml(ms.feedback || '-')}</td>
        </tr>`;
    }).join('');

    return `
    <div class="details-section">
      <h2>应聘者作答评分</h2>
      <table class="details-table">
        <thead>
          <tr>
            <th style="width: 50px;">#</th>
            <th style="width: 80px;">自信度</th>
            <th style="width: 80px;">专业度</th>
            <th style="width: 80px;">深度</th>
            <th style="width: 80px;">理论实践</th>
            <th style="width: 80px;">敏感度</th>
            <th style="width: 80px;">综合分</th>
            <th style="width: 100px;">话题标签</th>
            <th>改进建议</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
  }
}
