/**
 * Unit tests for paths.ts utility module
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { paths, getConfigPath, getDbPath, normalizePath, validateRepoId } from '../src/utils/paths';

describe('Paths Utility', () => {
  test('should have root path defined', () => {
    expect(paths.root).toBeDefined();
    expect(typeof paths.root).toBe('string');
  });

  test('should have config path defined', () => {
    expect(paths.config).toBeDefined();
    expect(typeof paths.config).toBe('string');
  });

  test('should have dataDir path defined', () => {
    expect(paths.dataDir).toBeDefined();
    expect(typeof paths.dataDir).toBe('string');
  });

  test('should have dbPath defined', () => {
    expect(paths.dbPath).toBeDefined();
    expect(typeof paths.dbPath).toBe('string');
  });

  test('should have reposDir defined', () => {
    expect(paths.reposDir).toBeDefined();
    expect(typeof paths.reposDir).toBe('string');
  });

  test('should have logFile defined', () => {
    expect(paths.logFile).toBeDefined();
    expect(typeof paths.logFile).toBe('string');
  });
});

describe('getConfigPath', () => {
  test('should return config path', () => {
    const configPath = getConfigPath();
    expect(configPath).toBeDefined();
    expect(typeof configPath).toBe('string');
  });
});

describe('getDbPath', () => {
  test('should return database path', () => {
    const dbPath = getDbPath();
    expect(dbPath).toBeDefined();
    expect(typeof dbPath).toBe('string');
  });
});

describe('normalizePath', () => {
  test('should return valid path without slashes', () => {
    const result = normalizePath('pool/main/r/redis/redis-server.deb');
    expect(result).toBe('pool/main/r/redis/redis-server.deb');
  });

  test('should remove leading slashes', () => {
    const result = normalizePath('/pool/main/package.deb');
    expect(result).toBe('pool/main/package.deb');
  });

  test('should throw on directory traversal attempt', () => {
    expect(() => normalizePath('../etc/passwd')).toThrow('Invalid path: directory traversal detected');
  });

  test('should throw on encoded directory traversal', () => {
    expect(() => normalizePath('%2e%2e/etc/passwd')).toThrow('Invalid path: directory traversal detected');
  });

  test('should throw on absolute path with backslash', () => {
    expect(() => normalizePath('path\\to\\file')).toThrow('Invalid path: absolute paths not allowed');
  });

  test('should handle simple filename', () => {
    const result = normalizePath('package.deb');
    expect(result).toBe('package.deb');
  });

  test('should handle path with dots in names', () => {
    const result = normalizePath('pool/main/a/apt/apt_1.0.deb');
    expect(result).toBe('pool/main/a/apt/apt_1.0.deb');
  });
});

describe('validateRepoId', () => {
  test('should accept valid repo ID with letters', () => {
    expect(validateRepoId('ubuntu')).toBe(true);
  });

  test('should accept valid repo ID with numbers', () => {
    expect(validateRepoId('repo123')).toBe(true);
  });

  test('should accept valid repo ID with dash', () => {
    expect(validateRepoId('ubuntu-noble')).toBe(true);
  });

  test('should accept valid repo ID with underscore', () => {
    expect(validateRepoId('my_repo')).toBe(true);
  });

  test('should accept valid repo ID with mixed characters', () => {
    expect(validateRepoId('ubuntu-20_noble')).toBe(true);
  });

  test('should reject repo ID with spaces', () => {
    expect(validateRepoId('ubuntu noble')).toBe(false);
  });

  test('should reject repo ID with special characters', () => {
    expect(validateRepoId('ubuntu@noble')).toBe(false);
  });

  test('should reject repo ID with slashes', () => {
    expect(validateRepoId('ubuntu/noble')).toBe(false);
  });

  test('should reject empty repo ID', () => {
    expect(validateRepoId('')).toBe(false);
  });

  test('should reject repo ID with dots', () => {
    expect(validateRepoId('ubuntu.noble')).toBe(false);
  });
});
