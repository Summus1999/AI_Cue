// RAG 服务 - 前端与后端 RAG 功能的桥梁

import { invoke } from '@tauri-apps/api/core';

export interface SearchResult {
  knowledge_base_id: string | null;
  chunk_id: string;
  embedding_id: string | null;
  message_id: string | null;
  document_id: string | null;
  title: string;
  chunk_text: string;
  snippet: string;
  page_number: number | null;
  heading_path: string[];
  score: number;
  source: 'Vector' | 'Keyword' | 'Hybrid';
  source_kind: 'Message' | 'KnowledgeBaseDocument';
}

export interface CitationMetadata {
  index: number;
  knowledgeBaseId: string | null;
  documentId: string | null;
  chunkId: string;
  title: string;
  snippet: string;
  pageNumber: number | null;
  headingPath: string[];
  score: number;
  sourceKind: 'Message' | 'KnowledgeBaseDocument';
}

export interface RagContextBundle {
  promptContext: string;
  citations: CitationMetadata[];
}

export interface RagStats {
  total_embeddings: number;
  total_messages: number;
  storage_bytes: number;
  model_id: string | null;
}

export type EmbeddingProviderKind = 'qwen' | 'openai_compat';

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderKind;
  apiKey: string;
  baseUrl?: string | null;
  model?: string | null;
}

export type KnowledgeDocumentIndexState = 'pending' | 'indexing' | 'ready' | 'failed';
export type DocumentType = 'markdown' | 'pdf' | 'plain_text' | 'code';
export type BlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'code_symbol';
export type ChunkType = 'text' | 'qa_pair' | { code: { language?: string | null } };

export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string | null;
}

export interface KnowledgeBaseRecord {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeDocumentRecord {
  id: string;
  knowledgeBaseId: string;
  title: string;
  fileName: string;
  fileExtension: string | null;
  documentType: string;
  sourcePath: string;
  sourceByteSize: number;
  sourceModifiedAt: number;
  contentHash: string;
  fingerprint: string;
  indexState: KnowledgeDocumentIndexState;
  lastError: string | null;
  chunkCount: number;
  embeddingCount: number;
  createdAt: number;
  updatedAt: number;
  indexedAt: number | null;
}

export interface KnowledgeChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  chunkType: string;
  headingPath: string[];
  pageNumber: number | null;
  language: string | null;
  startOffset: number;
  endOffset: number;
  blockCount: number;
  createdAt: number;
}

export interface KnowledgeEmbeddingRecord {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  chunkId: string;
  embeddingDim: number;
  modelId: string;
  createdAt: number;
}

export interface ParseOptions {
  maxFileSizeBytes?: number;
  enableOcr?: boolean;
}

export interface ParsedBlock {
  index: number;
  blockKind: BlockKind;
  text: string;
  headingPath: string[];
  pageNumber: number | null;
  language: string | null;
  symbol: string | null;
  startOffset: number;
  endOffset: number;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface ParsedDocumentMetadata {
  sourcePath: string;
  fileName: string;
  extension: string | null;
  title: string;
  documentType: DocumentType;
  byteSize: number;
  language: string | null;
}

export interface ParsedDocument {
  metadata: ParsedDocumentMetadata;
  blocks: ParsedBlock[];
  totalChars: number;
  totalPages: number | null;
}

export interface ChunkConfig {
  maxChunkSize?: number;
  overlapSize?: number;
  minChunkSize?: number;
  preferStructureBoundary?: boolean;
}

export interface DocumentChunk {
  chunkIndex: number;
  text: string;
  chunkType: ChunkType;
  sourcePath: string;
  fileName: string;
  title: string;
  documentType: DocumentType;
  headingPath: string[];
  pageNumber: number | null;
  language: string | null;
  startOffset: number;
  endOffset: number;
  blockCount: number;
}

export interface KnowledgeBaseImportRequest {
  knowledgeBaseId: string;
  path: string;
  parseOptions?: ParseOptions;
  chunkConfig?: ChunkConfig;
}

export interface ReindexKnowledgeDocumentRequest {
  documentId: string;
  parseOptions?: ParseOptions;
  chunkConfig?: ChunkConfig;
}

export interface CompletedKnowledgeBaseImport {
  document: KnowledgeDocumentRecord;
  parsedDocument: ParsedDocument;
  chunks: DocumentChunk[];
  persistedChunks: KnowledgeChunkRecord[];
  persistedEmbeddings: KnowledgeEmbeddingRecord[];
}

export const ragService = {
  /**
   * 语义检索
   * @param query 搜索查询
   * @param limit 返回结果数量限制
   * @param sessionId 可选，按会话过滤
   */
  async search(query: string, limit = 10, sessionId?: string): Promise<SearchResult[]> {
    return invoke<SearchResult[]>('rag_search', { 
      query, 
      limit, 
      sessionId 
    });
  },
  
  /**
   * 获取 RAG 增强上下文
   * @param query 搜索查询
   * @param maxTokens 最大 token 数量
   */
  async getContext(query: string, maxTokens = 2000): Promise<string> {
    return invoke<string>('rag_get_context', { 
      query, 
      maxTokens 
    });
  },

  /**
   * 获取“prompt context + citations”组合结果
   * @param query 搜索查询
   * @param maxTokens 最大 token 数量
   * @param maxResults 最大引用条数
   * @param sessionId 可选，按会话过滤
   */
  async retrieveWithCitations(
    query: string,
    maxTokens = 2000,
    maxResults = 5,
    sessionId?: string,
  ): Promise<RagContextBundle> {
    return invoke<RagContextBundle>('rag_retrieve_with_citations', {
      query,
      maxTokens,
      maxResults,
      sessionId,
    });
  },
  
  /**
   * 手动触发消息向量化
   * @param messageId 消息 ID
   * @param content 消息内容
   */
  async embedMessage(messageId: string, content: string): Promise<boolean> {
    return invoke<boolean>('rag_embed_message', { 
      messageId, 
      content 
    });
  },

  /**
   * 解析文档
   * @param path 本地文件路径
   * @param options 解析配置
   */
  async parseDocument(path: string, options?: ParseOptions): Promise<ParsedDocument> {
    return invoke<ParsedDocument>('rag_parse_document', {
      path,
      options,
    });
  },

  /**
   * 解析并分块文档
   * @param path 本地文件路径
   * @param options 解析配置
   * @param config 分块配置
   */
  async chunkDocument(
    path: string,
    options?: ParseOptions,
    config?: ChunkConfig,
  ): Promise<DocumentChunk[]> {
    return invoke<DocumentChunk[]>('rag_chunk_document', {
      path,
      options,
      config,
    });
  },
  
  /**
   * 获取向量化统计信息
   */
  async getStats(): Promise<RagStats> {
    return invoke<RagStats>('rag_stats');
  },
  
  /**
   * 配置 RAG Embedding Provider
   * @param config Provider 运行时配置
   */
  async configure(config: EmbeddingProviderConfig): Promise<boolean> {
    return invoke<boolean>('rag_configure', { 
      config 
    });
  },
  
  /**
   * 删除消息的向量
   * @param messageId 消息 ID
   */
  async deleteVectors(messageId: string): Promise<void> {
    return invoke<void>('rag_delete_vectors', { messageId });
  },

  /**
   * 创建知识库
   * @param input 知识库创建参数
   */
  async createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseRecord> {
    return invoke<KnowledgeBaseRecord>('rag_create_knowledge_base', { input });
  },

  /**
   * 列出知识库
   */
  async listKnowledgeBases(): Promise<KnowledgeBaseRecord[]> {
    return invoke<KnowledgeBaseRecord[]>('rag_list_knowledge_bases');
  },

  /**
   * 删除知识库
   * @param knowledgeBaseId 知识库 ID
   */
  async deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    return invoke<void>('rag_delete_knowledge_base', { knowledgeBaseId });
  },

  /**
   * 列出知识库文档
   * @param knowledgeBaseId 知识库 ID
   */
  async listKnowledgeDocuments(knowledgeBaseId: string): Promise<KnowledgeDocumentRecord[]> {
    return invoke<KnowledgeDocumentRecord[]>('rag_list_knowledge_documents', { knowledgeBaseId });
  },

  /**
   * 获取单个知识库文档详情
   * @param documentId 文档 ID
   */
  async getKnowledgeDocument(documentId: string): Promise<KnowledgeDocumentRecord | null> {
    return invoke<KnowledgeDocumentRecord | null>('rag_get_knowledge_document', { documentId });
  },

  /**
   * 删除知识库文档
   * @param documentId 文档 ID
   */
  async deleteKnowledgeDocument(documentId: string): Promise<void> {
    return invoke<void>('rag_delete_knowledge_document', { documentId });
  },

  /**
   * 导入知识库文档
   * @param request 导入请求
   */
  async importKnowledgeDocument(
    request: KnowledgeBaseImportRequest,
  ): Promise<CompletedKnowledgeBaseImport> {
    return invoke<CompletedKnowledgeBaseImport>('rag_import_knowledge_document', { request });
  },

  /**
   * 重建单个知识库文档索引
   * @param request 重建索引请求
   */
  async reindexKnowledgeDocument(
    request: ReindexKnowledgeDocumentRequest,
  ): Promise<CompletedKnowledgeBaseImport> {
    return invoke<CompletedKnowledgeBaseImport>('rag_reindex_knowledge_document', { request });
  },
};

export default ragService;
