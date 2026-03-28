import { invoke } from '@tauri-apps/api/core';
import {
  AppConfig,
  loadConfig,
  RagEmbeddingProviderType,
} from '../store/config';

export interface RagRuntimeEmbeddingConfig {
  provider: RagEmbeddingProviderType;
  apiKey: string;
  baseUrl?: string | null;
  model?: string | null;
}

interface RagRuntimeSyncState {
  inFlight: Promise<boolean> | null;
  inFlightSignature: string | null;
  lastProcessedSignature: string | null;
  lastConfiguredSignature: string | null;
}

const syncState: RagRuntimeSyncState = {
  inFlight: null,
  inFlightSignature: null,
  lastProcessedSignature: null,
  lastConfiguredSignature: null,
};

function normalizeOptionalString(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildSyncSignature(
  provider: RagEmbeddingProviderType,
  config: RagRuntimeEmbeddingConfig | null,
): string {
  return JSON.stringify({
    provider,
    apiKey: config?.apiKey ?? '',
    baseUrl: config?.baseUrl ?? '',
    model: config?.model ?? '',
  });
}

function normalizeRuntimeConfig(
  config: RagRuntimeEmbeddingConfig,
): RagRuntimeEmbeddingConfig {
  return {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    baseUrl: normalizeOptionalString(config.baseUrl),
    model: normalizeOptionalString(config.model),
  };
}

export function buildRagRuntimeEmbeddingConfig(
  config: AppConfig,
): RagRuntimeEmbeddingConfig | null {
  const provider = config.rag.embeddingProvider;
  const providerConfig = config.providerConfigs[provider];
  const apiKey = providerConfig?.apiKey?.trim();

  if (!apiKey) {
    return null;
  }

  return {
    provider,
    apiKey,
    baseUrl: normalizeOptionalString(providerConfig.baseUrl),
    model: normalizeOptionalString(config.rag.embeddingModel),
  };
}

async function syncRuntimeConfig(
  provider: RagEmbeddingProviderType,
  config: RagRuntimeEmbeddingConfig | null,
  reason: string,
): Promise<boolean> {
  const signature = buildSyncSignature(provider, config);

  if (syncState.lastProcessedSignature === signature) {
    return syncState.lastConfiguredSignature === signature;
  }

  if (syncState.inFlight) {
    if (syncState.inFlightSignature === signature) {
      return syncState.inFlight;
    }

    await syncState.inFlight;

    if (syncState.lastProcessedSignature === signature) {
      return syncState.lastConfiguredSignature === signature;
    }
  }

  if (!config) {
    syncState.lastProcessedSignature = signature;
    syncState.lastConfiguredSignature = null;
    console.info(
      `[RAG] Skip runtime configure (${reason}): missing API key for ${provider}`,
    );
    return false;
  }

  const normalizedConfig = normalizeRuntimeConfig(config);
  const task = (async () => {
    await invoke<boolean>('rag_configure', {
      config: normalizedConfig,
    });

    syncState.lastProcessedSignature = signature;
    syncState.lastConfiguredSignature = signature;
    console.info(
      `[RAG] Runtime configured (${reason}): provider=${normalizedConfig.provider}, model=${normalizedConfig.model ?? '<default>'}`,
    );
    return true;
  })()
    .catch((error) => {
      syncState.lastProcessedSignature = null;
      syncState.lastConfiguredSignature = null;
      console.warn(`[RAG] Runtime configure failed (${reason}):`, error);
      return false;
    })
    .finally(() => {
      if (syncState.inFlight === task) {
        syncState.inFlight = null;
        syncState.inFlightSignature = null;
      }
    });

  syncState.inFlight = task;
  syncState.inFlightSignature = signature;

  return task;
}

export async function configureRagRuntime(
  config: RagRuntimeEmbeddingConfig,
  reason = 'manual',
): Promise<boolean> {
  return syncRuntimeConfig(config.provider, config, reason);
}

export async function ensureRagRuntimeConfigured(
  config?: AppConfig,
  reason = 'runtime',
): Promise<boolean> {
  const resolvedConfig = config ?? await loadConfig();
  const runtimeConfig = buildRagRuntimeEmbeddingConfig(resolvedConfig);

  return syncRuntimeConfig(
    resolvedConfig.rag.embeddingProvider,
    runtimeConfig,
    reason,
  );
}
