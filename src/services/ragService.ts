// RAG 服务 - 前端与后端 RAG 功能的桥梁

import { invoke } from '@tauri-apps/api/core';

export interface SearchResult {
  message_id: string;
  chunk_text: string;
  score: number;
  source: 'Vector' | 'Keyword' | 'Hybrid';
}

export interface RagStats {
  total_embeddings: number;
  total_messages: number;
  storage_bytes: number;
  model_id: string | null;
}

export type DocumentType = 'markdown' | 'pdf' | 'plain_text' | 'code';
export type BlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'code_symbol';
export type ChunkType = 'text' | 'qa_pair' | { code: { language?: string | null } };

export interface ParseOptions {
  maxFileSizeBytes?: number;
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
   * @param apiKey API Key
   * @param baseUrl 可选，自定义 API 地址
   */
  async configure(apiKey: string, baseUrl?: string): Promise<boolean> {
    return invoke<boolean>('rag_configure', { 
      apiKey, 
      baseUrl 
    });
  },
  
  /**
   * 删除消息的向量
   * @param messageId 消息 ID
   */
  async deleteVectors(messageId: string): Promise<void> {
    return invoke<void>('rag_delete_vectors', { messageId });
  }
};

export default ragService;
