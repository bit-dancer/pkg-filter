/**
 * Модуль логирования для Debian Package Filter Proxy
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

class Logger {
  private minLevel: LogLevel;
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    const formatted = this.formatEntry(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.log('error', message, context);
  }

  /**
   * Логирование HTTP запроса
   */
  http(method: string, path: string, status: number, durationMs: number, context?: Record<string, unknown>) {
    const logLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    this.log(logLevel, `${method} ${path} ${status} ${durationMs}ms`, {
      method,
      path,
      status,
      durationMs,
      ...context
    });
  }
}

// Экспорт экземпляра по умолчанию
export const logger = new Logger(process.env.LOG_LEVEL as LogLevel || 'info');
