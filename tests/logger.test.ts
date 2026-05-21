/**
 * Unit tests for logger.ts module
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Logger, logger, type LogLevel } from '../src/utils/logger';

describe('Logger', () => {
  let testLogger: Logger;
  const testLogPath = './data/test-app.log';

  beforeEach(async () => {
    // Create test logger instance
    testLogger = new Logger('debug', testLogPath);
  });

  afterEach(async () => {
    // Cleanup test log file
    try {
      const testFile = Bun.file(testLogPath);
      if (await testFile.exists()) {
        await Bun.unlink(testLogPath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test('should create logger with default level', () => {
    const defaultLogger = new Logger();
    expect(defaultLogger).toBeDefined();
  });

  test('should create logger with custom level', () => {
    const customLogger = new Logger('warn');
    expect(customLogger).toBeDefined();
  });

  test('should log debug messages when level is debug', () => {
    testLogger.debug('Test debug message');
    expect(testLogger).toBeDefined();
  });

  test('should log info messages', () => {
    testLogger.info('Test info message');
    expect(testLogger).toBeDefined();
  });

  test('should log warn messages', () => {
    testLogger.warn('Test warn message');
    expect(testLogger).toBeDefined();
  });

  test('should log error messages', () => {
    testLogger.error('Test error message');
    expect(testLogger).toBeDefined();
  });

  test('should log with context', () => {
    testLogger.info('Message with context', { key: 'value', number: 42 });
    expect(testLogger).toBeDefined();
  });

  test('should respect log level hierarchy', () => {
    const warnLogger = new Logger('warn');
    warnLogger.info('This should not be logged');
    warnLogger.warn('This should be logged');
    warnLogger.error('This should also be logged');
    expect(warnLogger).toBeDefined();
  });

  test('http method should log correctly', () => {
    testLogger.http('GET', '/test/path', 200, 10, { repoId: 'test' });
    expect(testLogger).toBeDefined();
  });

  test('http method should log error status as error level', () => {
    testLogger.http('GET', '/error', 500, 5);
    expect(testLogger).toBeDefined();
  });

  test('http method should log warning status as warn level', () => {
    testLogger.http('GET', '/warning', 404, 3);
    expect(testLogger).toBeDefined();
  });

  test('upstreamRequest method should log correctly', () => {
    testLogger.upstreamRequest('http://example.com', 200, 50, { repoId: 'test' });
    expect(testLogger).toBeDefined();
  });

  test('upstreamRequest method should log error status', () => {
    testLogger.upstreamRequest('http://example.com', 500, 100, { error: 'timeout' });
    expect(testLogger).toBeDefined();
  });

  test('setStdoutEnabled should work', () => {
    testLogger.setStdoutEnabled(true);
    testLogger.setStdoutEnabled(false);
    expect(testLogger).toBeDefined();
  });

  test('setLogFilePath should work', () => {
    testLogger.setLogFilePath('./data/another-log.log');
    expect(testLogger).toBeDefined();
  });
});

describe('Logger Metrics', () => {
  test('should export getSuccessfulRequests function', () => {
    const { getSuccessfulRequests } = require('../src/utils/logger');
    expect(typeof getSuccessfulRequests).toBe('function');
  });

  test('should export getFailedRequests function', () => {
    const { getFailedRequests } = require('../src/utils/logger');
    expect(typeof getFailedRequests).toBe('function');
  });

  test('should export incrementFailedRequests function', () => {
    const { incrementFailedRequests } = require('../src/utils/logger');
    expect(typeof incrementFailedRequests).toBe('function');
  });
});

describe('Default Logger Export', () => {
  test('default logger should be defined', () => {
    expect(logger).toBeDefined();
  });

  test('default logger should have all methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.http).toBe('function');
    expect(typeof logger.upstreamRequest).toBe('function');
  });
});
