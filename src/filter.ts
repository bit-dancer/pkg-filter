/**
 * Фильтры для пакетов на основе конфигурации
 */

import type { PackageRecord } from './parser';
import { compareVersions } from './utils/debian-version';

export interface FilterRule {
  name?: string;
  version?: string;
  priority?: string[];
  'version-keep'?: number;
}

export interface RepoConfig {
  upstream: string;
  dist: string;
  components: string[];
  arch: string[];
  packages?: string[];
  include?: FilterRule[];
  exclude?: FilterRule[];
  deps?: {
    'follow-recommends': boolean;
    'follow-suggests': boolean;
  };
  'verify-checksums'?: boolean;
  'allow-unresolved'?: boolean;
  'deps-repos'?: string[];
}

/**
 * Проверяет, соответствует ли пакет правилу фильтрации
 */
function matchesRule(pkg: PackageRecord, rule: FilterRule): boolean {
  // Проверка по имени (RegExp или точное совпадение)
  if (rule.name !== undefined) {
    const pkgName = pkg.Package || '';
    let matches = false;
    
    if (rule.name.startsWith('^') || rule.name.includes('.*') || rule.name.includes('.+')) {
      // RegExp
      const regex = new RegExp(rule.name);
      matches = regex.test(pkgName);
    } else {
      // Точное совпадение
      matches = pkgName === rule.name;
    }
    
    if (!matches) return false;
  }
  
  // Проверка по версии (RegExp или точное совпадение)
  if (rule.version !== undefined) {
    const pkgVersion = pkg.Version || '';
    let matches = false;
    
    if (rule.version.startsWith('r|')) {
      // Явный RegExp (формат "r|...")
      const regexStr = rule.version.substring(2);
      const regex = new RegExp(regexStr);
      matches = regex.test(pkgVersion);
    } else if (rule.version.startsWith('^') || rule.version.includes('.*') || rule.version.includes('.+')) {
      // RegExp
      const regex = new RegExp(rule.version);
      matches = regex.test(pkgVersion);
    } else {
      // Точное совпадение
      matches = pkgVersion === rule.version;
    }
    
    if (!matches) return false;
  }
  
  // Проверка по приоритету
  if (rule.priority !== undefined && rule.priority.length > 0) {
    const pkgPriority = pkg.Priority || '';
    if (!rule.priority.includes(pkgPriority)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Применяет правила include к списку пакетов
 * Возвращает пакеты, которые соответствуют хотя бы одному правилу include
 * Если rules пустой - возвращает все пакеты
 */
export function applyInclude(packages: PackageRecord[], rules: FilterRule[] = []): PackageRecord[] {
  if (rules.length === 0) {
    return packages;
  }
  
  return packages.filter(pkg => {
    return rules.some(rule => matchesRule(pkg, rule));
  });
}

/**
 * Применяет правила exclude к списку пакетов
 * Возвращает пакеты, которые НЕ соответствуют ни одному правилу exclude
 */
export function applyExclude(packages: PackageRecord[], rules: FilterRule[] = []): PackageRecord[] {
  if (rules.length === 0) {
    return packages;
  }
  
  return packages.filter(pkg => {
    // Пакет остается, если он НЕ соответствует НИ ОДНОМУ правилу exclude
    return !rules.some(rule => matchesRule(pkg, rule));
  });
}

/**
 * Применяет ограничение на количество версий (version-keep)
 * Для каждого уникального имени пакета оставляет только N последних версий
 */
export function applyVersionKeep(packages: PackageRecord[], rules: FilterRule[]): PackageRecord[] {
  // Сгруппировать правила version-keep по имени пакета
  const versionKeepRules = new Map<string, number>();
  
  for (const rule of rules) {
    if (rule['version-keep'] !== undefined && rule.name !== undefined) {
      versionKeepRules.set(rule.name, rule['version-keep']);
    }
  }
  
  if (versionKeepRules.size === 0) {
    return packages;
  }
  
  // Сгруппировать пакеты по имени
  const packagesByName = new Map<string, PackageRecord[]>();
  
  for (const pkg of packages) {
    const name = pkg.Package || '';
    if (!packagesByName.has(name)) {
      packagesByName.set(name, []);
    }
    packagesByName.get(name)!.push(pkg);
  }
  
  const result: PackageRecord[] = [];
  
  for (const [name, pkgs] of packagesByName.entries()) {
    const keepCount = versionKeepRules.get(name);
    
    if (keepCount === undefined) {
      // Нет правила version-keep для этого имени, оставить все версии
      result.push(...pkgs);
    } else {
      // Сортировать версии и оставить только N последних
      // Используем правильную сортировку версий Debian
      const sorted = [...pkgs].sort((a, b) => {
        const versionA = a.Version || '';
        const versionB = b.Version || '';
        return compareVersions(versionB, versionA); // По убыванию
      });
      
      // Оставить первые N (самые новые)
      result.push(...sorted.slice(0, keepCount));
    }
  }
  
  return result;
}

/**
 * Извлекает зависимости из пакета
 */
export function extractDependencies(pkg: PackageRecord, followRecommends: boolean, followSuggests: boolean): string[] {
  const deps: Set<string> = new Set();
  
  // Обязательные зависимости
  if (pkg.Depends) {
    const dependsList = parseDependencyList(pkg.Depends);
    dependsList.forEach(d => deps.add(d));
  }
  
  // Предварительно зависимые
  if (pkg.PreDepends) {
    const preDependsList = parseDependencyList(pkg.PreDepends);
    preDependsList.forEach(d => deps.add(d));
  }
  
  // Рекомендуемые (опционально)
  if (followRecommends && pkg.Recommends) {
    const recommendsList = parseDependencyList(pkg.Recommends);
    recommendsList.forEach(d => deps.add(d));
  }
  
  // Предлагаемые (опционально)
  if (followSuggests && pkg.Suggests) {
    const suggestsList = parseDependencyList(pkg.Suggests);
    suggestsList.forEach(d => deps.add(d));
  }
  
  return Array.from(deps);
}

/**
 * Парсит список зависимостей Debian формата
 * Формат: "pkg1, pkg2 (>= 1.0), pkg3 | pkg4"
 * Возвращает имена пакетов (без условий версии)
 */
function parseDependencyList(depString: string): string[] {
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
      if (match) {
        deps.push(match[1]);
      }
    }
  }
  
  return deps;
}

/**
 * Разрешает зависимости для списка пакетов
 * Добавляет все необходимые зависимости рекурсивно
 * @param allPackages - полный список всех доступных пакетов в репозитории
 * @param targetPackages - целевые пакеты, для которых нужно разрешить зависимости
 * @param followRecommends - следовать ли за Recommends
 * @param followSuggests - следовать ли за Suggests
 * @param allowUnresolved - разрешать ли отсутствие зависимостей (не выводить ошибку)
 * @param depsReposMap - мапа репозиториев для поиска зависимостей: repoId -> PackageRecord[]
 * @param currentRepoId - ID текущего репозитория (для предотвращения циклов)
 * @returns отфильтрованный список пакетов (только целевые + их зависимости)
 */
export function resolveDependencies(
  allPackages: PackageRecord[], 
  targetPackages: PackageRecord[],
  followRecommends: boolean, 
  followSuggests: boolean,
  allowUnresolved: boolean = false,
  depsReposMap: Map<string, PackageRecord[]> = new Map(),
  currentRepoId?: string
): { packages: PackageRecord[]; unresolved: string[] } {
  const packageMap = new Map<string, PackageRecord[]>();
  
  // Создать мапу всех доступных пакетов по имени -> список версий
  for (const pkg of allPackages) {
    const name = pkg.Package || '';
    if (!packageMap.has(name)) {
      packageMap.set(name, []);
    }
    packageMap.get(name)!.push(pkg);
  }
  
  // Кэш для мап deps-repos (чтобы не пересоздавать для каждого репозитория)
  const depsRepoPackageMaps = new Map<string, Map<string, PackageRecord[]>>();
  for (const [repoId, repoPackages] of depsReposMap.entries()) {
    const repoPackageMap = new Map<string, PackageRecord[]>();
    for (const pkg of repoPackages) {
      const name = pkg.Package || '';
      if (!repoPackageMap.has(name)) {
        repoPackageMap.set(name, []);
      }
      repoPackageMap.get(name)!.push(pkg);
    }
    depsRepoPackageMaps.set(repoId, repoPackageMap);
  }
  
  const resolvedNames = new Set<string>();
  const resolvedPackages = new Map<string, PackageRecord>(); // name+version -> pkg
  const queue: string[] = [];
  const unresolved: string[] = [];
  
  // Добавить все целевые пакеты в очередь
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
  
  // BFS для разрешения зависимостей
  while (queue.length > 0) {
    const currentName = queue.shift()!;
    
    // Получить все версии этого пакета из resolvedPackages
    const currentPkgs = Array.from(resolvedPackages.values()).filter(p => p.Package === currentName);
    
    for (const currentPkg of currentPkgs) {
      const deps = extractDependencies(currentPkg, followRecommends, followSuggests);
      
      for (const depName of deps) {
        if (!resolvedNames.has(depName)) {
          resolvedNames.add(depName);
          queue.push(depName);
          
          // Сначала ищем в текущем репозитории
          let depVersions = packageMap.get(depName);
          
          // Если не нашли, ищем в deps-repos (используем кэшированные мапы)
          if (!depVersions || depVersions.length === 0) {
            for (const [repoId, repoPackageMap] of depsRepoPackageMaps.entries()) {
              // Не искать в самом себе
              if (repoId === currentRepoId) continue;
              
              depVersions = repoPackageMap.get(depName);
              if (depVersions && depVersions.length > 0) {
                break;
              }
            }
          }
          
          if (depVersions && depVersions.length > 0) {
            // Сортировать по версии и взять последнюю (самую новую)
            const sorted = [...depVersions].sort((a, b) => {
              return compareVersions(b.Version || '', a.Version || '');
            });
            const latest = sorted[0];
            const key = `${depName}:${latest.Version}`;
            if (!resolvedPackages.has(key)) {
              resolvedPackages.set(key, latest);
            }
          } else {
            unresolved.push(depName);
            if (!allowUnresolved) {
              console.warn(`Warning: Dependency '${depName}' not found in repository${currentRepoId ? ` or deps-repos` : ''}`);
            }
          }
        }
      }
    }
  }
  
  // Вернуть только разрешенные пакеты
  return { packages: Array.from(resolvedPackages.values()), unresolved };
}
