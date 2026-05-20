# Примеры конфигураций и фильтров Debian Package Filter Proxy

В этом документе собраны различные примеры конфигураций для типовых сценариев использования.

## Содержание
1. [Базовые конфигурации](#базовые-конфигурации)
2. [Фильтрация по имени пакета](#фильтрация-по-имени-пакета)
3. [Управление версиями](#управление-версиями)
4. [Исключение пакетов](#исключение-пакетов)
5. [Работа с зависимостями](#работа-с-зависимостями)
6. [Продвинутые сценарии](#продвинутые-сценарии)
7. [Комбинированные конфигурации](#комбинированные-конфигурации)

---

## Базовые конфигурации

### Минимальная конфигурация

Простейшая конфигурация для проксирования репозитория без фильтрации:

```json
{
  "ubuntu-minimal": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [],
    "exclude": [],
    "allow-unresolved": true
  }
}
```

### Репозиторий с несколькими архитектурами

```json
{
  "ubuntu-multiarch": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main", "restricted"],
    "arch": ["amd64", "i386", "arm64"],
    "include": [],
    "exclude": [],
    "allow-unresolved": true
  }
}
```

### Несколько компонентов репозитория

```json
{
  "ubuntu-full": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main", "restricted", "universe", "multiverse"],
    "arch": ["amd64"],
    "include": [],
    "exclude": [],
    "allow-unresolved": true
  }
}
```

---

## Фильтрация по имени пакета

### Включить только определенные пакеты

Используйте `include` для указания конкретных пакетов:

```json
{
  "redis-only": {
    "upstream": "https://packages.redis.io/deb",
    "dist": "jammy",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "redis-server" },
      { "name": "redis-tools" },
      { "name": "redis-sentinel" }
    ],
    "allow-unresolved": true
  }
}
```

### Фильтрация по RegExp шаблону

Используйте регулярные выражения для выбора пакетов по шаблону:

```json
{
  "kernel-packages": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "^linux-image-.*-generic$" },
      { "name": "^linux-headers-.*-generic$" }
    ],
    "allow-unresolved": true
  }
}
```

### Пакеты с определенной версией

Комбинируйте имя и версию для точного выбора:

```json
{
  "nginx-specific": {
    "upstream": "http://nginx.org/packages/ubuntu",
    "dist": "noble",
    "components": ["nginx"],
    "arch": ["amd64"],
    "include": [
      { 
        "name": "nginx", 
        "version": "r|^1\\.24\\..*" 
      }
    ],
    "allow-unresolved": true
  }
}
```

**Пояснение**: `r|^1\\.24\\..*` — регулярное выражение, которое выбирает версии 1.24.x

---

## Управление версиями

### Оставить только N последних версий

Используйте `version-keep` для ограничения количества версий:

```json
{
  "python-limited": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { 
        "name": "python3", 
        "version-keep": 3 
      },
      { 
        "name": "python3-pip", 
        "version-keep": 3 
      }
    ],
    "allow-unresolved": true
  }
}
```

### Комбинация version-keep и RegExp

Оставить последние 2 версии, но только из ветки 6.2.x:

```json
{
  "redis-versioned": {
    "upstream": "https://packages.redis.io/deb",
    "dist": "jammy",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { 
        "name": "redis-server", 
        "version-keep": 2, 
        "version": "r|^6\\.2\\..*" 
      }
    ],
    "allow-unresolved": true,
    "deps-repos": ["ubuntu-noble"]
  }
}
```

### Только стабильные версии

Исключить версии с суффиксами alpha, beta, rc:

```json
{
  "stable-only": {
    "upstream": "https://example.com/repo",
    "dist": "stable",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { 
        "name": ".*", 
        "version": "r:^(?!.*(?:alpha|beta|rc|dev)).*$" 
      }
    ],
    "allow-unresolved": true
  }
}
```

**Пояснение**: Регулярное выражение исключает версии, содержащие alpha, beta, rc или dev

---

## Исключение пакетов

### Исключить отладочные пакеты

```json
{
  "no-debug": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dbgsym$" }
    ],
    "allow-unresolved": true
  }
}
```

### Исключить пакеты разработки

```json
{
  "no-dev": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-dev$" },
      { "name": ".*-devel$" },
      { "name": "lib.*-dev$" }
    ],
    "allow-unresolved": true
  }
}
```

### Исключить документацию

```json
{
  "no-docs": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-doc$" },
      { "name": ".*-docs$" },
      { "name": "^man-.*" }
    ],
    "allow-unresolved": true
  }
}
```

### Исключить по приоритету

```json
{
  "essential-only": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "exclude": [
      { "priority": ["optional", "extra", "standard"] }
    ],
    "allow-unresolved": true
  }
}
```

**Пояснение**: Оставляет только пакеты с приоритетами `required`, `important`

### Комбинированное исключение

```json
{
  "minimal-system": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" },
      { "priority": ["optional", "extra"] },
      { "section": ["oldlibs", "misc"] }
    ],
    "allow-unresolved": true
  }
}
```

---

## Работа с зависимостями

### Базовая конфигурация зависимостей

```json
{
  "app-with-deps": {
    "upstream": "https://example.com/app-repo",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "my-application" }
    ],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": false,
    "deps-repos": ["ubuntu-noble", "ubuntu-noble-updates"]
  }
}
```

### Разрешение Recommends и Suggests

```json
{
  "full-deps": {
    "upstream": "https://example.com/repo",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "desktop-app" }
    ],
    "deps": {
      "follow-recommends": true,
      "follow-suggests": true
    },
    "allow-unresolved": false,
    "deps-repos": ["ubuntu-noble"]
  }
}
```

**Пояснение**: 
- `follow-recommends: true` — включать пакеты из Recommends
- `follow-suggests: true` — включать пакеты из Suggests

### Кросс-репозиторные зависимости

```json
{
  "postgres-cluster": {
    "upstream": "https://apt.postgresql.org/pub/repos/apt",
    "dist": "noble",
    "components": ["pgdg"],
    "arch": ["amd64"],
    "include": [
      { "name": "postgresql-16" },
      { "name": "postgresql-client-16" }
    ],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": false,
    "deps-repos": [
      "ubuntu-noble",
      "ubuntu-noble-updates",
      "ubuntu-noble-security"
    ]
  }
}
```

### Разрешить неразрешенные зависимости

```json
{
  "partial-sync": {
    "upstream": "https://example.com/repo",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "standalone-app" }
    ],
    "allow-unresolved": true
  }
}
```

**Пояснение**: `allow-unresolved: true` позволяет синхронизировать пакеты даже если некоторые зависимости не найдены

---

## Продвинутые сценарии

### Микросервисный стек

Конфигурация для синхронизации набора микросервисов:

```json
{
  "microservices-stack": {
    "upstream": "https://packages.example.com/microservices",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "api-gateway", "version-keep": 2 },
      { "name": "user-service", "version-keep": 2 },
      { "name": "order-service", "version-keep": 2 },
      { "name": "payment-service", "version-keep": 2 },
      { "name": "notification-service", "version-keep": 2 }
    ],
    "exclude": [
      { "name": ".*-test$" },
      { "name": ".*-mock$" }
    ],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": false,
    "deps-repos": ["ubuntu-noble"]
  }
}
```

### CI/CD окружение

Конфигурация для тестового окружения с последними версиями:

```json
{
  "ci-testing": {
    "upstream": "https://packages.example.com/ci",
    "dist": "noble",
    "components": ["main", "testing"],
    "arch": ["amd64"],
    "include": [
      { "name": "build-tools", "version-keep": 1 },
      { "name": "test-runner", "version-keep": 1 },
      { "name": "coverage-tool", "version-keep": 1 }
    ],
    "exclude": [
      { "priority": ["optional", "extra"] }
    ],
    "allow-unresolved": true
  }
}
```

### Production окружение

Стабильная конфигурация для production:

```json
{
  "production-stable": {
    "upstream": "https://packages.example.com/prod",
    "dist": "noble",
    "components": ["main", "stable"],
    "arch": ["amd64"],
    "include": [
      { 
        "name": "web-server", 
        "version": "r:^2\\.0\\..*", 
        "version-keep": 3 
      },
      { 
        "name": "database-driver", 
        "version": "r:^5\\.1\\..*", 
        "version-keep": 3 
      }
    ],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" },
      { "priority": ["optional", "extra"] }
    ],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": false,
    "deps-repos": ["ubuntu-noble", "ubuntu-noble-security"],
    "verify-checksums": true
  }
}
```

### Security-ориентированная конфигурация

Только пакеты с обновлениями безопасности:

```json
{
  "security-updates": {
    "upstream": "http://security.ubuntu.com/ubuntu",
    "dist": "noble-security",
    "components": ["main", "restricted"],
    "arch": ["amd64"],
    "include": [
      { "name": "openssl", "version-keep": 2 },
      { "name": "libssl.*", "version-keep": 2 },
      { "name": "curl", "version-keep": 2 },
      { "name": "wget", "version-keep": 2 }
    ],
    "exclude": [],
    "allow-unresolved": true
  }
}
```

### Мульти-дистрибутивная конфигурация

Синхронизация нескольких дистрибутивов:

```json
{
  "ubuntu-jammy": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "jammy",
    "components": ["main", "restricted"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" }
    ],
    "allow-unresolved": true
  },
  "ubuntu-noble": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main", "restricted"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" }
    ],
    "allow-unresolved": true
  },
  "debian-bookworm": {
    "upstream": "http://deb.debian.org/debian",
    "dist": "bookworm",
    "components": ["main", "contrib"],
    "arch": ["amd64"],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" }
    ],
    "allow-unresolved": true
  }
}
```

---

## Комбинированные конфигурации

### Полная конфигурация предприятия

```json
{
  "enterprise-core": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main", "restricted", "universe"],
    "arch": ["amd64"],
    "include": [
      { "name": "^nginx$", "version-keep": 2 },
      { "name": "^postgresql-.*", "version-keep": 2 },
      { "name": "^redis-.*", "version-keep": 2 },
      { "name": "^python3$", "version-keep": 1 },
      { "name": "^nodejs$", "version-keep": 2 }
    ],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dbgsym$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" },
      { "name": ".*-docs$" },
      { "priority": ["optional", "extra"] },
      { "section": ["oldlibs", "misc", "debug"] }
    ],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": false,
    "deps-repos": [
      "ubuntu-noble",
      "ubuntu-noble-updates",
      "ubuntu-noble-security"
    ],
    "verify-checksums": true
  }
}
```

### Конфигурация для Docker-образов

Минимальный набор пакетов для создания легких образов:

```json
{
  "docker-base": {
    "upstream": "http://ru.archive.ubuntu.com/ubuntu",
    "dist": "noble",
    "components": ["main"],
    "arch": ["amd64"],
    "include": [
      { "name": "ca-certificates" },
      { "name": "curl" },
      { "name": "wget" },
      { "name": "gnupg" },
      { "name": "apt-transport-https" }
    ],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" },
      { "name": ".*-doc$" },
      { "priority": ["optional", "extra", "standard"] }
    ],
    "allow-unresolved": true
  }
}
```

### Конфигурация для Kubernetes nodes

```json
{
  "k8s-nodes": {
    "upstream": "https://pkgs.k8s.io/core:/stable:/v1.29/deb",
    "dist": "/",
    "components": ["."],
    "arch": ["amd64"],
    "include": [
      { "name": "kubelet", "version-keep": 2 },
      { "name": "kubeadm", "version-keep": 2 },
      { "name": "kubectl", "version-keep": 2 }
    ],
    "exclude": [
      { "name": ".*-dbg$" },
      { "name": ".*-dev$" }
    ],
    "deps": {
      "follow-recommends": false,
      "follow-suggests": false
    },
    "allow-unresolved": false,
    "deps-repos": ["ubuntu-noble"],
    "verify-checksums": true
  }
}
```

---

## Справочник полей конфигурации

### Обязательные поля

| Поле | Тип | Описание |
|------|-----|----------|
| `upstream` | string | URL базового репозитория |
| `dist` | string | Дистрибутив (например, `noble`, `jammy`) |
| `components` | array | Компоненты репозитория (например, `main`, `restricted`) |
| `arch` | array | Архитектуры (например, `amd64`, `arm64`) |

### Опциональные поля

| Поле | Тип | По умолчанию | Описание |
|------|-----|--------------|----------|
| `include` | array | `[]` | Правила включения пакетов |
| `exclude` | array | `[]` | Правила исключения пакетов |
| `deps.follow-recommends` | boolean | `false` | Включать зависимости из Recommends |
| `deps.follow-suggests` | boolean | `false` | Включать зависимости из Suggests |
| `allow-unresolved` | boolean | `true` | Разрешать неразрешенные зависимости |
| `deps-repos` | array | `[]` | Список репозиториев для поиска зависимостей |
| `verify-checksums` | boolean | `false` | Проверять контрольные суммы пакетов |

### Правила include/exclude

Каждое правило может содержать:

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | RegExp шаблон имени пакета |
| `version` | string | RegExp шаблон версии (префикс `r:` для RegExp) |
| `version-keep` | number | Количество последних версий для сохранения |
| `priority` | array | Приоритеты пакетов (`required`, `important`, `standard`, `optional`, `extra`) |
| `section` | array | Секции пакетов (`admin`, `utils`, `libs`, `debug`, и т.д.) |

---

## Полезные RegExp шаблоны

### Имена пакетов

| Шаблон | Описание |
|--------|----------|
| `^nginx$` | Точное совпадение с `nginx` |
| `^python3.*` | Все пакеты, начинающиеся с `python3` |
| `.*-dev$` | Все пакеты, заканчивающиеся на `-dev` |
| `^(lib|perl).*` | Пакеты, начинающиеся с `lib` или `perl` |
| `.*-dbg$` | Отладочные пакеты |

### Версии

| Шаблон | Описание |
|--------|----------|
| `r:^1\.2\..*` | Версии 1.2.x |
| `r:^2\.0\.\d+$` | Версии 2.0.x (только цифры после точки) |
| `r:^(?!.*beta).*$` | Все версии кроме beta |
| `r:.*-ubuntu.*` | Версии с суффиксом ubuntu |

---

## Примечания

1. **Приоритет правил**: Сначала применяются правила `include`, затем `exclude`, затем `version-keep`
2. **RegExp синтаксис**: Для использования регулярных выражений в поле `version` добавьте префикс `r:`
3. **Зависимости**: Для корректного разрешения зависимостей указывайте `deps-repos` с необходимыми репозиториями
4. **Производительность**: Чем больше пакетов обрабатывается, тем дольше синхронизация. Используйте узкие фильтры для оптимизации
