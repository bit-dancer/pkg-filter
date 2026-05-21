/**
 * HTTP сервер для Debian Package Filter Proxy
 * Модульная архитектура с разделением ответственности
 */

import { RepoManager } from './repo-manager';
import { serializePackages } from './parser';
import { getConfigPath, validateRepoId, normalizePath } from './utils/paths';
import { logger } from './utils/logger';

// Создание менеджера репозиториев (пути берутся из переменных окружения или конфигов)
const repoManager = new RepoManager();

/**
 * Инициализация приложения
 */
export async function initApp() {
  try {
    await repoManager.loadConfig();
    logger.info('Configuration loaded successfully', undefined, true);
  } catch (error) {
    logger.error('Failed to load config', { error: error instanceof Error ? error.message : String(error) }, true);
    throw error;
  }

  // Синхронизировать все репозитории при старте
  const repoIds = repoManager.getAllRepoIds();
  logger.info(`Starting initial sync for ${repoIds.length} repositories...`, undefined, true);
  
  for (const repoId of repoIds) {
    const result = await repoManager.syncRepo(repoId);
    if (result.success) {
      logger.info(`${repoId}: ${result.filteredCount} packages synced`);
    } else {
      logger.error(`${repoId}: ${result.error}`);
    }
  }
  
  logger.info('Initial sync completed', undefined, true);
}

/**
 * Обработчик ошибок HTTP запросов
 */
function createErrorResponse(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { 'Content-Type': 'application/json' },
    status
  });
}

/**
 * Парсер параметров пагинации
 */
function parsePaginationParams(url: URL): { limit: number; offset: number } {
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '100')), 1000);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
  return { limit, offset };
}

export { repoManager, createErrorResponse, parsePaginationParams };
