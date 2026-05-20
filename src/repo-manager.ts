/**
 * Менеджер репозиториев - загрузка конфига, работа с БД, синхронизация
 */

import { Database } from 'bun:sqlite';
import type { RepoConfig, FilterRule } from './filter';
import { parsePackages, serializePackages, type PackageRecord } from './parser';
import { applyInclude, applyExclude, applyVersionKeep, resolveDependencies } from './filter';

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

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.config = new Map();
    this.initDb();
  }

  private initDb() {
    // Таблица репозиториев
    this.db.run(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        last_sync DATETIME,
        sync_status TEXT
      )
    `);

    // Таблица пакетов
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  }

  /**
   * Загрузить конфигурацию из JSON файла
   */
  async loadConfig(configPath: string) {
    const configData = Bun.file(configPath);
    const text = await configData.text();
    const config: Record<string, RepoConfig> = JSON.parse(text);
    
    for (const [repoId, repoConfig] of Object.entries(config)) {
      this.config.set(repoId, repoConfig);
      
      // Сохранить в БД
      this.db.run(
        'INSERT OR REPLACE INTO repos (id, config) VALUES (?, ?)',
        repoId,
        JSON.stringify(repoConfig)
      );
    }
    
    this.log('system', 'info', `Loaded ${this.config.size} repositories from config`);
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
      this.log(repoId, 'info', `Starting sync for ${repoId}`);
      
      // Скачать и распарсить Packages файлы
      const allPackages = await this.downloadPackages(config);
      this.log(repoId, 'info', `Downloaded ${allPackages.length} packages from upstream`);

      // Применить фильтры
      let filtered = allPackages;
      
      // 1. Include
      if (config.include && config.include.length > 0) {
        filtered = applyInclude(filtered, config.include);
        this.log(repoId, 'info', `After include: ${filtered.length} packages`);
      }
      
      // 2. Exclude
      if (config.exclude && config.exclude.length > 0) {
        const beforeCount = filtered.length;
        filtered = applyExclude(filtered, config.exclude);
        const excluded = beforeCount - filtered.length;
        if (excluded > 0) {
          this.log(repoId, 'info', `Excluded ${excluded} packages by rules`);
        }
      }
      
      // 3. Version keep
      const versionKeepRules = (config.include || []).filter(r => r['version-keep'] !== undefined);
      if (versionKeepRules.length > 0) {
        const beforeCount = filtered.length;
        filtered = applyVersionKeep(filtered, versionKeepRules);
        const removed = beforeCount - filtered.length;
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
      }

      // Сохранить в БД
      this.savePackages(repoId, resolved.packages);
      
      // Обновить кэш
      this.packageCache.set(repoId, resolved.packages);
      
      // Обновить статус в БД
      this.db.run(
        'UPDATE repos SET last_sync = ?, sync_status = ? WHERE id = ?',
        new Date().toISOString(),
        'success',
        repoId
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
        'failed',
        repoId
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
    }
  }

  /**
   * Скачать Packages файлы с upstream
   */
  private async downloadPackages(config: RepoConfig): Promise<PackageRecord[]> {
    const allPackages: PackageRecord[] = [];
    
    for (const component of config.components) {
      for (const arch of config.arch) {
        const baseUrl = config.upstream.replace(/\/$/, '');
        const dist = config.dist;
        
        // Попробовать сжатый и несжатый варианты
        const urls = [
          `${baseUrl}/dists/${dist}/${component}/binary-${arch}/Packages.gz`,
          `${baseUrl}/dists/${dist}/${component}/binary-${arch}/Packages`
        ];
        
        for (const url of urls) {
          try {
            const response = await fetch(url);
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
            allPackages.push(...packages);
            break; // Успешно скачали, перейти к следующему
          } catch (e) {
            // Попробовать следующий URL
            continue;
          }
        }
      }
    }
    
    return allPackages;
  }

  /**
   * Сохранить пакеты в БД
   */
  private savePackages(repoId: string, packages: PackageRecord[]) {
    // Очистить старые записи
    this.db.run('DELETE FROM packages WHERE repo_id = ?', repoId);
    
    const insertStmt = this.db.prepare(`
      INSERT INTO packages (repo_id, package_name, version, architecture, priority, section, depends, filename, size, sha256, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((pkgs: PackageRecord[]) => {
      for (const pkg of pkgs) {
        insertStmt.run(
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
          JSON.stringify(pkg)
        );
      }
    });
    
    insertMany(packages);
  }

  /**
   * Получить список пакетов репозитория
   */
  getPackages(repoId: string, nameFilter?: string): PackageRecord[] {
    let query = 'SELECT data FROM packages WHERE repo_id = ?';
    const params: any[] = [repoId];
    
    if (nameFilter) {
      query += ' AND package_name LIKE ?';
      params.push(`%${nameFilter}%`);
    }
    
    const rows = this.db.query(query).all(...params) as { data: string }[];
    return rows.map(row => JSON.parse(row.data));
  }

  /**
   * Получить информацию о репозитории
   */
  getRepoInfo(repoId: string): { config: RepoConfig | undefined; lastSync: string | null; status: string | null; packagesCount: number } {
    const config = this.config.get(repoId);
    
    const row = this.db.query('SELECT last_sync, sync_status FROM repos WHERE id = ?').get(repoId) as { last_sync: string; sync_status: string } | undefined;
    
    const countRow = this.db.query('SELECT COUNT(*) as count FROM packages WHERE repo_id = ?').get(repoId) as { count: number } | undefined;
    
    return {
      config,
      lastSync: row?.last_sync || null,
      status: row?.sync_status || null,
      packagesCount: countRow?.count || 0
    };
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
        repoId,
        level,
        message
      );
    } catch (e) {
      // Игнорировать ошибки логирования
    }
  }

  /**
   * Получить логи синхронизации
   */
  getSyncLogs(repoId: string, limit: number = 100): { timestamp: string; level: string; message: string }[] {
    const rows = this.db.query(`
      SELECT timestamp, level, message 
      FROM sync_logs 
      WHERE repo_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(repoId, limit) as { timestamp: string; level: string; message: string }[];
    
    return rows;
  }
}
