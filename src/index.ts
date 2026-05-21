/**
 * Main entry point for Debian Package Filter Proxy Server
 */

import { initApp, repoManager, createErrorResponse, parsePaginationParams } from './server';
import { serializePackages } from './parser';
import { validateRepoId, normalizePath, getConfigPath } from './utils/paths';
import { logger, getSuccessfulRequests, getFailedRequests } from './utils/logger';
import { getVersion } from './version';

// Конфигурация сервера
const port = parseInt(process.env.PORT || '8080');

// Чтение syncInterval из config.json или переменной окружения
let syncInterval: number;
try {
  const configPath = getConfigPath();
  const configText = await Bun.file(configPath).text();
  const config = JSON.parse(configText);
  if (config.syncInterval) {
    // Парсим строку формата "1h", "30m", "3600s" и т.д.
    const intervalStr = config.syncInterval;
    const match = intervalStr.match(/^(\d+)([hms])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      if (unit === 'h') syncInterval = value * 60 * 60 * 1000;
      else if (unit === 'm') syncInterval = value * 60 * 1000;
      else if (unit === 's') syncInterval = value * 1000;
      else syncInterval = parseInt(process.env.SYNC_INTERVAL || '1800000');
    } else {
      syncInterval = parseInt(process.env.SYNC_INTERVAL || '1800000');
    }
  } else {
    syncInterval = parseInt(process.env.SYNC_INTERVAL || '1800000');
  }
} catch (e) {
  // Если не удалось прочитать конфиг, используем переменную окружения
  syncInterval = parseInt(process.env.SYNC_INTERVAL || '1800000');
}

// Флаг для предотвращения гонки при периодической синхронизации
let syncInProgress = false;

// Запустить инициализацию при старте
initApp().catch((error) => {
  logger.error('Failed to initialize application', { error: error instanceof Error ? error.message : String(error) }, true);
});

// Интервал для периодической синхронизации
setInterval(async () => {
  if (syncInProgress) {
    logger.warn('Previous sync still in progress, skipping scheduled sync');
    return;
  }
  
  syncInProgress = true;
  try {
    logger.info('Running scheduled sync...');
    await initApp();
  } catch (error) {
    logger.error('Scheduled sync failed', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    syncInProgress = false;
  }
}, syncInterval);

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`, undefined, true);
  
  // Остановить сервер
  server.stop();
  
  // Закрыть соединение с БД
  if (repoManager.close) {
    repoManager.close();
  }
  
  logger.info('Graceful shutdown completed', undefined, true);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

logger.info(`Debian Package Filter Proxy Server ${getVersion()} starting...`, undefined, true);

const server = Bun.serve({
  port: port,
  
  async fetch(req, server) {
    const startTime = Date.now();
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    
    try {
      // GET /r/:repo/sync - принудительная синхронизация
      const syncMatch = path.match(/^\/r\/([^/]+)\/sync$/);
      if (syncMatch && method === 'GET') {
        const repoId = syncMatch[1];
        if (!repoId) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        // Валидация repoId
        if (!validateRepoId(repoId)) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        try {
          const result = await repoManager.syncRepo(repoId);
          const status = result.success ? 200 : 500;
          logger.http(method, path, status, Date.now() - startTime, { repoId });
          
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
            status
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Sync error', { repoId, error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime, { repoId });
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /r/:repo/packages/list - список пакетов с пагинацией (оптимальный JSON без форматирования)
      const packagesListMatch = path.match(/^\/r\/([^/]+)\/packages\/list$/);
      if (packagesListMatch && method === 'GET') {
        const repoId = packagesListMatch[1];
        if (!repoId) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        // Валидация repoId
        if (!validateRepoId(repoId)) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        const nameFilter = url.searchParams.get('name') || undefined;
        const { limit, offset } = parsePaginationParams(url);
        
        try {
          const allPackages = repoManager.getPackages(repoId, nameFilter);
          // Применить пагинацию
          const paginatedPackages = allPackages.slice(offset, offset + limit);
          
          const responseData = {
            packages: paginatedPackages,
            total: allPackages.length,
            limit,
            offset
          };
          
          logger.http(method, path, 200, Date.now() - startTime, { repoId, total: allPackages.length });
          
          // Отдаем JSON без форматирования для оптимальности
          return new Response(JSON.stringify(responseData), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Packages list error', { repoId, error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime, { repoId });
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /r/:repo/info - информация о репозитории
      const infoMatch = path.match(/^\/r\/([^/]+)\/info$/);
      if (infoMatch && method === 'GET') {
        const repoId = infoMatch[1];
        if (!repoId) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        // Валидация repoId
        if (!validateRepoId(repoId)) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        try {
          const info = repoManager.getRepoInfo(repoId);
          
          if (!info.config) {
            logger.http(method, path, 404, Date.now() - startTime, { repoId });
            return new Response(JSON.stringify({ error: 'Repository not found' }), {
              headers: { 'Content-Type': 'application/json' },
              status: 404
            });
          }
          
          logger.http(method, path, 200, Date.now() - startTime, { repoId });
          return new Response(JSON.stringify(info), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Repo info error', { repoId, error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime, { repoId });
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /r/:repo/logs - логи синхронизации
      const logsMatch = path.match(/^\/r\/([^/]+)\/logs$/);
      if (logsMatch && method === 'GET') {
        const repoId = logsMatch[1];
        if (!repoId) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        // Валидация repoId
        if (!validateRepoId(repoId)) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        try {
          const { limit } = parsePaginationParams(url);
          const logs = repoManager.getSyncLogs(repoId, limit);
          
          logger.http(method, path, 200, Date.now() - startTime, { repoId, logCount: logs.length });
          return new Response(JSON.stringify(logs), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Logs error', { repoId, error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime, { repoId });
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /r/:repo/dists/:dist/:component/binary-:arch/Packages(.gz)?
      const packagesMatch = path.match(/^\/r\/([^/]+)\/dists\/([^/]+)\/([^/]+)\/binary-([^/]+)\/Packages(\\.gz)?$/);
      if (packagesMatch && method === 'GET') {
        const [, repoId, dist, component, arch, isGzipped] = packagesMatch;
        if (!repoId || !arch) {
          const response = createErrorResponse('Invalid repository ID or architecture', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        // Валидация repoId
        if (!validateRepoId(repoId)) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        try {
          // Получить пакеты из БД
          const packages = repoManager.getPackages(repoId);
          
          // Отфильтровать по компоненту и архитектуре (упрощенно)
          const filteredPackages = packages.filter(pkg => {
            const pkgArch = pkg.Architecture || '';
            // В реальном сценарии нужно также фильтровать по компоненту
            return pkgArch === arch;
          });
          
          // Сериализовать в формат Packages
          const content = serializePackages(filteredPackages);
          
          if (isGzipped) {
            // Сжать gzip
            const uint8Array = new TextEncoder().encode(content);
            const compressed = Bun.gzipSync(uint8Array);
            
            logger.http(method, path, 200, Date.now() - startTime, { repoId, gzipped: true, packageCount: filteredPackages.length });
            return new Response(compressed, {
              headers: {
                'Content-Type': 'application/x-gzip',
                'Content-Encoding': 'gzip'
              }
            });
          } else {
            logger.http(method, path, 200, Date.now() - startTime, { repoId, packageCount: filteredPackages.length });
            return new Response(content, {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Packages error', { repoId, error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime, { repoId });
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /r/:repo/pool/... - редирект на upstream
      const poolMatch = path.match(/^\/r\/([^/]+)\/pool\/(.*)$/);
      if (poolMatch && method === 'GET') {
        const [, repoId, poolPath] = poolMatch;
        if (!repoId) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        // Валидация repoId
        if (!validateRepoId(repoId)) {
          const response = createErrorResponse('Invalid repository ID', 400);
          logger.http(method, path, 400, Date.now() - startTime);
          return response;
        }
        
        try {
          const config = repoManager.getRepoConfig(repoId);
          if (!config) {
            logger.http(method, path, 404, Date.now() - startTime, { repoId });
            return new Response('Repository not found', { status: 404 });
          }
          
          // Нормализовать poolPath для безопасности (защита от "..")
          const normalizedPoolPath = normalizePath(poolPath || '');
          
          // Построить URL на upstream
          const baseUrl = config.upstream.replace(/\/$/, '');
          const redirectUrl = `${baseUrl}/pool/${normalizedPoolPath}`;
          
          logger.http(method, path, 301, Date.now() - startTime, { repoId, redirectUrl });
          // Вернуть 301 Redirect
          return new Response(null, {
            status: 301,
            headers: {
              'Location': redirectUrl
            }
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Pool redirect error', { repoId, error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime, { repoId });
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /repos - список всех репозиториев
      if (path === '/repos' && method === 'GET') {
        try {
          const repoIds = repoManager.getAllRepoIds();
          const repos = repoIds.map(id => {
            const info = repoManager.getRepoInfo(id);
            return {
              id,
              ...info
            };
          });
          
          logger.http(method, path, 200, Date.now() - startTime, { repoCount: repoIds.length });
          return new Response(JSON.stringify(repos), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Repos list error', { error: errorMsg });
          logger.http(method, path, 500, Date.now() - startTime);
          return createErrorResponse(errorMsg, 500);
        }
      }
      
      // GET /health - проверка здоровья
      if (path === '/health' && method === 'GET') {
        logger.http(method, path, 200, Date.now() - startTime);
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // GET /metrics - метрики системы
      if (path === '/metrics' && method === 'GET') {
        const repoIds = repoManager.getAllRepoIds();
        const totalPackages = repoIds.reduce((sum, id) => {
          const info = repoManager.getRepoInfo(id);
          return sum + info.packagesCount;
        }, 0);
        
        const metrics = {
          packages: totalPackages,
          repositories: repoIds.length,
          uptime: process.uptime(),
          httpRequests: {
            successful: getSuccessfulRequests(),
            failed: getFailedRequests()
          },
          synchronization: repoManager.getAllReposSyncInfo()
        };
        
        logger.http(method, path, 200, Date.now() - startTime);
        return new Response(JSON.stringify(metrics), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 404 для остальных запросов
      logger.http(method, path, 404, Date.now() - startTime);
      return new Response('Not Found', { status: 404 });
    } catch (error) {
      // Глобальный обработчик ошибок
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Request error', { method, path, error: errorMsg });
      logger.http(method, path, 500, Date.now() - startTime);
      return createErrorResponse(errorMsg, 500);
    }
  }
});

logger.info(`Server running at http://localhost:${server.port}`);
