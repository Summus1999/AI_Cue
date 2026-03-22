export interface InterviewFlowMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface InterviewTurnContext {
  answer: string;
  questionIndex: number;
  history: InterviewFlowMessage[];
}

function stripStageMarker(text: string): string {
  return text.replace(/【[^】]*】/g, ' ');
}

function normalizeQuestion(text: string): string {
  return stripStageMarker(text)
    .toLowerCase()
    .replace(/[，。！？、；：,.!?;:'"()\[\]{}<>《》“”‘’\s]+/g, '')
    .trim();
}

function getBigrams(text: string): Set<string> {
  if (text.length <= 1) {
    return new Set([text]);
  }
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const aSet = getBigrams(a);
  const bSet = getBigrams(b);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = aSet.size + bSet.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function getInterviewPhaseHint(questionIndex: number): string {
  const next = questionIndex + 1;
  if (next <= 1) return '开场阶段：仅确认状态并快速进入技术问题';
  if (next <= 5) return '技术深挖阶段：优先考察核心技术与原理';
  if (next <= 8) return '项目深挖阶段：围绕简历项目追问细节与取舍';
  if (next <= 10) return '行为面试阶段：考察协作、冲突处理和复盘能力';
  return '收尾阶段：给出最后一问并引导反问环节';
}

function collectRecentInterviewerQuestions(
  history: InterviewFlowMessage[],
  limit: number,
): string[] {
  const assistantMessages = history.filter((item) => item.role === 'assistant');
  const questions: string[] = [];
  for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
    const text = assistantMessages[i].content.trim();
    if (!text) continue;
    questions.push(text);
    if (questions.length >= limit) break;
  }
  return questions.reverse();
}

export function buildInterviewerRequestText(context: InterviewTurnContext): string {
  const recentQuestions = collectRecentInterviewerQuestions(context.history, 3);
  const normalized = recentQuestions.map(normalizeQuestion).filter(Boolean);
  const latest = normalized[normalized.length - 1] || '';
  const previous = normalized.slice(0, -1);
  const hasPotentialRepeat = previous.some((item) => jaccardSimilarity(item, latest) >= 0.82);

  const questionBlock = recentQuestions.length
    ? recentQuestions.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '暂无';

  return [
    '请严格按以下面试回合规则输出：',
    '1. 先对候选人回答给出一句不超过25字的评价，不要复述候选人原话。',
    '2. 然后只提出一个全新的下一个问题。',
    '3. 严禁重复最近三问的语义与措辞，若重复请自动改写为新问题。',
    '4. 输出保持纯文本，不要使用列表符号。',
    '',
    `当前阶段提示：${getInterviewPhaseHint(context.questionIndex)}`,
    `重复风险标记：${hasPotentialRepeat ? '检测到历史问题相似，必须换题' : '正常推进'}`,
    '最近三问（禁止重复）：',
    questionBlock,
    '',
    `候选人本轮回答：${context.answer}`,
  ].join('\n');
}
