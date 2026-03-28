import type { CitationMetadata } from './ragService';

export interface ChatReplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sourceUserMessageId?: string;
  requestText?: string;
  requestImageBase64?: string;
  retrievalQuery?: string;
  requestContentPrefix?: string;
  citations?: CitationMetadata[];
}

export interface SourceUserMatch<TMessage extends ChatReplayMessage = ChatReplayMessage> {
  message: TMessage;
  index: number;
}

export interface ReplayRequestPlan<TMessage extends ChatReplayMessage = ChatReplayMessage> {
  userContent: string;
  requestText: string;
  userMessageId?: string;
  requestImageBase64?: string;
  retrievalQuery: string;
  baseMessages: TMessage[];
  fallbackCitations?: CitationMetadata[];
  existingAssistantContentPrefix: string;
}

export function findSourceUserMessage<TMessage extends ChatReplayMessage>(
  messages: TMessage[],
  assistantMessageIndex: number,
  sourceUserMessageId?: string,
): SourceUserMatch<TMessage> | undefined {
  if (sourceUserMessageId) {
    const sourceUserIndex = messages.findIndex(
      (message, index) => index < assistantMessageIndex && message.id === sourceUserMessageId,
    );
    if (sourceUserIndex >= 0 && messages[sourceUserIndex].role === 'user') {
      return {
        message: messages[sourceUserIndex],
        index: sourceUserIndex,
      };
    }
  }

  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return {
        message: messages[index],
        index,
      };
    }
  }

  return undefined;
}

export function buildContinuePrompt(
  lastContent: string,
  history: Array<Pick<ChatReplayMessage, 'role' | 'content'>>,
  contextSize = 5,
): string {
  const contextMessages = history
    .slice(-(contextSize * 2))
    .map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content.slice(0, 500)}`)
    .join('\n---\n');

  return `这是之前的对话历史：\n${contextMessages}\n\n你的回答在这里中断了：\n"${lastContent.slice(-500)}"\n\n请继续完成这个回答，不要重复已说内容。`;
}

export function buildContinueGenerationPlan<TMessage extends ChatReplayMessage>(
  messages: TMessage[],
  assistantMessageId: string,
): ReplayRequestPlan<TMessage> | undefined {
  const messageIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (messageIndex < 0) {
    return undefined;
  }

  const targetMessage = messages[messageIndex];
  if (targetMessage.role !== 'assistant') {
    return undefined;
  }

  const baseMessages = messages.slice(0, messageIndex);
  const sourceUser = findSourceUserMessage(messages, messageIndex, targetMessage.sourceUserMessageId);
  const continuePrompt = buildContinuePrompt(targetMessage.content, baseMessages, 5);

  return {
    userContent: sourceUser?.message.content ?? continuePrompt,
    requestText: continuePrompt,
    userMessageId: sourceUser?.message.id,
    requestImageBase64: targetMessage.requestImageBase64,
    retrievalQuery: targetMessage.retrievalQuery ?? sourceUser?.message.content ?? continuePrompt,
    baseMessages,
    fallbackCitations: targetMessage.citations,
    existingAssistantContentPrefix: targetMessage.content,
  };
}

export function buildRetryMessagePlan<TMessage extends ChatReplayMessage>(
  messages: TMessage[],
  assistantMessageId: string,
  fallbackRequestText: string,
  latestScreenshotImageBase64?: string,
): ReplayRequestPlan<TMessage> | undefined {
  const messageIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (messageIndex <= 0) {
    return undefined;
  }

  const targetMessage = messages[messageIndex];
  if (targetMessage.role !== 'assistant') {
    return undefined;
  }

  const sourceUser = findSourceUserMessage(messages, messageIndex, targetMessage.sourceUserMessageId);
  if (!sourceUser) {
    return undefined;
  }

  const assistantPrefixContent = targetMessage.requestContentPrefix ?? '';
  const fallbackCitations = assistantPrefixContent.trim() ? targetMessage.citations : undefined;
  const requestImageBase64 = targetMessage.requestImageBase64
    ?? (sourceUser.message.content === '📷 [已发送截图]' ? latestScreenshotImageBase64 : undefined);

  return {
    userContent: sourceUser.message.content,
    requestText: targetMessage.requestText ?? fallbackRequestText,
    userMessageId: sourceUser.message.id,
    requestImageBase64,
    retrievalQuery: targetMessage.retrievalQuery ?? sourceUser.message.content,
    baseMessages: messages.slice(0, messageIndex),
    fallbackCitations,
    existingAssistantContentPrefix: assistantPrefixContent,
  };
}
