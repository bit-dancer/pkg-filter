/**
 * HTTP сервер для Debian Package Filter Proxy
 */

import { RepoManager } from './repo-manager';
import { serializePackages } from './parser';
import { createHash } from 'crypto';

const repoManager = new RepoManager('./data/packages.db');

// Загрузить конфигурацию при старте
async function initApp() {
  try {
    await repoManager.loadConfig('./config.json');
    console.log('Configuration loaded successfully');
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  // Синхронизировать все репозитории при старте
  const repoIds = repoManager.getAllRepoIds();
  console.log(`Starting initial sync for ${repoIds.length} repositories...`);
  
  for (const repoId of repoIds) {
    const result = await repoManager.syncRepo(repoId);
    if (result.success) {
      console.log(`✓ ${repoId}: ${result.filteredCount} packages synced`);
    } else {
      console.error(`✗ ${repoId}: ${result.error}`);
    }
  }
  
  console.log('Initial sync completed');
}

// Запустить инициализацию при старте
initApp().catch(console.error);

// Интервал для периодической синхронизации (30 минут)
const SYNC_INTERVAL = 30 * 60 * 1000;
setInterval(() => {
  console.log('Running scheduled sync...');
  initApp().catch(console.error);
}, SYNC_INTERVAL);

const server = Bun.serve({
  port: process.env.PORT || 8080,
  
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    
    // GET /r/:repo/sync - принудительная синхронизация
    const syncMatch = path.match(/^\/r\/([^/]+)\/sync$/);
    if (syncMatch && req.method === 'GET') {
      const repoId = syncMatch[1];
      const result = await repoManager.syncRepo(repoId);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
        status: result.success ? 200 : 500
      });
    }
    
    // GET /r/:repo/packages/list - список пакетов
    const packagesListMatch = path.match(/^\/r\/([^/]+)\/packages\/list$/);
    if (packagesListMatch && req.method === 'GET') {
      const repoId = packagesListMatch[1];
      const nameFilter = url.searchParams.get('name') || undefined;
      
      const packages = repoManager.getPackages(repoId, nameFilter);
      
      return new Response(JSON.stringify(packages, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // GET /r/:repo/info - информация о репозитории
    const infoMatch = path.match(/^\/r\/([^/]+)\/info$/);
    if (infoMatch && req.method === 'GET') {
      const repoId = infoMatch[1];
      const info = repoManager.getRepoInfo(repoId);
      
      if (!info.config) {
        return new Response(JSON.stringify({ error: 'Repository not found' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 404
        });
      }
      
      return new Response(JSON.stringify(info), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // GET /r/:repo/logs - логи синхронизации
    const logsMatch = path.match(/^\/r\/([^/]+)\/logs$/);
    if (logsMatch && req.method === 'GET') {
      const repoId = logsMatch[1];
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const logs = repoManager.getSyncLogs(repoId, limit);
      
      return new Response(JSON.stringify(logs, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // GET /r/:repo/dists/:dist/:component/binary-:arch/Packages(.gz)?
    const packagesMatch = path.match(/^\/r\/([^/]+)\/dists\/([^/]+)\/([^/]+)\/binary-([^/]+)\/Packages(\.gz)?$/);
    if (packagesMatch && req.method === 'GET') {
      const [, repoId, dist, component, arch, isGzipped] = packagesMatch;
      
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
        
        return new Response(compressed, {
          headers: {
            'Content-Type': 'application/x-gzip',
            'Content-Encoding': 'gzip'
          }
        });
      } else {
        return new Response(content, {
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }
    
    // GET /r/:repo/pool/... - редирект на upstream
    const poolMatch = path.match(/^\/r\/([^/]+)\/pool\/(.*)$/);
    if (poolMatch && req.method === 'GET') {
      const [, repoId, poolPath] = poolMatch;
      
      const config = repoManager.getRepoConfig(repoId);
      if (!config) {
        return new Response('Repository not found', { status: 404 });
      }
      
      // Построить URL на upstream
      const baseUrl = config.upstream.replace(/\/$/, '');
      const redirectUrl = `${baseUrl}/pool/${poolPath}`;
      
      // Вернуть 301 Redirect
      return new Response(null, {
        status: 301,
        headers: {
          'Location': redirectUrl
        }
      });
    }
    
    // GET /repos - список всех репозиториев
    if (path === '/repos' && req.method === 'GET') {
      const repoIds = repoManager.getAllRepoIds();
      const repos = repoIds.map(id => {
        const info = repoManager.getRepoInfo(id);
        return {
          id,
          ...info
        };
      });
      
      return new Response(JSON.stringify(repos, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // GET /health - проверка здоровья
    if (path === '/health' && req.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 404 для остальных запросов
    return new Response('Not Found', { status: 404 });
  }
});

console.log(`Server running at http://localhost:${server.port}`);
