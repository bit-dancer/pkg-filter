/**
 * Модуль логирования для Debian Package Filter Proxy
 */

import { paths } from './paths';
import * as fs from 'fs';
import * as path from 'path';

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

// Флаг: выводить ли обычные логи в stdout (по умолчанию false)
let logToStdout = false;

class Logger {
  private minLevel: LogLevel;
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  private logStream: fs.WriteStream | null = null;
  private logFilePath: string | null = null;

  constructor(minLevel: LogLevel = 'info', logFilePath?: string) {
    this.minLevel = minLevel;
    if (logFilePath) {
      this.logFilePath = logFilePath;
    }
    this.initLogFile();
  }

  /**
   * Установить путь к файлу лога (вызывается после загрузки конфига)
   */
  setLogFilePath(filePath: string) {
    this.logFilePath = filePath;
    this.initLogFile();
  }

  /**
   * Включить/выключить вывод логов в stdout
   */
  setStdoutEnabled(enabled: boolean) {
    logToStdout = enabled;
  }

  private async initLogFile() {
    try {
      // Использовать путь из конфига если задан, иначе путь по умолчанию
      const logPath = this.logFilePath || paths.logFile;

      // Убедиться, что директория существует
      const logDir = path.dirname(logPath);
      if (logDir && !fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
    } catch (error) {
      console.error(`Failed to initialize log file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeToFile(formatted: string) {
    if (this.logStream) {
      try {
        this.logStream.write(formatted + '\n');
      } catch (error) {
        console.error(`Failed to write to log file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
  }

  /**
   * Вывод в stdout только для системных событий (инициализация, остановка)
   */
  private logToConsole(level: LogLevel, formatted: string, isSystemEvent: boolean = false) {
    // Вывод в stdout только если включен флаг logToStdout или это системное событие
    if (!logToStdout && !isSystemEvent) {
      return;
    }
    
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

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, isSystemEvent: boolean = false) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    const formatted = this.formatEntry(entry);

    // Вывод в stdout только если включен флаг logToStdout или это системное событие
    this.logToConsole(level, formatted, isSystemEvent);

    // Асинхронно записать в файл лога
    this.writeToFile(formatted);
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>, isSystemEvent: boolean = false) {
    this.log('info', message, context, isSystemEvent);
  }

  warn(message: string, context?: Record<string, unknown>, isSystemEvent: boolean = false) {
    this.log('warn', message, context, isSystemEvent);
  }

  error(message: string, context?: Record<string, unknown>, isSystemEvent: boolean = false) {
    this.log('error', message, context, isSystemEvent);
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

// Экспорт экземпляра по умолчанию (будет настроен через setLogFilePath после загрузки конфига)
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

export { Logger };
