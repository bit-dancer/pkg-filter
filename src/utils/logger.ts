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

// Глобальные метрики HTTP запросов
let successfulRequests = 0;
let failedRequests = 0;

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
   * Логирование HTTP запроса с расширенной информацией
   */
  http(
    method: string, 
    path: string, 
    status: number, 
    durationMs: number, 
    context?: { 
      repoId?: string;
      repoCount?: number;
      total?: number;
      gzipped?: boolean;
      packageCount?: number;
      logCount?: number;
      redirectUrl?: string;
      remoteAddress?: string;
      userAgent?: string;
      responseSize?: number;
    }
  ) {
    const logLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    this.log(logLevel, `${method} ${path} ${status} ${durationMs}ms`, {
      method,
      path,
      status,
      durationMs,
      ...context
    });
    
    // Обновить счетчики метрик
    if (status >= 500) {
      failedRequests++;
    } else {
      successfulRequests++;
    }
  }
  
  /**
   * Логирование HTTP запроса к upstream (синхронизация)
   */
  upstreamRequest(
    url: string,
    status: number,
    durationMs: number,
    context?: {
      repoId?: string;
      component?: string;
      arch?: string;
      proxy?: string;
      timeout?: number;
      error?: string;
    }
  ) {
    const logLevel = status >= 500 || !status ? 'error' : status >= 400 ? 'warn' : 'debug';
    this.log(logLevel, `UPSTREAM ${url} ${status || 'ERROR'} ${durationMs}ms`, {
      url,
      status,
      durationMs,
      ...context
    });
  }
}

// Экспорт экземпляра по умолчанию
export const logger = new Logger(process.env.LOG_LEVEL as LogLevel || 'info');

// Экспорт функций для получения метрик
export function getSuccessfulRequests(): number {
  return successfulRequests;
}

export function getFailedRequests(): number {
  return failedRequests;
}

export function incrementFailedRequests(): void {
  failedRequests++;
}
