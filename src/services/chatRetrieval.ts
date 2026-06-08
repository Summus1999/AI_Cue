import type {
  AppConfig,
  PromptMode,
  RagRetrievalScope,
} from '../store/config';
import type {
  CitationMetadata,
  RagContextBundle,
  RagSourceKind,
} from './ragService';

export interface ChatRetrievalStrategy {
  sourceKinds: RagSourceKind[];
  sessionId?: string;
}

export interface ChatRetrievalPayload {
  promptContext: string;
  citations: CitationMetadata[];
}

export interface ChatRetrievalDependencies {
  retrieveWithCitations: (
    query: string,
    maxTokens: number,
    maxResults: number,
    options: {
      sessionId?: string;
      sourceKinds?: RagSourceKind[];
    },
  ) => Promise<RagContextBundle>;
  getKnowledgeReadyState: () => Promise<boolean | null>;
}

export function getChatRetrievalSourceKinds(promptMode: PromptMode): RagSourceKind[] {
  if (promptMode === 'interviewer') {
    // 面试官模式已经直接携带了最近问答历史，RAG 只补知识库材料，避免重复消费消息检索结果。
    return ['KnowledgeBaseDocument'];
  }

  return ['Message', 'KnowledgeBaseDocument', 'PersonalMemory'];
}

export function getRetrievalScopeSourceKinds(
  retrievalScope: RagRetrievalScope,
  promptMode: PromptMode,
  enablePersonalMemoryForInterviewer = false,
): RagSourceKind[] {
  if (retrievalScope === 'knowledge_base') {
    return ['KnowledgeBaseDocument'];
  }

  if (retrievalScope === 'current_session') {
    return ['Message'];
  }

  if (promptMode === 'interviewer' && enablePersonalMemoryForInterviewer) {
    return ['KnowledgeBaseDocument', 'PersonalMemory'];
  }

  return getChatRetrievalSourceKinds(promptMode);
}

export function resolveChatRetrievalStrategy(
  config: Pick<AppConfig, 'rag'>,
  promptMode: PromptMode,
  sessionId?: string,
): ChatRetrievalStrategy {
  const requestedSourceKinds = getRetrievalScopeSourceKinds(
    config.rag.retrievalScope,
    promptMode,
    config.rag.enablePersonalMemoryForInterviewer,
  );
  const sourceKinds = requestedSourceKinds.filter((sourceKind) =>
    sourceKind !== 'Message' || Boolean(sessionId),
  );

  return {
    sourceKinds,
    sessionId: sourceKinds.includes('Message') ? sessionId : undefined,
  };
}

// 检索链路只能增强回答，不能阻塞主聊天链路。
export async function resolveChatRetrievalContext(
  config: AppConfig,
  promptMode: PromptMode,
  query: string,
  sessionId: string | undefined,
  dependencies: ChatRetrievalDependencies,
): Promise<ChatRetrievalPayload | undefined> {
  if (!config.rag.enabled) {
    console.info('[RAG] 聊天降级到普通模式: RAG 开关关闭');
    return undefined;
  }

  const ragProviderConfig = config.providerConfigs[config.rag.embeddingProvider];
  if (!ragProviderConfig?.apiKey?.trim()) {
    console.info(`[RAG] 聊天降级到普通模式: ${config.rag.embeddingProvider} 未配置 API Key`);
    return undefined;
  }

  try {
    const strategy = resolveChatRetrievalStrategy(config, promptMode, sessionId);
    if (strategy.sourceKinds.length === 0) {
      console.info(
        `[RAG] 聊天降级到普通模式: retrievalScope=${config.rag.retrievalScope} 需要会话消息检索，但当前没有可用 sessionId`,
      );
      return undefined;
    }

    const retrievalBundle = await dependencies.retrieveWithCitations(query, 2000, 5, {
      sessionId: strategy.sessionId,
      sourceKinds: strategy.sourceKinds,
    });
    if (retrievalBundle.citations.length > 0 && retrievalBundle.promptContext.trim()) {
      return {
        promptContext: retrievalBundle.promptContext,
        citations: retrievalBundle.citations,
      };
    }

    if (strategy.sourceKinds.includes('KnowledgeBaseDocument')) {
      const knowledgeReadyState = await dependencies.getKnowledgeReadyState();
      if (knowledgeReadyState === false) {
        console.info('[RAG] 聊天降级到普通模式: 当前没有 ready 状态的知识库文档');
        return undefined;
      }
    }

    if (strategy.sourceKinds.length === 1 && strategy.sourceKinds[0] === 'Message') {
      console.info('[RAG] 聊天降级到普通模式: 当前会话检索未返回可用上下文');
    } else {
      console.info('[RAG] 聊天降级到普通模式: retrieval 未返回可用上下文');
    }
    return undefined;
  } catch (error) {
    console.warn('[RAG] 聊天检索失败，继续走普通聊天链路:', error);
    return undefined;
  }
}
