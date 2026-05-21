import { describe, test, expect } from 'bun:test';
import { parsePackages, serializePackages } from '../src/parser';
import { 
  applyInclude, 
  applyExclude, 
  applyVersionKeep, 
  resolveDependencies,
  type FilterRule 
} from '../src/filter';

describe('Parser', () => {
  test('parses simple package record', () => {
    const input = `Package: redis-server
Version: 6.2.1-1
Architecture: amd64
Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>
Depends: libc6 (>= 2.34), redis-tools

`;
    
    const packages = parsePackages(input);
    
    expect(packages.length).toBe(1);
    const pkg = packages[0];
    if (!pkg) throw new Error('Package not found');
    expect(pkg.Package).toBeDefined();
    expect(pkg.Package).toBe('redis-server');
    expect(pkg.Version).toBeDefined();
    expect(pkg.Version).toBe('6.2.1-1');
    expect(pkg.Architecture).toBeDefined();
    expect(pkg.Architecture).toBe('amd64');
    expect(pkg.Depends).toBeDefined();
    expect(pkg.Depends).toBe('libc6 (>= 2.34), redis-tools');
  });

  test('parses multiple package records', () => {
    const input = `Package: pkg1
Version: 1.0

Package: pkg2
Version: 2.0

`;
    
    const packages = parsePackages(input);
    
    expect(packages.length).toBe(2);
    const pkg1 = packages[0];
    const pkg2 = packages[1];
    if (!pkg1 || !pkg2) throw new Error('Packages not found');
    expect(pkg1.Package).toBeDefined();
    expect(pkg1.Package).toBe('pkg1');
    expect(pkg2.Package).toBeDefined();
    expect(pkg2.Package).toBe('pkg2');
  });

  test('serializes packages back to text format', () => {
    const input = `Package: redis-server
Version: 6.2.1-1
Architecture: amd64

`;
    
    const packages = parsePackages(input);
    const output = serializePackages(packages);
    
    expect(output).toContain('Package: redis-server');
    expect(output).toContain('Version: 6.2.1-1');
    expect(output).toContain('Architecture: amd64');
  });
});

describe('Filter - Include', () => {
  const packages = [
    { Package: 'redis-server', Version: '6.2.1', Priority: 'optional' },
    { Package: 'redis-tools', Version: '6.2.1', Priority: 'optional' },
    { Package: 'nginx', Version: '1.18.0', Priority: 'optional' },
    { Package: 'mysql-server', Version: '8.0.0', Priority: 'optional' },
  ];

  test('empty include rules returns all packages', () => {
    const result = applyInclude(packages, []);
    expect(result.length).toBe(4);
  });

  test('include by exact name', () => {
    const rules: FilterRule[] = [{ name: 'redis-server' }];
    const result = applyInclude(packages, rules);
    
    expect(result.length).toBe(1);
    const pkg = result[0]; if (!pkg) throw new Error("Package not found"); expect(pkg.Package).toBeDefined(); expect(pkg.Package).toBe('redis-server');
  });

  test('include by regex pattern', () => {
    const rules: FilterRule[] = [{ name: '^redis-.*' }];
    const result = applyInclude(packages, rules);
    
    expect(result.length).toBe(2);
    const pkg0 = result[0]; if (!pkg0) throw new Error("Package not found");
    const pkg1 = result[1]; if (!pkg1) throw new Error("Package not found");
    expect(pkg0.Package).toBe('redis-server');
    expect(pkg1.Package).toBe('redis-tools');
  });

  test('include by version regex', () => {
    const rules: FilterRule[] = [{ name: 'redis-server', version: 'r|^6\\.2\\..*' }];
    const result = applyInclude(packages, rules);
    
    expect(result.length).toBe(1);
    const pkg0 = result[0]; if (!pkg0) throw new Error("Package not found");
    expect(pkg0.Package).toBe('redis-server');
    expect(pkg0.Version).toBe('6.2.1');
  });

  test('include with multiple rules (OR logic)', () => {
    const rules: FilterRule[] = [
      { name: 'redis-server' },
      { name: 'nginx' }
    ];
    const result = applyInclude(packages, rules);
    
    expect(result.length).toBe(2);
    expect(result.map(p => p.Package)).toEqual(expect.arrayContaining(['redis-server', 'nginx']));
  });
});

describe('Filter - Exclude', () => {
  const packages = [
    { Package: 'redis-server', Version: '6.2.1', Priority: 'optional' },
    { Package: 'libredis-dev', Version: '6.2.1', Priority: 'optional' },
    { Package: 'redis-doc', Version: '6.2.1', Priority: 'extra' },
    { Package: 'redis-dbg', Version: '6.2.1', Priority: 'extra' },
    { Package: 'nginx', Version: '1.18.0', Priority: 'optional' },
  ];

  test('empty exclude rules returns all packages', () => {
    const result = applyExclude(packages, []);
    expect(result.length).toBe(5);
  });

  test('exclude by priority', () => {
    const rules: FilterRule[] = [{ priority: ['optional', 'extra'] }];
    const result = applyExclude(packages, rules);
    
    // Все пакеты имеют priority optional или extra, поэтому все будут исключены
    expect(result.length).toBe(0);
  });

  test('exclude debug packages by name pattern', () => {
    const rules: FilterRule[] = [{ name: '.*-dbg$' }];
    const result = applyExclude(packages, rules);
    
    expect(result.length).toBe(4);
    expect(result.map(p => p.Package)).not.toContain('redis-dbg');
  });

  test('exclude dev and doc packages', () => {
    const rules: FilterRule[] = [
      { name: '.*-dev$' },
      { name: '.*-doc$' }
    ];
    const result = applyExclude(packages, rules);
    
    expect(result.length).toBe(3);
    expect(result.map(p => p.Package)).not.toContain('libredis-dev');
    expect(result.map(p => p.Package)).not.toContain('redis-doc');
  });

  test('combined exclude rules', () => {
    const rules: FilterRule[] = [
      { name: '.*-dbg$' },
      { name: '.*-dev$' },
      { name: '.*-doc$' }
    ];
    const result = applyExclude(packages, rules);
    
    expect(result.length).toBe(2);
    expect(result.map(p => p.Package)).toEqual(expect.arrayContaining(['redis-server', 'nginx']));
  });
});

describe('Filter - Version Keep', () => {
  const packages = [
    { Package: 'redis-server', Version: '6.2.1' },
    { Package: 'redis-server', Version: '6.2.2' },
    { Package: 'redis-server', Version: '6.2.3' },
    { Package: 'redis-server', Version: '7.0.0' },
    { Package: 'redis-server', Version: '7.0.1' },
    { Package: 'nginx', Version: '1.18.0' },
    { Package: 'nginx', Version: '1.20.0' },
  ];

  test('keep only N latest versions', () => {
    const rules: FilterRule[] = [
      { name: 'redis-server', 'version-keep': 2 }
    ];
    const result = applyVersionKeep(packages, rules);
    
    const redisPkgs = result.filter(p => p.Package === 'redis-server');
    expect(redisPkgs.length).toBe(2);
    // Должны остаться самые новые версии
    expect(redisPkgs.map(p => p.Version)).toEqual(expect.arrayContaining(['7.0.1', '7.0.0']));
  });

  test('packages without version-keep rule remain unchanged', () => {
    const rules: FilterRule[] = [
      { name: 'redis-server', 'version-keep': 2 }
    ];
    const result = applyVersionKeep(packages, rules);
    
    const nginxPkgs = result.filter(p => p.Package === 'nginx');
    expect(nginxPkgs.length).toBe(2); // Все версии nginx остались
  });
});

describe('Filter - Dependency Resolution', () => {
  const packages = [
    { 
      Package: 'redis-server', 
      Version: '6.2.1', 
      Depends: 'libc6, redis-tools' 
    },
    { 
      Package: 'redis-tools', 
      Version: '6.2.1', 
      Depends: 'libc6' 
    },
    { 
      Package: 'libc6', 
      Version: '2.34', 
      Depends: '' 
    },
    { 
      Package: 'unrelated-pkg', 
      Version: '1.0', 
      Depends: '' 
    },
  ];

  test('resolves dependencies recursively', () => {
    // Передаем все пакеты и целевые пакеты отдельно
    const targetPackages = [
      { 
        Package: 'redis-server', 
        Version: '6.2.1', 
        Depends: 'libc6, redis-tools' 
      }
    ];
    
    const result = resolveDependencies(
      packages, // Все доступные пакеты
      targetPackages, // Целевые пакеты
      false,
      false,
      true
    );
    
    // Должны быть включены redis-server и его зависимости (которые есть в списке)
    const packageNames = result.packages.map(p => p.Package);
    expect(packageNames).toContain('redis-server');
    expect(packageNames).toContain('redis-tools');
    expect(packageNames).toContain('libc6');
    // unrelated-pkg не должен быть включен, так как он не является зависимостью
    expect(packageNames).not.toContain('unrelated-pkg');
    // unresolved должен быть пустым
    expect(result.unresolved.length).toBe(0);
  });

  test('does not include unrelated packages', () => {
    const targetPackages = [
      { 
        Package: 'redis-server', 
        Version: '6.2.1', 
        Depends: 'libc6, redis-tools' 
      }
    ];
    
    const result = resolveDependencies(
      packages, // Все доступные пакеты
      targetPackages, // Целевые пакеты
      false,
      false,
      true
    );
    
    const packageNames = result.packages.map(p => p.Package);
    expect(packageNames).not.toContain('unrelated-pkg');
  });

  test('follows recommends when enabled', () => {
    const pkgsWithRecommends = [
      { 
        Package: 'app', 
        Version: '1.0', 
        Depends: 'lib-base',
        Recommends: 'lib-extra' 
      },
      { Package: 'lib-base', Version: '1.0', Depends: '' },
      { Package: 'lib-extra', Version: '1.0', Depends: '' },
    ];
    
    const targetPackages = [
      { 
        Package: 'app', 
        Version: '1.0', 
        Depends: 'lib-base',
        Recommends: 'lib-extra' 
      }
    ];
    
    const result = resolveDependencies(
      pkgsWithRecommends, // Все доступные пакеты
      targetPackages, // Целевые пакеты
      true,  // follow-recommends = true
      false,
      true
    );
    
    const packageNames = result.packages.map(p => p.Package);
    expect(packageNames).toContain('app');
    expect(packageNames).toContain('lib-base');
    expect(packageNames).toContain('lib-extra');
  });

  test('does not follow recommends when disabled', () => {
    const pkgsWithRecommends = [
      { 
        Package: 'app', 
        Version: '1.0', 
        Depends: 'lib-base',
        Recommends: 'lib-extra' 
      },
      { Package: 'lib-base', Version: '1.0', Depends: '' },
      { Package: 'lib-extra', Version: '1.0', Depends: '' },
    ];
    
    const targetPackages = [
      { 
        Package: 'app', 
        Version: '1.0', 
        Depends: 'lib-base',
        Recommends: 'lib-extra' 
      }
    ];
    
    const result = resolveDependencies(
      pkgsWithRecommends, // Все доступные пакеты
      targetPackages, // Целевые пакеты
      false,  // follow-recommends = false
      false,
      true
    );
    
    const packageNames = result.packages.map(p => p.Package);
    expect(packageNames).toContain('app');
    expect(packageNames).toContain('lib-base');
    expect(packageNames).not.toContain('lib-extra');
  });

  test('finds dependencies in deps-repos', () => {
    const localPackages = [
      { 
        Package: 'my-app', 
        Version: '1.0', 
        Depends: 'libc6, lib-common' 
      },
    ];
    
    const ubuntuPackages = [
      { Package: 'libc6', Version: '2.34', Depends: '' },
      { Package: 'lib-common', Version: '1.0', Depends: '' },
    ];
    
    const depsReposMap = new Map([
      ['ubuntu-noble', ubuntuPackages]
    ]);
    
    const result = resolveDependencies(
      localPackages, // Все доступные пакеты в локальном репо
      localPackages, // Целевые пакеты
      false,
      false,
      true,
      depsReposMap,
      'my-repo'
    );
    
    const packageNames = result.packages.map(p => p.Package);
    expect(packageNames).toContain('my-app');
    expect(packageNames).toContain('libc6');
    expect(packageNames).toContain('lib-common');
    expect(result.unresolved.length).toBe(0);
  });

  test('reports unresolved dependencies', () => {
    const packages = [
      { 
        Package: 'my-app', 
        Version: '1.0', 
        Depends: 'missing-dep' 
      },
    ];
    
    const result = resolveDependencies(
      packages,
      packages,
      false,
      false,
      true // allowUnresolved = true
    );
    
    expect(result.packages.length).toBe(1); // Только my-app
    expect(result.unresolved).toContain('missing-dep');
  });
});

describe('E2E - Complete Filter Pipeline', () => {
  test('ubuntu-noble scenario: exclude dbg, dev, doc packages', () => {
    const packages = [
      { Package: 'redis-server', Version: '6.2.1', Priority: 'optional' },
      { Package: 'libredis-dev', Version: '6.2.1', Priority: 'optional' },
      { Package: 'redis-doc', Version: '6.2.1', Priority: 'extra' },
      { Package: 'redis-dbg', Version: '6.2.1', Priority: 'extra' },
      { Package: 'nginx', Version: '1.18.0', Priority: 'optional' },
      { Package: 'nginx-dbg', Version: '1.18.0', Priority: 'extra' },
    ];

    // Apply exclude rules from ubuntu-noble config
    const excludeRules: FilterRule[] = [
      { priority: ['optional', 'extra'] },
      { name: '.*-dbg$' },
      { name: '.*-dev$' },
      { name: '.*-doc$' }
    ];

    // Сначала exclude по имени (dbg, dev, doc)
    let result = applyExclude(packages, excludeRules.filter(r => r.name));
    
    // Проверка: должны остаться только redis-server и nginx
    expect(result.length).toBe(2);
    expect(result.map(p => p.Package)).toEqual(expect.arrayContaining(['redis-server', 'nginx']));
  });

  test('redis-jammy scenario: keep specific versions with dependencies', () => {
    const allPackages = [
      { Package: 'redis-server', Version: '6.0.0', Depends: 'libc6' },
      { Package: 'redis-server', Version: '6.2.0', Depends: 'libc6' },
      { Package: 'redis-server', Version: '6.2.1', Depends: 'libc6' },
      { Package: 'redis-server', Version: '6.2.2', Depends: 'libc6' },
      { Package: 'redis-server', Version: '7.0.0', Depends: 'libc6' },
      { Package: 'redis-tools', Version: '6.2.1', Depends: 'libc6' },
      { Package: 'libc6', Version: '2.34', Depends: '' },
    ];

    // Apply include rules from redis-jammy config - сначала фильтруем по версии 6.2.*
    const includeRules: FilterRule[] = [
      { name: 'redis-server', version: 'r|^6\\.2\\..*' }
    ];

    // Сначала include - отфильтровать только те, что соответствуют правилам include (версия 6.2.*)
    let filtered = applyInclude(allPackages, includeRules);
    
    // Затем version-keep - оставить N последних версий для пакетов с version-keep
    const versionKeepRules: FilterRule[] = [
      { name: 'redis-server', 'version-keep': 2 }
    ];
    filtered = applyVersionKeep(filtered, versionKeepRules);
    
    // Проверка: должны остаться только версии 6.2.x (не более 2)
    const redisPkgs = filtered.filter(p => p.Package === 'redis-server');
    expect(redisPkgs.length).toBeLessThanOrEqual(2);
    
    // Все версии должны соответствовать 6.2.*
    for (const pkg of redisPkgs) {
      expect(pkg.Version).toMatch(/^6\.2\./);
    }
  });

  test('full pipeline: include -> exclude -> version-keep -> resolve deps', () => {
    const allPackages = [
      { Package: 'redis-server', Version: '6.2.1', Depends: 'libc6, redis-tools', Priority: 'optional' },
      { Package: 'redis-server', Version: '6.2.2', Depends: 'libc6, redis-tools', Priority: 'optional' },
      { Package: 'redis-server', Version: '7.0.0', Depends: 'libc6, redis-tools', Priority: 'optional' },
      { Package: 'redis-tools', Version: '6.2.2', Depends: 'libc6', Priority: 'optional' },
      { Package: 'redis-dbg', Version: '6.2.2', Priority: 'extra' },
      { Package: 'libredis-dev', Version: '6.2.2', Priority: 'optional' },
      { Package: 'libc6', Version: '2.34', Priority: 'required' },
    ];

    // 1. Include: только redis-server с версией 6.2.*
    const includeRules: FilterRule[] = [
      { name: 'redis-server', version: 'r|^6\\.2\\..*' }
    ];
    let filtered = applyInclude(allPackages, includeRules);
    
    // После include должны остаться только пакеты 6.2.x
    expect(filtered.length).toBe(2); // Только 6.2.1 и 6.2.2
    
    // 2. Exclude: убрать dbg, dev, doc (в данном случае их нет после include)
    const excludeRules: FilterRule[] = [
      { name: '.*-dbg$' },
      { name: '.*-dev$' },
      { name: '.*-doc$' }
    ];
    filtered = applyExclude(filtered, excludeRules);
    
    // 3. Version keep: оставить 2 последние версии
    const versionKeepRules: FilterRule[] = [
      { name: 'redis-server', 'version-keep': 2 }
    ];
    filtered = applyVersionKeep(filtered, versionKeepRules);
    
    // 4. Resolve dependencies - целевые пакеты это результат фильтрации
    const result = resolveDependencies(allPackages, filtered, false, false, true);
    
    // Проверки
    const packageNames = result.packages.map(p => {
      if (!p.Package) throw new Error("Package name is undefined");
      return p.Package;
    });
    
    // Должен быть redis-server (последние 2 версии 6.2.x)
    const redisServerPkgs = result.packages.filter(p => p.Package === 'redis-server' && p.Version && p.Version.startsWith('6.2'));
    expect(redisServerPkgs.length).toBe(2);
    
    // Должны быть зависимости (redis-tools и libc6)
    expect(packageNames).toContain('redis-tools');
    expect(packageNames).toContain('libc6');
    
    // Не должно быть dbg/dev/doc
    expect(packageNames).not.toContain('redis-dbg');
    expect(packageNames).not.toContain('libredis-dev');
    
    // Не должно быть версии 7.0.0
    const v7Pkgs = result.packages.filter(p => p.Package === 'redis-server' && p.Version === '7.0.0');
    expect(v7Pkgs.length).toBe(0);
  });
});
