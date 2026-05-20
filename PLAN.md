# План разработки: Debian Package Filter Proxy

## 1. Обзор проекта
**Цель:** Создать минималистичный HTTP-прокси сервер на **Bun + TypeScript**, который фильтрует репозитории Debian/Ubuntu перед передачей их в Pulp.

**Принцип работы:** Приложение выступает как "умное зеркало". Оно скачивает метаданные (`Packages`, `Packages.gz`) с upstream-репозиториев, применяет правила фильтрации (include/exclude по имени, версии, приоритету), разрешает зависимости и отдает отфильтрованный список клиенту (Pulp). Запросы к самим `.deb` файлам перенаправляются (301 Redirect) на оригинальный upstream.

**Технологический стек:**
- **Runtime:** Bun (актуальная версия)
- **Язык:** TypeScript
- **База данных:** SQLite (встроенная в Bun `bun:sqlite`)
- **HTTP сервер:** Встроенный `Bun.serve`
- **Компрессия:** Встроенный `zlib` / `CompressionStream`
- **Зависимости:** Отсутствуют (только стандартные модули Bun)

---

## 2. Архитектура данных (SQLite)

База данных хранит состояние синхронизации и отфильтрованные пакеты для быстрого доступа.

### Таблицы:

#### 1. `repos` - Конфигурация репозиториев
| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT, PK | Уникальный ключ (напр. `ubuntu-noble`, `redis-jammy`) |
| `config` | TEXT | JSON строка с полными настройками из конфига |
| `last_sync` | INTEGER | Timestamp последней успешной синхронизации |
| `status` | TEXT | 'idle', 'syncing', 'error' |

#### 2. `packages` - Кэш отфильтрованных пакетов
| Поле | Тип | Описание |
|------|-----|----------|
| `repo_id` | TEXT | FK на `repos.id` |
| `name` | TEXT | Имя пакета |
| `version` | TEXT | Версия пакета |
| `arch` | TEXT | Архитектура |
| `component` | TEXT | Компонент (main, universe и т.д.) |
| `filename` | TEXT | Путь к .deb файлу в пуле |
| `checksum` | TEXT | MD5/SHA256 (опционально) |
| `priority` | TEXT | Приоритет (required, important, optional, extra) |
| `depends` | TEXT | Список зависимостей (сырая строка) |
| `recommends` | TEXT | Список рекомендованных |
| `suggests` | TEXT | Список предлагаемых |
| `is_resolved` | BOOLEAN | Флаг: добавлен ли через зависимости |
| `raw_entry` | TEXT | Полная сырая запись пакета из Packages |

#### 3. Индексы
- Составной индекс на `(repo_id, name)` для ускорения поиска зависимостей

---

## 3. Структура конфигурации (`config.json`)

```typescript
interface RepoConfig {
  upstream: string;
  dist: string; // напр. "noble", "jammy"
  components: string[]; // ["main", "restricted"]
  arch: string[]; // ["amd64"]
  include?: FilterRule[];
  exclude?: FilterRule[];
  deps: {
    "follow-recommends": boolean;
    "follow-suggests": boolean;
  };
  "verify-checksums"?: boolean;
  "allow-unresolved"?: boolean;
}

interface FilterRule {
  name?: string; // RegExp строка или точное совпадение
  version?: string; // RegExp с префиксом "r|" или точное
  "version-keep"?: number; // Количество версий для хранения
  priority?: string[]; // ["optional", "extra"]
}
```

**Логика правил:**
- Если `include` и `exclude` пусты → полное зеркало
- `include`: пакет попадает в выборку при соответствии хотя бы одному правилу
- `exclude`: пакет удаляется при соответствии хотя бы одному правилу (после include)
- `version-keep`: оставляем только N последних версий

---

## 4. Основные модули приложения

### 4.1. Парсер Debian Packages (`src/parser.ts`)
- Потоковый или построчный парсер формата `Packages`
- Формат: блоки ключ-значение, разделенные пустой строкой
- Мультистроковые значения начинаются с пробела
- Извлекаемые поля: `Package`, `Version`, `Architecture`, `Filename`, `Depends`, `Recommends`, `Suggests`, `Priority`, `MD5sum`, `SHA256`

### 4.2. Движок фильтрации (`src/filter.ts`)
**Шаг 1: Первичный отбор**
- Проход по всем пакетам из upstream
- Применение правил `include`/`exclude` (RegExp matching)

**Шаг 2: Ограничение версий**
- Применение `version-keep`

**Шаг 3: Разрешение зависимостей (Dependency Resolution)**
- Алгоритм обхода графа (BFS/DFS)
- Стартовый набор: пакеты из Шага 2
- Для каждого пакета парсим `Depends`
- Если зависимость найдена в upstream и не добавлена → добавляем с флагом `is_resolved = true`
- Рекурсивно повторяем для новых зависимостей
- Учитываем флаги `follow-recommends` и `follow-suggests`
- Обработка `allow-unresolved`: логирование предупреждений при отсутствии зависимостей

### 4.3. Синхронизатор (`src/sync.ts`)
- Генерация URL: `{upstream}/dists/{dist}/{component}/binary-{arch}/Packages.gz`
- Скачивание через `fetch`
- Декомпрессия `gzip` (через `DecompressionStream`)
- Запуск парсера и движка фильтрации
- Массовая вставка в SQLite (транзакция)
- Обновление `last_sync`

### 4.4. HTTP Сервер (`src/server.ts`)
Использует `Bun.serve({ fetch, port })`

#### Маршруты:

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/r/:repo/dists/:dist/Release` | Проксирует Release файл с пересчетом хешей |
| GET | `/r/:repo/dists/:dist/:comp/binary-:arch/Packages[.gz]` | Генерирует ответ из БД |
| GET | `/r/:repo/pool/*` | 301 Redirect на upstream |
| GET | `/r/:repo/sync` | Принудительная синхронизация |
| GET | `/health` | Статус приложения |

---

## 5. Этапы реализации

### Этап 1: Инициализация и База Данных
- [ ] Настройка `tsconfig.json`, `package.json`
- [ ] Скрипт инициализации БД (`src/db.ts`)
- [ ] Чтение и валидация `config.json`

### Этап 2: Парсер и Загрузчик
- [ ] Парсер текста `Packages`
- [ ] Скачивание и декомпрессия `Packages.gz`
- [ ] Тест на реальном URL

### Этап 3: Логика Фильтрации
- [ ] RegExp матчинг имен и версий
- [ ] Логика `include`/`exclude`
- [ ] Алгоритм разрешения зависимостей
- [ ] Сохранение в SQLite

### Этап 4: HTTP Сервер
- [ ] Настройка `Bun.serve`
- [ ] Роут `/pool/*` → 301 Redirect
- [ ] Роут `/Packages*` → генерация из БД
- [ ] Роут `/sync` → триггер синхронизации

### Этап 5: Release файлы (Критично)
- [ ] Скачивание оригинального `Release`
- [ ] Пересчет хешей `Packages`/`Packages.gz`
- [ ] Генерация модифицированного `Release`
- [ ] Примечание: GPG подпись будет невалидна (требуется настройка Pulp на игнорирование)

### Этап 6: Планировщик
- [ ] Интервальная синхронизация при старте
- [ ] Graceful shutdown

### Этап 7: Тестирование
- [ ] Проверка фильтрации
- [ ] Проверка зависимостей
- [ ] Проверка редиректов
- [ ] Валидация формата Packages

---

## 6. Структура проекта

```
/workspace
├── package.json
├── tsconfig.json
├── config.json              # Конфигурация репозиториев
├── src
│   ├── index.ts             # Точка входа
│   ├── db.ts                # SQLite инициализация
│   ├── parser.ts            # Парсер Packages
│   ├── filter.ts            # Фильтрация и зависимости
│   ├── sync.ts              # Синхронизация
│   ├── server.ts            # HTTP сервер
│   ├── utils.ts             # Хеширование, helpers
│   └── types.ts             # TypeScript интерфейсы
└── data
    └── cache.db             # SQLite (авто)
```

---

## 7. Технические детали

### Обработка версий
Debian версии сложны (`1:2.3.4-5ubuntu1`). Для `version-keep`:
- Вариант A: Лексикографическая сортировка (просто, но неточно)
- Вариант B: Эвристическое сравнение
- Вариант C: Полная реализация `dpkg --compare-versions` (трудоемко)

**Решение:** Начать с лексикографической сортировки, при необходимости доработать.

### Конкурентность
- SQLite WAL режим для лучшей производительности
- Параллельная синхронизация разных репозиториев
- Батчевая вставка в БД

### Память
- Потоковая обработка больших файлов
- Батчевая вставка (по 1000 записей)
- Очистка старых версий при `version-keep`

---

## 8. Запуск

```bash
# Инициализация
bun init -y

# Установка типов (опционально, для редактора)
bun add -d typescript @types/bun

# Запуск
bun run src/index.ts

# С переменными окружения
PORT=8080 CONFIG_PATH=./config.json bun run src/index.ts
```

---

## 9. Пример конфигурации

```json
{
  "ubuntu-noble-security": {
    "upstream": "http://security.ubuntu.com/ubuntu",
    "dist": "noble-security",
    "components": ["main", "restricted", "universe", "multiverse"],
    "arch": ["amd64"],
    "include": [],
    "exclude": [],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "verify-checksums": false
  },
  "redis-jammy": {
    "upstream": "https://packages.redis.io/deb",
    "dist": "jammy",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "redis-server", "version": "r|^6\\.2\\..*", "version-keep": 2 }
    ],
    "exclude": [],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": true
  }
}
```
