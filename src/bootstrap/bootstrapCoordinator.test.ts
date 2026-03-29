import { describe, expect, it, vi } from 'vitest';

import type { RuntimeConfigSnapshot } from './runtimeConfigSnapshot';
import { DEFAULT_CONFIG } from '../store/config';

function createSnapshot(
  autoReindexPolicy: 'manual' | 'changed_files' | 'on_startup',
): RuntimeConfigSnapshot {
  return {
    config: {
      ...DEFAULT_CONFIG,
      rag: {
        ...DEFAULT_CONFIG.rag,
        autoReindexPolicy,
      },
    },
    promptMode: 'assistant',
    compactModeEnabled: false,
    windowOpacity: 1,
    hoverRestoreEnabled: false,
    shortcutConfig: DEFAULT_CONFIG.shortcutConfig,
    windowBounds: {
      main: null,
      compact: null,
    },
    createdAt: 1,
  };
}

function mockBootstrapDependencies() {
  vi.doMock('../services/sessionManager', () => ({
    getLastActiveSession: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock('../services/windowManager', () => ({
    initWindowOpacity: vi.fn().mockResolvedValue(undefined),
    enableHoverRestore: vi.fn(),
    initCompactMode: vi.fn(),
    restoreWindowBounds: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../services/shortcutManager', () => ({
    initializeShortcuts: vi.fn().mockResolvedValue(undefined),
    setShortcutHandlers: vi.fn(),
  }));
  vi.doMock('../services/perf/perfInstrumentation', () => ({
    perfConfigLoaded: vi.fn(),
    perfSessionRestored: vi.fn(),
    perfShortcutsReady: vi.fn(),
    perfWindowBoundsRestored: vi.fn(),
  }));
  vi.doMock('../services/ragRuntimeConfig', () => ({
    ensureRagRuntimeConfigured: vi.fn().mockResolvedValue(true),
  }));
}

describe('recoverInterruptedKnowledgeIndexingOnStartup', () => {
  it('triggers recovery when startup policy is on_startup', async () => {
    vi.resetModules();
    mockBootstrapDependencies();
    vi.doMock('../services/ragService', () => ({
      ragService: {
        recoverStuckKnowledgeDocuments: vi.fn().mockResolvedValue([
          { fileName: 'stuck.md' },
        ]),
      },
    }));

    const { recoverInterruptedKnowledgeIndexingOnStartup } = await import('./bootstrapCoordinator');
    const recoveryService = {
      recoverStuckKnowledgeDocuments: vi.fn().mockResolvedValue([{ fileName: 'stuck.md' }]),
    };

    await recoverInterruptedKnowledgeIndexingOnStartup(
      createSnapshot('on_startup'),
      recoveryService,
    );

    expect(recoveryService.recoverStuckKnowledgeDocuments).toHaveBeenCalledOnce();
  });

  it('skips recovery when startup policy is not on_startup', async () => {
    vi.resetModules();
    mockBootstrapDependencies();
    vi.doMock('../services/ragService', () => ({
      ragService: {
        recoverStuckKnowledgeDocuments: vi.fn().mockResolvedValue([]),
      },
    }));

    const { recoverInterruptedKnowledgeIndexingOnStartup } = await import('./bootstrapCoordinator');
    const recoveryService = {
      recoverStuckKnowledgeDocuments: vi.fn().mockResolvedValue([]),
    };

    await recoverInterruptedKnowledgeIndexingOnStartup(
      createSnapshot('manual'),
      recoveryService,
    );

    expect(recoveryService.recoverStuckKnowledgeDocuments).not.toHaveBeenCalled();
  });
});
