/**
 * Утилиты для работы с путями
 * Централизованное управление путями к файлам
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Получаем директорию проекта (WORKDIR)
const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname это /workspace/src/utils, нужно подняться на 2 уровня вверх до WORKDIR
const ROOT_DIR = join(__dirname, '..', '..');

/**
 * Конфигурация путей
 */
export const paths = {
  root: ROOT_DIR,
  config: process.env.CONFIG_PATH || join(ROOT_DIR, 'config.json'),
  dataDir: process.env.DATA_DIR || join(ROOT_DIR, 'data'),
  dbPath: process.env.DB_PATH || join(ROOT_DIR, 'data', 'packages.db'),
  reposDir: process.env.REPOS_DIR || join(ROOT_DIR, 'config', 'repos'),
  logFile: process.env.LOG_FILE || join(ROOT_DIR, 'data', 'app.log'),
};

/**
 * Получить абсолютный путь к конфигурации
 */
export function getConfigPath(): string {
  return paths.config;
}

/**
 * Получить абсолютный путь к базе данных
 */
export function getDbPath(): string {
  return paths.dbPath;
}

/**
 * Нормализовать путь (защита от directory traversal)
 */
export function normalizePath(inputPath: string): string {
  try {
    // Decode URL encoding для защиты от %2e%2e атак
    const decoded = decodeURIComponent(inputPath);
    
    // Отклонить если содержит ..
    if (decoded.includes('..')) {
      throw new Error('Invalid path: directory traversal detected');
    }
    
    // Удалить начальные слеши
    const sanitized = decoded.replace(/^\/+/, '');
    
    // Дополнительная проверка на абсолютные пути
    if (sanitized.startsWith('/') || sanitized.includes('\\')) {
      throw new Error('Invalid path: absolute paths not allowed');
    }
    
    return sanitized;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid path')) {
      throw error;
    }
    // Если decodeURIComponent упал (невалидный URL encoding)
    const err = new Error('Invalid path: malformed URL encoding');
    err.cause = error;
    throw err;
  }
}

/**
 * Валидировать ID репозитория (защита от инъекций)
 */
export function validateRepoId(repoId: string): boolean {
  // Разрешены только буквы, цифры, дефис и подчеркивание
  const repoIdRegex = /^[a-zA-Z0-9_-]+$/;
  return repoIdRegex.test(repoId);
}
