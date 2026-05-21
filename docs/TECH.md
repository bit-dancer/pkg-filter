# Техническая документация Debian Package Filter Proxy

## Версия
2.2.0

## Обзор проекта

Debian Package Filter Proxy — это HTTP-прокси сервер для фильтрации Debian/Ubuntu репозиториев. Написан на TypeScript с использованием runtime Bun.

## Структура проекта

```
/workspace
├── src/                      # Исходный код
│   ├── index.ts              # Точка входа, HTTP сервер
│   ├── server.ts             # Инициализация приложения
│   ├── repo-manager.ts       # Управление репозиториями, синхронизация
│   ├── filter.ts             # Логика фильтрации пакетов
│   ├── parser.ts             # Парсинг Debian Packages формата
│   ├── version.ts            # Версия приложения
│   └── utils/
│       ├── paths.ts          # Утилиты работы с путями
│       ├── logger.ts         # Модуль логирования
│       ├── cache-manager.ts  # Кэширование Package файлов
│       ├── debian-version.ts # Сравнение версий Debian
│       └── dependency-parser.ts # Парсинг зависимостей
├── tests/                    # Тесты
│   ├── logger.test.ts        # Тесты логгера
│   ├── paths.test.ts         # Тесты утилит путей
│   ├── filter.test.ts        # Тесты фильтрации
│   ├── unit.test.ts          # Юнит-тесты
│   └── e2e.test.ts           # E2E тесты сервера
├── docs/                     # Документация
│   ├── DOCS.md               # Основная документация
│   ├── EXAMPLES.md           # Примеры конфигураций
│   ├── TESTS.md              # Документация по тестам
│   └── TECH.md               # Техническая документация (этот файл)
├── config/                   # Конфигурация
│   └── config.json           # Глобальный конфиг
├── data/                     # Данные (кэш, БД, логи)
├── package.json              # Зависимости и скрипты
└── README.md                 # README проекта
```

## Технологический стек

### Runtime
- **Bun** (v1.3.14+) — JavaScript runtime с встроенной поддержкой TypeScript
  - Быстрый запуск без компиляции
  - Встроенный тестовый раннер
  - Встроенная работа с файлами и HTTP

### Язык
- **TypeScript** (v5+) — типизированный JavaScript
  - Строгая типизация для надежности
  - Компиляция в JavaScript при необходимости

### Библиотеки
- **undici** (v7.25.0+) — HTTP клиент для запросов к upstream
  - Поддержка proxy (SOCKS5, HTTP)
  - Настраиваемые таймауты
  - Потоковая обработка ответов

- **bun:sqlite** — встроенная SQLite база данных
  - Хранение метаданных пакетов
  - Индексы для быстрого поиска
  - Оптимизация для больших объемов данных

### Инструменты разработки
- **ESLint** — линтинг кода
- **Bun Test** — тестовый фреймворк

## Архитектурные компоненты

### 1. HTTP Сервер (src/index.ts)

Использует `Bun.serve()` для создания HTTP сервера.

**Эндпоинты:**
- `GET /health` — проверка здоровья
- `GET /metrics` — метрики системы
- `GET /r/:repo/dists/:dist/:component/binary-:arch/Packages.gz` — отфильтрованные метаданные
- `GET /r/:repo/pool/:path/:file.deb` — редирект на .deb пакеты
- `GET /r/:repo/packages/list` — список пакетов в JSON
- `GET /r/:repo/sync` — принудительная синхронизация

**Обработка запросов:**
```typescript
const server = Bun.serve({
  port: process.env.PORT || 8080,
  async fetch(req) {
    // Парсинг URL, роутинг, обработка
  }
});
```

### 2. RepoManager (src/repo-manager.ts)

Управляет репозиториями, синхронизацией и базой данных.

**Ключевые методы:**
- `loadConfig()` — загрузка конфигурации из JSON
- `syncRepo(repoId)` — синхронизация репозитория с upstream
- `getPackages(repoId)` — получение пакетов из БД
- `writePackageFilesToCache()` — сохранение в кэш

**База данных SQLite:**
```sql
-- Таблица репозиториев
CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  last_sync DATETIME,
  sync_status TEXT
);

-- Таблица пакетов
CREATE TABLE packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  architecture TEXT,
  priority TEXT,
  depends TEXT,
  filename TEXT,
  size INTEGER,
  sha256 TEXT,
  data TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  filter_reason TEXT,
  UNIQUE(repo_id, package_name, version)
);

-- Таблица зависимостей
CREATE TABLE packages_depends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  dep_type TEXT DEFAULT 'depends',
  UNIQUE(repo_id, package_name, version, depends_on, dep_type)
);
```

**Оптимизации SQLite:**
```typescript
this.db.run('PRAGMA cache_size = -2000'); // 2MB кэш
this.db.run('PRAGMA temp_store = MEMORY'); // Временные таблицы в памяти
this.db.run('PRAGMA mmap_size = 268435456'); // 256MB memory-mapped I/O
```

### 3. Filter (src/filter.ts)

Применяет правила фильтрации к пакетам.

**Функции:**
- `applyInclude(packages, rules)` — включение пакетов по правилам
- `applyExclude(packages, rules)` — исключение пакетов по правилам
- `applyVersionKeep(packages, rules)` — оставление N последних версий
- `resolveDependencies(...)` — разрешение зависимостей

**Алгоритм фильтрации:**
1. Include: отбор пакетов по имени/версии/приоритету
2. Exclude: удаление dbg/dev/doc пакетов
3. Version Keep: оставление последних N версий
4. Dependency Resolution: добавление необходимых зависимостей

### 4. Parser (src/parser.ts)

Парсит формат Debian Packages.

**Формат:**
```
Package: package-name
Version: 1.0-1
Architecture: amd64
Depends: libc6 (>= 2.31), libssl1.1
Description: Multi-line description
 continues here

```

**Функции:**
- `parsePackages(content)` — парсинг текста в массив объектов
- `serializePackages(packages)` — сериализация обратно в текст

### 5. CacheManager (src/utils/cache-manager.ts)

Кэширует Package файлы на диске.

**Особенности:**
- Файлы сохраняются как `{repo_id}_{datetime}.{ext}`
- Во время синхронизации используется префикс `_`
- Атомарное завершение синхронизации
- Автоматическая очистка старых версий

**Методы:**
- `getTempFilename()` — имя временного файла
- `getFinalFilename()` — имя финального файла
- `finalizeSync()` — завершение синхронизации
- `cleanup()` — очистка старых файлов

### 6. Logger (src/utils/logger.ts)

Модуль логирования с форматом `[DATETIME] [LOGLEVEL] msg`.

**Уровни:** debug, info, warn, error

**Формат лога:**
```
[2024-05-21T11:47:50.010Z] [INFO] Message text {"context": "value"}
```

**Методы:**
- `debug/info/warn/error(message, context?)` — базовое логирование
- `http(method, path, status, durationMs, context?)` — HTTP запросы
- `upstreamRequest(url, status, durationMs, context?)` — запросы к upstream

### 7. Debian Version Comparison (src/utils/debian-version.ts)

Реализует алгоритм сравнения версий dpkg.

**Особенности:**
- Поддержка эпох (`1:1.0`)
- Поддержка тильд (`1.0~rc1 < 1.0`)
- Поддержка revision (`1.0-1ubuntu1`)

**Алгоритм:**
1. Сравнение epoch
2. Сравнение upstream версии
3. Сравнение revision

### 8. Dependency Parser (src/utils/dependency-parser.ts)

Парсит строки зависимостей Debian.

**Формат:**
```
libc6 (>= 2.31), libssl1.1 | libssl1.0
```

**Функции:**
- `parseDependencies(depStr)` — парсинг строки в массив
- `satisfiesConstraint(version, op, target)` — проверка условия версии

## Конфигурация

### Глобальный конфиг (config/config.json)

```json
{
  "logLevel": "info",
  "logFile": "app.log",
  "logToStdout": false,
  "port": 8080,
  "repo1": { ... },
  "repo2": { ... }
}
```

### Конфигурация репозитория

```json
{
  "upstream": "http://archive.ubuntu.com/ubuntu",
  "dist": "noble-updates",
  "components": ["main", "restricted", "universe", "multiverse"],
  "arch": ["amd64"],
  "include": [{ "name": "redis-server" }],
  "exclude": [{ "name": ".*-dbg$" }],
  "deps": {
    "follow-recommends": false,
    "follow-suggests": false
  },
  "allow-unresolved": true,
  "deps-repos": ["ubuntu-base"],
  "http-timeout": 30000,
  "http-proxy": "socks5://proxy:1080"
}
```

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| PORT | Порт HTTP сервера | 8080 |
| CONFIG_PATH | Путь к конфигу | ./config/config.json |
| DATA_DIR | Директория данных | ./data |
| DB_PATH | Путь к базе данных | ./data/packages.db |
| LOG_FILE | Путь к файлу логов | ./data/app.log |
| LOG_LEVEL | Уровень логирования | info |

## Запуск приложения

```bash
# Установка зависимостей
bun install

# Запуск сервера
bun run src/index.ts

# Запуск в production режиме
NODE_ENV=production bun run src/index.ts
```

## Тестирование

```bash
# Запустить все тесты
bun test

# Запустить с покрытием
bun test --coverage

# Запустить конкретный файл
bun test tests/logger.test.ts
```

## Производительность

### Оптимизации

1. **SQLite индексы** — быстрый поиск пакетов и зависимостей
2. **Кэширование на диске** — минимизация повторных запросов к upstream
3. **Потоковая обработка** — чтение больших файлов без загрузки в память
4. **Атомарная запись** — защита от чтения неполных файлов
5. **Блокировка синхронизации** — предотвращение гонок данных

### Метрики производительности

- Обработка репозитория 60K пакетов: ~30-60 секунд
- Использование памяти: <200 MB при обработке
- Время ответа API: <100ms для кэшированных данных

## Безопасность

### Защита от атак

1. **Directory Traversal** — валидация путей через `normalizePath()`
2. **Injection** — валидация repoId через `validateRepoId()`
3. **URL Encoding атаки** — декодирование перед проверкой

### GPG подпись

Опциональная поддержка GPG подписи репозиториев через системную утилиту `gpg`.

## Мониторинг

### Эндпоинт /metrics

Возвращает JSON с метриками:
- Количество пакетов
- Количество репозиториев
- Uptime
- Статистика HTTP запросов
- Статус синхронизации по репозиториям

### Логи

Формат: `[DATETIME] [LOGLEVEL] message {"context": "value"}`

Логи записываются в файл и опционально в stdout.

## Разрешение проблем

### Синхронизация не завершается

Проверить:
- Доступность upstream
- Таймауты (`http-timeout`)
- Логи синхронизации

### Пакеты не находятся

Проверить:
- Правила include/exclude
- Зависимости в deps-repos
- allow-unresolved флаг

### Высокое использование памяти

Рекомендации:
- Уменьшить количество одновременных синхронизаций
- Проверить размер кэша
- Использовать streaming где возможно

## Вклад в проект

### Добавление нового фильтра

1. Добавить правило в интерфейс `FilterRule`
2. Реализовать логику в `filter.ts`
3. Добавить тесты в `tests/filter.test.ts`
4. Обновить документацию

### Добавление нового эндпоинта

1. Добавить роут в `src/index.ts`
2. Реализовать обработчик
3. Добавить тесты в `tests/e2e.test.ts`
4. Обновить API документацию
