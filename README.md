# Debian Package Filter Proxy v2.2.0

Минималистичный HTTP-прокси для фильтрации Debian/Ubuntu репозиториев перед зеркалом в Pulp. Позволяет исключать лишние пакеты (dbg, doc, dev), оставлять только определенные версии и автоматически разрешать зависимости.

## Требования

- **[Bun](https://bun.sh/)** (последняя версия) — runtime для выполнения TypeScript
- Системная утилита `gpg` (опционально, для подписи репозиториев)

> **Важно:** Проект использует **Bun** вместо Node.js. Установите Bun: `curl -fsSL https://bun.sh/install | bash`

## Особенности

- **Фильтрация**: Include/Exclude по имени, версии и приоритету через RegExp.
- **Управление версиями**: Оставление N последних версий или версий, подходящих под шаблон (`version-keep`).
- **Зависимости**: Автоматическое разрешение зависимостей с поддержкой кросс-репозиторного поиска (`deps-repos`).
- **Прозрачность**: Отдает отфильтрованные `Packages.gz` и делает 301 Redirect на оригинальные `.deb` файлы.
- **Безопасность**: Поддержка GPG подписи (через системный `gpg`).
- **Производительность**: 
  - SQLite для эффективного хранения и поиска зависимостей
  - Потоковая обработка пакетов из upstream
  - Кэширование Package файлов на диске с атомарной записью
  - Оптимизировано для работы на слабом железе (2 ядра, 1 Гб ОЗУ)
- **Технологии**: Bun, TypeScript, SQLite (без внешних npm зависимостей).

## Быстрый старт

### 1. Требования

- **[Bun](https://bun.sh/)** (последняя версия) — runtime для выполнения TypeScript
- Системная утилита `gpg` (опционально, для подписи репозиториев)

> **Важно:** Проект использует **Bun** вместо Node.js. Установите Bun: `curl -fsSL https://bun.sh/install | bash`

### 2. Установка
```bash
git clone <repository-url>
cd debian-package-filter
bun install
```

### 3. Конфигурация
Создайте директорию `config` и файлы конфигурации:

**Глобальный конфиг** (`config/config.json`):
```json
{
  "logLevel": "info",
  "logFile": "app.log",
  "port": 8080,
  "cacheDir": "./cache"
}
```

**Конфиг репозитория** (`config/repos/ubuntu-noble.json`):
```json
{
  "id": "ubuntu-noble",
  "upstream": "http://ru.archive.ubuntu.com/ubuntu",
  "dist": "noble",
  "components": ["main", "universe"],
  "arch": ["amd64"],
  "exclude": [
    { "name": ".*-dbg$" },
    { "name": ".*-doc$" },
    { "priority": ["optional", "extra"] }
  ],
  "deps": {
    "follow-recommends": false,
    "follow-suggests": false
  },
  "deps-repos": []
}
```

### 4. Запуск
```bash
bun run src/index.ts
```

Сервер запустится на порту, указанном в конфиге (по умолчанию 8080).

## Использование с Pulp

1. Создайте новый `deb remote` в Pulp.
2. Укажите URL: `http://localhost:8080/r/ubuntu-noble`.
3. Pulp скачает отфильтрованный `Packages.gz` и будет загружать пакеты по редиректам.


## API

- `GET /r/:repo/sync` — Принудительная синхронизация репозитория.
- `GET /r/:repo/packages/list` — Получить список отфильтрованных пакетов в JSON.
- `GET /r/:repo/packages/status` — Получить пакеты по статусам (active, ignored, required, stale).
- `GET /r/:repo/stats` — Статистика фильтрации по причинам исключения.
- `GET /r/:repo/dists/:dist/...` — Прокси запросов к метаданным репозитория.
- `GET /r/:repo/pool/...` — Редирект на оригинальный `.deb` пакет.

## Документация

Подробное описание формата конфигурации, логики фильтрации и API см. в [DOCS.md](./DOCS.md).

## Changelog

История изменений доступна в [CHANGELOG.md](./CHANGELOG.md).

## Лицензия

MIT
