/**
 * Менеджер кэширования Package файлов
 * 
 * Особенности:
 * - Файлы кешируются в data/cache с именем {repo_id}_{sync_datetime}.{ext}
 * - Во время синхронизации файлы записываются с префиксом "_"
 * - После успешной синхронизации префикс убирается атомарно
 * - Хранится только N последних версий файлов и N часов
 * - Клиенты получают файлы только из завершенных синхронизаций
 */

import { join } from 'path';
import * as fs from 'fs';
import { paths, validateRepoId } from './paths';

export interface CacheFileInfo {
  filename: string;
  datetime: Date;
  size: number;
  isComplete: boolean;
}

export class CacheManager {
  private cacheDir: string;
  private maxFiles: number;
  private maxAgeHours: number;

  constructor(maxFiles: number = 5, maxAgeHours: number = 24) {
    this.cacheDir = join(paths.dataDir, 'cache');
    this.maxFiles = maxFiles;
    this.maxAgeHours = maxAgeHours;
    
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      // Создать .gitkeep для отслеживания директории в git
      fs.writeFileSync(join(this.cacheDir, '.gitkeep'), '');
    }
  }

  getTempFilename(repoId: string, datetime: Date, ext: string): string {
    const timestamp = datetime.toISOString().replace(/[:.]/g, '-');
    return `_${repoId}_${timestamp}.${ext}`;
  }

  getFinalFilename(repoId: string, datetime: Date, ext: string): string {
    const timestamp = datetime.toISOString().replace(/[:.]/g, '-');
    return `${repoId}_${timestamp}.${ext}`;
  }

  getTempPath(repoId: string, datetime: Date, ext: string): string {
    return join(this.cacheDir, this.getTempFilename(repoId, datetime, ext));
  }

  getFinalPath(repoId: string, datetime: Date, ext: string): string {
    return join(this.cacheDir, this.getFinalFilename(repoId, datetime, ext));
  }

  async finalizeSync(repoId: string, datetime: Date, ext: string): Promise<boolean> {
    const tempPath = this.getTempPath(repoId, datetime, ext);
    const finalPath = this.getFinalPath(repoId, datetime, ext);

    try {
      if (!fs.existsSync(tempPath)) {
        console.error(`Cache: Temp file not found: ${tempPath}`);
        return false;
      }

      // Атомарно переименовать файл (копировать + удалить старый)
      await fs.promises.copyFile(tempPath, finalPath);
      await fs.promises.unlink(tempPath);
      
      console.log(`Cache: Finalized sync file for ${repoId}: ${finalPath}`);
      await this.cleanup(repoId);
      
      return true;
    } catch (error) {
      console.error(`Cache: Failed to finalize sync: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  getLatestFilePath(repoId: string, ext: string): string | null {
    if (!validateRepoId(repoId)) {
      return null;
    }

    try {
      const files = this.getCompletedFiles(repoId, ext);
      if (files.length === 0 || !files[0]) return null;
      return join(this.cacheDir, files[0].filename);
    } catch (error) {
      console.error(`Cache: Failed to get latest file: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  getCompletedFiles(repoId: string, ext: string): CacheFileInfo[] {
    const files: CacheFileInfo[] = [];
    
    try {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isFile()) continue;
        if (!entry.name.startsWith('_')) {
          const pattern = new RegExp(`^${repoId}_([\\d]{4}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{3})\\.${ext}$`);
          const match = entry.name.match(pattern);
          
          if (match) {
            const timestampStr = match[1]!;
            const datetime = new Date(timestampStr.replace(/-/g, (m, i) => i === 19 ? '.' : i === 16 ? '-' : ':').replace(',', '.'));
            const filePath = join(this.cacheDir, entry.name);
            const stat = fs.statSync(filePath);
            
            files.push({ filename: entry.name, datetime, size: stat.size, isComplete: true });
          }
        }
      }
      
      files.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());
      return files;
    } catch (error) {
      console.error(`Cache: Failed to list completed files: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  getTempFiles(repoId: string, ext: string): CacheFileInfo[] {
    const files: CacheFileInfo[] = [];
    
    try {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isFile()) continue;
        if (entry.name.startsWith('_')) {
          const pattern = new RegExp(`^_(${repoId})_([\\d]{4}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{3})\\.${ext}$`);
          const match = entry.name.match(pattern);
          
          if (match) {
            const timestampStr = match[2]!;
            const datetime = new Date(timestampStr.replace(/-/g, (m, i) => i === 19 ? '.' : i === 16 ? '-' : ':').replace(',', '.'));
            const filePath = join(this.cacheDir, entry.name);
            const stat = fs.statSync(filePath);
            
            files.push({ filename: entry.name, datetime, size: stat.size, isComplete: false });
          }
        }
      }
      
      return files;
    } catch (error) {
      console.error(`Cache: Failed to list temp files: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async cleanup(repoId?: string): Promise<{ deleted: number; kept: number }> {
    const now = Date.now();
    const maxAgeMs = this.maxAgeHours * 60 * 60 * 1000;
    let deleted = 0;
    let kept = 0;

    try {
      const files = repoId ? this.getCompletedFiles(repoId, 'gz') : this.getAllCompletedFiles('gz');

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const age = now - file.datetime.getTime();
        
        const shouldDeleteByAge = age > maxAgeMs;
        const shouldDeleteByCount = repoId !== undefined && i >= this.maxFiles;

        if (shouldDeleteByAge || shouldDeleteByCount) {
          const filePath = join(this.cacheDir, file.filename);
          try {
            await fs.promises.unlink(filePath);
            console.log(`Cache: Deleted old file: ${file.filename}`);
            deleted++;
          } catch (e) {
            console.error(`Cache: Failed to delete ${file.filename}: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          kept++;
        }
      }

      const tempFiles = repoId ? this.getTempFiles(repoId, 'gz') : this.getAllTempFiles('gz');
      
      for (const tempFile of tempFiles) {
        const age = now - tempFile.datetime.getTime();
        if (age > 60 * 60 * 1000) {
          const filePath = join(this.cacheDir, tempFile.filename);
          try {
            await fs.promises.unlink(filePath);
            console.log(`Cache: Deleted stale temp file: ${tempFile.filename}`);
            deleted++;
          } catch (e) {
            console.error(`Cache: Failed to delete temp ${tempFile.filename}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      return { deleted, kept };
    } catch (error) {
      console.error(`Cache: Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      return { deleted, kept };
    }
  }

  private getAllCompletedFiles(ext: string): CacheFileInfo[] {
    const files: CacheFileInfo[] = [];
    
    try {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isFile() || entry.name.startsWith('_')) continue;

        const pattern = new RegExp(`^([a-zA-Z0-9_-]+)_([\\d]{4}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{3})\\.${ext}$`);
        const match = entry.name.match(pattern);
        
        if (match) {
          const timestampStr = match[2]!;
          const datetime = new Date(timestampStr.replace(/-/g, (m, i) => i === 19 ? '.' : i === 16 ? '-' : ':').replace(',', '.'));
          const filePath = join(this.cacheDir, entry.name);
          const stat = fs.statSync(filePath);
          
          files.push({ filename: entry.name, datetime, size: stat.size, isComplete: true });
        }
      }
      
      files.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());
      return files;
    } catch (error) {
      console.error(`Cache: Failed to list all completed files: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private getAllTempFiles(ext: string): CacheFileInfo[] {
    const files: CacheFileInfo[] = [];
    
    try {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isFile() || !entry.name.startsWith('_')) continue;

        const pattern = new RegExp(`^_([a-zA-Z0-9_-]+)_([\\d]{4}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{2}-[\\d]{3})\\.${ext}$`);
        const match = entry.name.match(pattern);
        
        if (match) {
          const timestampStr = match[2]!;
          const datetime = new Date(timestampStr.replace(/-/g, (m, i) => i === 19 ? '.' : i === 16 ? '-' : ':').replace(',', '.'));
          const filePath = join(this.cacheDir, entry.name);
          const stat = fs.statSync(filePath);
          
          files.push({ filename: entry.name, datetime, size: stat.size, isComplete: false });
        }
      }
      
      return files;
    } catch (error) {
      console.error(`Cache: Failed to list all temp files: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async writeToTemp(data: Uint8Array | string, repoId: string, datetime: Date, ext: string): Promise<string | null> {
    const tempPath = this.getTempPath(repoId, datetime, ext);
    
    try {
      await fs.promises.writeFile(tempPath, data);
      return tempPath;
    } catch (error) {
      console.error(`Cache: Failed to write temp file: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async cancelSync(repoId: string, datetime: Date, ext: string): Promise<boolean> {
    const tempPath = this.getTempPath(repoId, datetime, ext);
    
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
        console.log(`Cache: Cancelled sync for ${repoId}, deleted temp file`);
      }
      return true;
    } catch (error) {
      console.error(`Cache: Failed to cancel sync: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  getStats(): { totalFiles: number; totalSize: number; tempFiles: number } {
    let totalFiles = 0;
    let totalSize = 0;
    let tempFiles = 0;

    try {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isFile()) continue;

        const filePath = join(this.cacheDir, entry.name);
        const stat = fs.statSync(filePath);
        
        totalFiles++;
        totalSize += stat.size;
        
        if (entry.name.startsWith('_')) tempFiles++;
      }
      
      return { totalFiles, totalSize, tempFiles };
    } catch (error) {
      console.error(`Cache: Failed to get stats: ${error instanceof Error ? error.message : String(error)}`);
      return { totalFiles: 0, totalSize: 0, tempFiles: 0 };
    }
  }
}
