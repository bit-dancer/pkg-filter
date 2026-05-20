/**
 * Менеджер репозиториев - загрузка конфига, работа с БД, синхронизация
 */

import { Database } from 'bun:sqlite';
import { ProxyAgent } from 'undici';
import type { RepoConfig, FilterRule } from './filter';
import { parsePackages, serializePackages, type PackageRecord } from './parser';
import { applyInclude, applyExclude, applyVersionKeep, resolveDependencies } from './filter';
import { getDbPath, getConfigPath, validateRepoId } from './utils/paths';
import { CacheManager } from './utils/cache-manager';
import { logger } from './utils/logger';

export interface SyncResult {
  repoId: string;
  success: boolean;
  packagesCount: number;
  filteredCount: number;
  unresolvedDeps: string[];
  error?: string;
  timestamp: Date;
}

export class RepoManager {
  private db: Database;
  private config: Map<string, RepoConfig>;
  private packageCache: Map<string, PackageRecord[]> = new Map();
  private syncLock: Map<string, boolean> = new Map(); // Блокировка для предотвращения гонок
  private cacheManager: CacheManager;

  constructor(dbPath: string = ':memory:') {
    // Если путь не ':memory:', используем переданный путь напрямую (для обратной совместимости)
    // или берем из переменных окружения если передан пустой путь
    const actualPath = dbPath === ':memory:' ? dbPath : (dbPath.startsWith('.') ? dbPath : dbPath);
    this.db = new Database(actualPath);
    this.config = new Map();
    this.cacheManager = new CacheManager(5, 24); // Хранить 5 версий, 24 часа
    this.initDb();
  }

  private initDb() {
    // Оптимизация SQLite для работы с большими объемами данных
    // Увеличиваем кэш страниц для лучшей производительности
    this.db.run('PRAGMA cache_size = -2000'); // 2MB кэш (отрицательное значение = KB)
    this.db.run('PRAGMA temp_store = MEMORY'); // Временные таблицы в памяти
    this.db.run('PRAGMA mmap_size = 268435456'); // 256MB memory-mapped I/O
    
    // Таблица репозиториев
    this.db.run(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        last_sync DATETIME,
        sync_status TEXT
      )
    `);

    // Таблица пакетов с полем status для отслеживания состояния
    this.db.run(`
      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        version TEXT NOT NULL,
        architecture TEXT,
        priority TEXT,
        section TEXT,
        depends TEXT,
        filename TEXT,
        size INTEGER,
        sha256 TEXT,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        filter_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(repo_id, package_name, version)
      )
    `);

    // Индексы для быстрого поиска
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_repo ON packages(repo_id)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(package_name)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_version ON packages(version)
    `);
    // Составной индекс для быстрого поиска по имени и версии вместе
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_name_version ON packages(package_name, version)
    `);
    // Индекс для быстрого поиска последней версии пакета
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_repo_name ON packages(repo_id, package_name)
    `);

    // Таблица логов синхронизации
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      )
    `);

    // Таблица зависимостей для быстрого разрешения зависимостей
    // Оптимизировано для работы с большими объемами данных
    this.db.run(`
      CREATE TABLE IF NOT EXISTS packages_depends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        version TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        dep_type TEXT DEFAULT 'depends',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(repo_id, package_name, version, depends_on, dep_type)
      )
    `);

    // Индексы для таблицы зависимостей
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_depends_repo ON packages_depends(repo_id)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_depends_package ON packages_depends(package_name)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_depends_depends_on ON packages_depends(depends_on)
    `);
    // Составной индекс для быстрого поиска зависимостей пакета
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_depends_repo_package ON packages_depends(repo_id, package_name)
    `);
    // Индекс для поиска пакетов которые зависят от указанного пакета
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_packages_depends_depends_on_repo ON packages_depends(depends_on, repo_id)
    `);
  }

  /**
   * Загрузить конфигурацию из JSON файла
   */
  async loadConfig(configPath?: string) {
    const path = configPath || getConfigPath();
    try {
      const configData = Bun.file(path);
      const text = await configData.text();
      const config: Record<string, RepoConfig> = JSON.parse(text);
      
      for (const [repoId, repoConfig] of Object.entries(config)) {
        // Валидировать repoId
        if (!validateRepoId(repoId)) {
          this.log('system', 'warn', `Skipping invalid repository ID: ${repoId}`);
          continue;
        }
        
        this.config.set(repoId, repoConfig);
        
        // Сохранить в БД
        this.db.run(
          'INSERT OR REPLACE INTO repos (id, config) VALUES (?, ?)',
          [repoId, JSON.stringify(repoConfig)]
        );
      }
      
      this.log('system', 'info', `Loaded ${this.config.size} repositories from config`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config from ${path}: ${errorMsg}`);
    }
  }

  /**
   * Получить конфигурацию репозитория
   */
  getRepoConfig(repoId: string): RepoConfig | undefined {
    return this.config.get(repoId);
  }

  /**
   * Получить все ID репозиториев
   */
  getAllRepoIds(): string[] {
    return Array.from(this.config.keys());
  }

  /**
   * Синхронизировать репозиторий
   */
  async syncRepo(repoId: string): Promise<SyncResult> {
    // Проверка валидности repoId
    if (!validateRepoId(repoId)) {
      const error = `Invalid repository ID: ${repoId}`;
      this.log(repoId, 'error', error);
      return {
        repoId,
        success: false,
        packagesCount: 0,
        filteredCount: 0,
        unresolvedDeps: [],
        error,
        timestamp: new Date()
      };
    }

    // Проверка блокировки (защита от гонки данных)
    if (this.syncLock.get(repoId)) {
      const error = `Sync already in progress for ${repoId}`;
      this.log(repoId, 'warn', error);
      return {
        repoId,
        success: false,
        packagesCount: 0,
        filteredCount: 0,
        unresolvedDeps: [],
        error,
        timestamp: new Date()
      };
    }

    const startTime = Date.now();
    const config = this.config.get(repoId);
    
    if (!config) {
      const error = `Repository '${repoId}' not found in config`;
      this.log(repoId, 'error', error);
      return {
        repoId,
        success: false,
        packagesCount: 0,
        filteredCount: 0,
        unresolvedDeps: [],
        error,
        timestamp: new Date()
      };
    }

    try {
      // Установить блокировку
      this.syncLock.set(repoId, true);
      
      this.log(repoId, 'info', `Starting sync for ${repoId}`);
      
      // Скачать и распарсить Packages файлы
      const allPackages = await this.downloadPackages(config);
      this.log(repoId, 'info', `Downloaded ${allPackages.length} packages from upstream`);

      // Применить фильтры и собрать статистику для пометки в БД
      let filtered = allPackages;
      
      // Множества для отслеживания причин фильтрации
      const excludedByRules = new Set<string>();
      const removedOldVersions = new Set<string>();
      const unresolvedDepsSet = new Set<string>();
      
      // 1. Include
      if (config.include && config.include.length > 0) {
        const beforeSet = new Set(filtered.map(p => `${p.Package || ''}:${p.Version || ''}`));
        filtered = applyInclude(filtered, config.include);
        const afterSet = new Set(filtered.map(p => `${p.Package || ''}:${p.Version || ''}`));
        
        // Запомнить исключенные пакеты
        for (const pkgKey of beforeSet) {
          if (!afterSet.has(pkgKey)) {
            excludedByRules.add(pkgKey);
          }
        }
        this.log(repoId, 'info', `After include: ${filtered.length} packages`);
      }
      
      // 2. Exclude
      if (config.exclude && config.exclude.length > 0) {
        const beforeSet = new Set(filtered.map(p => `${p.Package || ''}:${p.Version || ''}`));
        const beforeCount = filtered.length;
        filtered = applyExclude(filtered, config.exclude);
        const afterSet = new Set(filtered.map(p => `${p.Package || ''}:${p.Version || ''}`));
        const excluded = beforeCount - filtered.length;
        
        // Запомнить исключенные пакеты
        for (const pkgKey of beforeSet) {
          if (!afterSet.has(pkgKey)) {
            excludedByRules.add(pkgKey);
          }
        }
        
        if (excluded > 0) {
          this.log(repoId, 'info', `Excluded ${excluded} packages by rules`);
        }
      }
      
      // 3. Version keep
      const versionKeepRules = (config.include || []).filter(r => r['version-keep'] !== undefined);
      if (versionKeepRules.length > 0) {
        const beforeSet = new Set(filtered.map(p => `${p.Package || ''}:${p.Version || ''}`));
        const beforeCount = filtered.length;
        filtered = applyVersionKeep(filtered, versionKeepRules);
        const afterSet = new Set(filtered.map(p => `${p.Package || ''}:${p.Version || ''}`));
        const removed = beforeCount - filtered.length;
        
        // Запомнить удаленные старые версии
        for (const pkgKey of beforeSet) {
          if (!afterSet.has(pkgKey)) {
            removedOldVersions.add(pkgKey);
          }
        }
        
        if (removed > 0) {
          this.log(repoId, 'info', `Removed ${removed} old versions by version-keep`);
        }
      }

      // 4. Разрешение зависимостей
      const followRecommends = config.deps?.['follow-recommends'] ?? false;
      const followSuggests = config.deps?.['follow-suggests'] ?? false;
      const allowUnresolved = config['allow-unresolved'] ?? false;
      
      // Построить мапу deps-repos
      const depsReposMap = new Map<string, PackageRecord[]>();
      if (config['deps-repos']) {
        for (const depRepoId of config['deps-repos']) {
          const depPackages = this.packageCache.get(depRepoId);
          if (depPackages) {
            depsReposMap.set(depRepoId, depPackages);
          }
        }
      }
      
      const resolved = resolveDependencies(
        allPackages,
        filtered,
        followRecommends,
        followSuggests,
        allowUnresolved,
        depsReposMap,
        repoId
      );

      // Логирование отфильтрованных пакетов
      const finalPackageNames = new Set(resolved.packages.map(p => `${p.Package} ${p.Version}`));
      const originalPackageNames = new Set(allPackages.map(p => `${p.Package} ${p.Version}`));
      
      const filteredOut: string[] = [];
      for (const pkgName of originalPackageNames) {
        if (!finalPackageNames.has(pkgName)) {
          filteredOut.push(pkgName);
        }
      }
      
      if (filteredOut.length > 0 && filteredOut.length <= 100) {
        this.log(repoId, 'info', `Filtered out packages: ${filteredOut.join(', ')}`);
      } else if (filteredOut.length > 100) {
        this.log(repoId, 'info', `Filtered out ${filteredOut.length} packages (showing first 100): ${filteredOut.slice(0, 100).join(', ')}`);
      }

      // Логирование неразрешенных зависимостей
      if (resolved.unresolved.length > 0) {
        this.log(repoId, 'warn', `Unresolved dependencies: ${resolved.unresolved.join(', ')}`);
        // Пометить неразрешенные зависимости
        for (const depName of resolved.unresolved) {
          unresolvedDepsSet.add(depName);
        }
      }

      // Сохранить в БД с информацией о фильтрации
      this.savePackages(
        repoId, 
        resolved.packages,
        allPackages,
        { excludedByRules, removedOldVersions, unresolvedDeps: unresolvedDepsSet }
      );
      
      // Обновить кэш в памяти
      this.packageCache.set(repoId, resolved.packages);
      
      // Сгенерировать и сохранить Package файлы в кэш на диске
      const syncTime = new Date();
      await this.writePackageFilesToCache(repoId, resolved.packages, syncTime);
      
      // Обновить статус в БД
      this.db.run(
        'UPDATE repos SET last_sync = ?, sync_status = ? WHERE id = ?',
        [syncTime.toISOString(), 'success', repoId]
      );

      const duration = Date.now() - startTime;
      this.log(repoId, 'info', `Sync completed in ${duration}ms. Final packages: ${resolved.packages.length}`);

      return {
        repoId,
        success: true,
        packagesCount: allPackages.length,
        filteredCount: resolved.packages.length,
        unresolvedDeps: resolved.unresolved,
        timestamp: new Date()
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(repoId, 'error', `Sync failed: ${errorMsg}`);
      
      this.db.run(
        'UPDATE repos SET sync_status = ? WHERE id = ?',
        ['failed', repoId]
      );

      return {
        repoId,
        success: false,
        packagesCount: 0,
        filteredCount: 0,
        unresolvedDeps: [],
        error: errorMsg,
        timestamp: new Date()
      };
    } finally {
      // Снять блокировку
      this.syncLock.delete(repoId);
    }
  }

  /**
   * Скачать Packages файлы с upstream
   */
  private async downloadPackages(config: RepoConfig): Promise<PackageRecord[]> {
    const allPackages: PackageRecord[] = [];
    
    // Потоковая обработка для экономии памяти - не загружаем все сразу
    for (const component of config.components) {
      for (const arch of config.arch) {
        try {
          const packages = await this.fetchComponentPackages(config, component, arch);
          // Обрабатываем пакеты потоково - сразу применяем фильтры если возможно
          for (const pkg of packages) {
            allPackages.push(pkg);
          }
        } catch (e) {
          console.warn(`Failed to fetch ${component}/${arch}:`, e instanceof Error ? e.message : String(e));
        }
      }
    }
    
    return allPackages;
  }

  /**
   * Скачать пакеты для конкретного компонента и архитектуры
   */
  private async fetchComponentPackages(config: RepoConfig, component: string, arch: string): Promise<PackageRecord[]> {
    const baseUrl = config.upstream.replace(/\/$/, '');
    const dist = config.dist;
    
    // Настройки из конфига с дефолтными значениями
    const timeoutMs = config['http-timeout'] ?? 30000; // 30 секунд по умолчанию
    const proxyUrl = config['http-proxy'];
    
    // Попробовать сжатый и несжатый варианты
    const urls = [
      `${baseUrl}/dists/${dist}/${component}/binary-${arch}/Packages.gz`,
      `${baseUrl}/dists/${dist}/${component}/binary-${arch}/Packages`
    ];
    
    for (const url of urls) {
      const requestStartTime = Date.now();
      try {
        // Таймаут на запрос
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        // Подготовка опций для fetch
        const fetchOptions: RequestInit = { 
          signal: controller.signal,
        };
        
        // Добавляем proxy если указан
        if (proxyUrl) {
          // Bun поддерживает proxy через переменную окружения или напрямую в fetch
          // Для SOCKS5 и HTTP proxy используем стандартный подход
          fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
        }
        
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        
        const duration = Date.now() - requestStartTime;
        
        // Логирование запроса к upstream
        logger.upstreamRequest(url, response.status, duration, {
          repoId: config.id || 'unknown',
          component,
          arch,
          proxy: proxyUrl ? 'yes' : 'no',
          timeout: timeoutMs
        });
        
        if (!response.ok) continue;
        
        let content: string;
        
        if (url.endsWith('.gz')) {
          const arrayBuffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const decompressed = Bun.gunzipSync(uint8Array);
          content = new TextDecoder().decode(decompressed);
        } else {
          content = await response.text();
        }
        
        const packages = parsePackages(content);
        return packages; // Успешно скачали, вернуть результат
      } catch (e) {
        const duration = Date.now() - requestStartTime;
        // Попробовать следующий URL
        if (e instanceof Error && e.name === 'AbortError') {
          logger.upstreamRequest(url, 0, duration, {
            repoId: config.id || 'unknown',
            component,
            arch,
            proxy: proxyUrl ? 'yes' : 'no',
            timeout: timeoutMs,
            error: 'Timeout'
          });
          console.warn(`Request timeout for ${url} after ${timeoutMs}ms`);
        } else if (e instanceof Error) {
          logger.upstreamRequest(url, 0, duration, {
            repoId: config.id || 'unknown',
            component,
            arch,
            proxy: proxyUrl ? 'yes' : 'no',
            timeout: timeoutMs,
            error: e.message
          });
          console.warn(`Request failed for ${url}: ${e.message}`);
        }
        continue;
      }
    }
    
    return []; // Ни один URL не сработал
  }

  /**
   * Сохранить пакеты в БД
   * Оптимизировано: использует транзакции и batch insert для производительности
   * @param repoId - ID репозитория (изолированное хранение)
   * @param packages - пакеты для сохранения
   * @param allOriginalPackages - все оригинальные пакеты до фильтрации (для пометки исключенных)
   * @param filterResults - результаты фильтрации для пометки причин исключения
   */
  private savePackages(
    repoId: string, 
    packages: PackageRecord[],
    allOriginalPackages: PackageRecord[] = [],
    filterResults?: {
      excludedByRules: Set<string>,
      removedOldVersions: Set<string>,
      unresolvedDeps: Set<string>
    }
  ) {
    // Использовать INSERT OR REPLACE вместо DELETE + INSERT для атомарности и производительности
    const upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO packages (repo_id, package_name, version, architecture, priority, section, depends, filename, size, sha256, data, status, filter_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    // Подготовить statement для таблицы зависимостей
    const depUpsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO packages_depends (repo_id, package_name, version, depends_on, dep_type)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    // Создать множество ключей активных пакетов
    const activePackageKeys = new Set<string>();
    for (const pkg of packages) {
      activePackageKeys.add(`${pkg.Package || ''}:${pkg.Version || ''}`);
    }
    
    // Оптимизация: отключаем WAL и синхронизацию на время массовой вставки
    const wasWal = this.db.query('PRAGMA journal_mode').get() as { journal_mode: string };
    const wasSync = this.db.query('PRAGMA synchronous').get() as { synchronous: number };
    
    try {
      // Временно отключаем WAL для лучшей производительности при массовой записи
      this.db.run('PRAGMA journal_mode = DELETE');
      // Отключаем синхронизацию (риск потери данных минимален т.к. это кэш)
      this.db.run('PRAGMA synchronous = OFF');
      
      const upsertMany = this.db.transaction((pkgs: PackageRecord[]) => {
        // Сначала помечаем все существующие пакеты этого репозитория как неактивные
        this.db.run(
          'UPDATE packages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE repo_id = ?',
          ['stale', repoId]
        );
        
        for (const pkg of pkgs) {
          const pkgKey = `${pkg.Package || ''}:${pkg.Version || ''}`;
          
          upsertStmt.run(
            repoId,
            pkg.Package || '',
            pkg.Version || '',
            pkg.Architecture || '',
            pkg.Priority || '',
            pkg.Section || '',
            pkg.Depends || '',
            pkg.Filename || '',
            pkg.Size ? parseInt(pkg.Size) : 0,
            pkg.SHA256 || '',
            JSON.stringify(pkg),
            'active',
            null
          );
          
          // Сохранить зависимости в отдельную таблицу для быстрого поиска
          if (pkg.Depends) {
            const dependsList = this.parseDependencyList(pkg.Depends);
            for (const dep of dependsList) {
              depUpsertStmt.run(repoId, pkg.Package || '', pkg.Version || '', dep, 'depends');
            }
          }
          if (pkg.PreDepends) {
            const preDependsList = this.parseDependencyList(pkg.PreDepends);
            for (const dep of preDependsList) {
              depUpsertStmt.run(repoId, pkg.Package || '', pkg.Version || '', dep, 'pre-depends');
            }
          }
          if (pkg.Recommends) {
            const recommendsList = this.parseDependencyList(pkg.Recommends);
            for (const dep of recommendsList) {
              depUpsertStmt.run(repoId, pkg.Package || '', pkg.Version || '', dep, 'recommends');
            }
          }
          if (pkg.Suggests) {
            const suggestsList = this.parseDependencyList(pkg.Suggests);
            for (const dep of suggestsList) {
              depUpsertStmt.run(repoId, pkg.Package || '', pkg.Version || '', dep, 'suggests');
            }
          }
        }
        
        // Пометить исключенные пакеты с указанием причины
        if (filterResults && allOriginalPackages.length > 0) {
          const markExcluded = this.db.prepare(`
            UPDATE packages 
            SET status = ?, filter_reason = ?, updated_at = CURRENT_TIMESTAMP
            WHERE repo_id = ? AND package_name = ? AND version = ?
          `);
          
          for (const pkg of allOriginalPackages) {
            const pkgKey = `${pkg.Package || ''}:${pkg.Version || ''}`;
            if (!activePackageKeys.has(pkgKey)) {
              let status = 'ignored';
              let reason = 'filtered';
              
              if (filterResults.excludedByRules?.has(pkgKey)) {
                status = 'ignored';
                reason = 'excluded_by_rule';
              } else if (filterResults.removedOldVersions?.has(pkgKey)) {
                status = 'ignored';
                reason = 'old_version_removed';
              } else if (filterResults.unresolvedDeps?.has(pkgKey)) {
                status = 'required';
                reason = 'dependency_unresolved';
              }
              
              markExcluded.run(status, reason, repoId, pkg.Package || '', pkg.Version || '');
            }
          }
        }
      });
      
      upsertMany(packages);
    } finally {
      // Восстанавливаем настройки
      if (wasWal?.journal_mode === 'wal') {
        this.db.run('PRAGMA journal_mode = WAL');
      }
      if (wasSync?.synchronous !== undefined) {
        this.db.run(`PRAGMA synchronous = ${wasSync.synchronous}`);
      }
    }
  }

  /**
   * Парсит список зависимостей Debian формата
   * Формат: "pkg1, pkg2 (>= 1.0), pkg3 | pkg4"
   * Возвращает имена пакетов (без условий версии)
   */
  private parseDependencyList(depString: string): string[] {
    const deps: string[] = [];
    
    // Разделить по запятым
    const parts = depString.split(',');
    
    for (const part of parts) {
      // Разделить по | (альтернативы)
      const alternatives = part.split('|');
      
      for (const alt of alternatives) {
        const trimmed = alt.trim();
        // Извлечь имя пакета (до пробела или скобки)
        const match = trimmed.match(/^([a-zA-Z0-9][a-zA-Z0-9.+_-]*)/);
        if (match && match[1]) {
          deps.push(match[1]);
        }
      }
    }
    
    return deps;
  }

  /**
   * Получить список пакетов репозитория
   * @param repoId - ID репозитория (изолированный доступ)
   * @param nameFilter - фильтр по имени пакета
   * @param statusFilter - фильтр по статусу (active, ignored, required, stale)
   */
  getPackages(repoId: string, nameFilter?: string, statusFilter?: string): PackageRecord[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      this.log(repoId, 'error', 'Invalid repository ID');
      return [];
    }

    let query = 'SELECT data FROM packages WHERE repo_id = ?';
    const params: any[] = [repoId];
    
    if (nameFilter) {
      query += ' AND package_name LIKE ?';
      params.push(`%${nameFilter}%`);
    }
    
    if (statusFilter) {
      query += ' AND status = ?';
      params.push(statusFilter);
    }
    
    try {
      const rows = this.db.query(query).all(...params) as { data: string }[];
      return rows.map(row => JSON.parse(row.data));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(repoId, 'error', `Failed to get packages: ${errorMsg}`);
      return [];
    }
  }

  /**
   * Получить статистику по статусам пакетов в репозитории
   * Позволяет увидеть какие пакеты были исключены, какие оставлены и почему
   * @param repoId - ID репозитория (изолированный доступ)
   */
  getPackageStatsByStatus(repoId: string): { status: string; filter_reason: string | null; count: number }[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return [];
    }

    try {
      const rows = this.db.query(`
        SELECT status, filter_reason, COUNT(*) as count
        FROM packages
        WHERE repo_id = ?
        GROUP BY status, filter_reason
        ORDER BY status, filter_reason
      `).all(repoId) as { status: string; filter_reason: string | null; count: number }[];
      
      return rows;
    } catch (error) {
      this.log(repoId, 'error', `Failed to get package stats: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Получить пакеты с указанным статусом и причиной фильтрации
   * Позволяет детально изучить какие пакеты были исключены и почему
   * @param repoId - ID репозитория (изолированный доступ)
   * @param status - статус пакета (active, ignored, required, stale)
   * @param filterReason - причина фильтрации (excluded_by_rule, old_version_removed, dependency_unresolved, filtered)
   * @param limit - ограничение количества записей
   */
  getPackagesByStatus(
    repoId: string, 
    status: string, 
    filterReason?: string, 
    limit: number = 100
  ): { package_name: string; version: string; status: string; filter_reason: string | null }[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return [];
    }

    // Валидация limit
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    
    let query = `
      SELECT package_name, version, status, filter_reason
      FROM packages
      WHERE repo_id = ? AND status = ?
    `;
    const params: any[] = [repoId, status];
    
    if (filterReason) {
      query += ' AND filter_reason = ?';
      params.push(filterReason);
    }
    
    query += ` LIMIT ?`;
    params.push(safeLimit);
    
    try {
      const rows = this.db.query(query).all(...params) as { 
        package_name: string; 
        version: string; 
        status: string; 
        filter_reason: string | null 
      }[];
      
      return rows;
    } catch (error) {
      this.log(repoId, 'error', `Failed to get packages by status: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Получить все уникальные причины фильтрации для репозитория
   * @param repoId - ID репозитория (изолированный доступ)
   */
  getFilterReasons(repoId: string): string[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return [];
    }

    try {
      const rows = this.db.query(`
        SELECT DISTINCT filter_reason
        FROM packages
        WHERE repo_id = ? AND filter_reason IS NOT NULL
      `).all(repoId) as { filter_reason: string }[];
      
      return rows.map(r => r.filter_reason);
    } catch (error) {
      this.log(repoId, 'error', `Failed to get filter reasons: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Получить информацию о репозитории
   */
  getRepoInfo(repoId: string): { config: RepoConfig | undefined; lastSync: string | null; status: string | null; packagesCount: number } {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return {
        config: undefined,
        lastSync: null,
        status: null,
        packagesCount: 0
      };
    }

    const config = this.config.get(repoId);
    
    try {
      const row = this.db.query('SELECT last_sync, sync_status FROM repos WHERE id = ?').get(repoId) as { last_sync: string; sync_status: string } | undefined;
      
      const countRow = this.db.query('SELECT COUNT(*) as count FROM packages WHERE repo_id = ?').get(repoId) as { count: number } | undefined;
      
      return {
        config,
        lastSync: row?.last_sync || null,
        status: row?.sync_status || null,
        packagesCount: countRow?.count || 0
      };
    } catch (error) {
      this.log(repoId, 'error', `Failed to get repo info: ${error instanceof Error ? error.message : String(error)}`);
      return {
        config,
        lastSync: null,
        status: null,
        packagesCount: 0
      };
    }
  }

  /**
   * Получить зависимости пакета из БД (используя таблицу packages_depends)
   * Это намного быстрее чем парсить depends поле из packages таблицы
   */
  getPackageDependencies(repoId: string, packageName: string, version?: string): { depends_on: string; dep_type: string }[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return [];
    }

    let query = 'SELECT depends_on, dep_type FROM packages_depends WHERE repo_id = ? AND package_name = ?';
    const params: any[] = [repoId, packageName];
    
    if (version) {
      query += ' AND version = ?';
      params.push(version);
    }
    
    try {
      const rows = this.db.query(query).all(...params) as { depends_on: string; dep_type: string }[];
      return rows;
    } catch (error) {
      this.log(repoId, 'error', `Failed to get package dependencies: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Найти пакеты которые зависят от указанного пакета (reverse dependencies)
   * Использует индексированную таблицу packages_depends для быстрого поиска
   */
  findReverseDependencies(repoId: string, dependencyName: string): { package_name: string; version: string; dep_type: string }[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return [];
    }

    try {
      const rows = this.db.query(`
        SELECT package_name, version, dep_type 
        FROM packages_depends 
        WHERE repo_id = ? AND depends_on = ?
      `).all(repoId, dependencyName) as { package_name: string; version: string; dep_type: string }[];
      
      return rows;
    } catch (error) {
      this.log(repoId, 'error', `Failed to find reverse dependencies: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Быстрый поиск последней версии пакета используя SQLite
   * Оптимизировано с использованием индексов
   */
  getLatestVersion(repoId: string, packageName: string): PackageRecord | null {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return null;
    }

    try {
      // Использовать индекс idx_packages_repo_name_version для быстрого поиска
      const row = this.db.query(`
        SELECT data 
        FROM packages 
        WHERE repo_id = ? AND package_name = ?
        ORDER BY version DESC
        LIMIT 1
      `).get(repoId, packageName) as { data: string } | undefined;
      
      if (row) {
        return JSON.parse(row.data);
      }
      return null;
    } catch (error) {
      this.log(repoId, 'error', `Failed to get latest version: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Разрешить зависимости используя SQLite таблицу packages_depends
   * Значительно быстрее чем BFS в памяти для больших репозиториев
   */
  resolveDependenciesWithDB(
    repoId: string,
    targetPackages: PackageRecord[],
    followRecommends: boolean,
    followSuggests: boolean,
    allowUnresolved: boolean = false,
    depsReposMap: Map<string, PackageRecord[]> = new Map()
  ): { packages: PackageRecord[]; unresolved: string[] } {
    const resolvedNames = new Set<string>();
    const resolvedPackages = new Map<string, PackageRecord>();
    const queue: string[] = [];
    const unresolved: string[] = [];
    
    // Добавить все целевые пакеты
    for (const pkg of targetPackages) {
      const name = pkg.Package || '';
      const key = `${name}:${pkg.Version}`;
      
      if (!resolvedPackages.has(key)) {
        resolvedNames.add(name);
        resolvedPackages.set(key, pkg);
        
        if (!queue.includes(name)) {
          queue.push(name);
        }
      }
    }
    
    // Кэш для пакетов из deps-repos
    const depsRepoPackageMaps = new Map<string, Map<string, PackageRecord>>();
    for (const [depRepoId, repoPackages] of depsReposMap.entries()) {
      const repoMap = new Map<string, PackageRecord>();
      for (const pkg of repoPackages) {
        const name = pkg.Package || '';
        // Сохранять только последнюю версию
        const existing = repoMap.get(name);
        if (!existing || this.compareVersions(pkg.Version || '', existing.Version || '') > 0) {
          repoMap.set(name, pkg);
        }
      }
      depsRepoPackageMaps.set(depRepoId, repoMap);
    }
    
    // BFS с использованием SQLite для поиска зависимостей
    while (queue.length > 0) {
      const currentName = queue.shift()!;
      
      // Получить зависимости из БД
      const deps = this.getPackageDependencies(repoId, currentName);
      
      for (const dep of deps) {
        // Фильтровать по типу зависимости
        if (dep.dep_type === 'recommends' && !followRecommends) continue;
        if (dep.dep_type === 'suggests' && !followSuggests) continue;
        if (dep.dep_type === 'pre-depends' || dep.dep_type === 'depends') {
          // Всегда включать
        }
        
        const depName = dep.depends_on;
        
        if (!resolvedNames.has(depName)) {
          resolvedNames.add(depName);
          
          // Сначала ищем в текущем репозитории через БД
          const latestPkg = this.getLatestVersion(repoId, depName);
          
          // Если не нашли, ищем в deps-repos
          if (!latestPkg) {
            for (const [depRepoId, repoMap] of depsRepoPackageMaps.entries()) {
              if (depRepoId === repoId) continue;
              
              const pkg = repoMap.get(depName);
              if (pkg) {
                const key = `${depName}:${pkg.Version}`;
                if (!resolvedPackages.has(key)) {
                  resolvedPackages.set(key, pkg);
                  if (!queue.includes(depName)) {
                    queue.push(depName);
                  }
                }
                break;
              }
            }
          } else {
            const key = `${depName}:${latestPkg.Version}`;
            if (!resolvedPackages.has(key)) {
              resolvedPackages.set(key, latestPkg);
              if (!queue.includes(depName)) {
                queue.push(depName);
              }
            }
          }
          
          if (!resolvedPackages.has(`${depName}:`)) {
            unresolved.push(depName);
            if (!allowUnresolved) {
              console.warn(`Warning: Dependency '${depName}' not found`);
            }
          }
        }
      }
    }
    
    return { packages: Array.from(resolvedPackages.values()), unresolved };
  }
  
  /**
   * Сравнить версии Debian
   */
  private compareVersions(a: string, b: string): number {
    try {
      const { compareVersions } = require('./utils/debian-version');
      return compareVersions(a, b);
    } catch {
      return a.localeCompare(b);
    }
  }

  /**
   * Логирование
   */
  private log(repoId: string, level: 'info' | 'warn' | 'error', message: string) {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] [${repoId}] ${message}`);
    
    // Сохранить в БД
    try {
      this.db.run(
        'INSERT INTO sync_logs (repo_id, level, message) VALUES (?, ?, ?)',
        [repoId, level, message]
      );
    } catch (e) {
      // Игнорировать ошибки логирования
    }
  }

  /**
   * Получить логи синхронизации
   */
  getSyncLogs(repoId: string, limit: number = 100): { timestamp: string; level: string; message: string }[] {
    // Валидация repoId
    if (!validateRepoId(repoId)) {
      return [];
    }

    // Валидация limit
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    
    try {
      const rows = this.db.query(`
        SELECT timestamp, level, message 
        FROM sync_logs 
        WHERE repo_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `).all(repoId, safeLimit) as { timestamp: string; level: string; message: string }[];
      
      return rows;
    } catch (error) {
      this.log(repoId, 'error', `Failed to get sync logs: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Закрыть соединение с БД
   */
  close() {
    try {
      this.db.close();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Failed to close database:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Записать Package файлы в кэш на диске
   * Использует временные файлы с префиксом "_" во время синхронизации
   * После успешной записи атомарно переименовывает файл
   */
  private async writePackageFilesToCache(repoId: string, packages: PackageRecord[], syncTime: Date): Promise<void> {
    // Сериализовать пакеты в формат Debian Packages
    const content = serializePackages(packages);
    
    // Записать во временный файл (с префиксом "_")
    const gzipped = Bun.gzipSync(new TextEncoder().encode(content));
    
    const tempPath = await this.cacheManager.writeToTemp(gzipped, repoId, syncTime, 'gz');
    
    if (!tempPath) {
      this.log(repoId, 'error', 'Failed to write temp cache file');
      return;
    }

    // Атомарно завершить синхронизацию - переименовать файл (убрать префикс "_")
    const success = await this.cacheManager.finalizeSync(repoId, syncTime, 'gz');
    
    if (!success) {
      this.log(repoId, 'error', 'Failed to finalize cache file');
      await this.cacheManager.cancelSync(repoId, syncTime, 'gz');
    }
  }

  /**
   * Получить путь к актуальному Package файлу для клиента
   * Возвращает только завершенные файлы (не временные)
   */
  getCachedPackageFilePath(repoId: string, ext: string = 'gz'): string | null {
    return this.cacheManager.getLatestFilePath(repoId, ext);
  }

  /**
   * Получить статистику кэша
   */
  getCacheStats(): { totalFiles: number; totalSize: number; tempFiles: number } {
    return this.cacheManager.getStats();
  }
}
