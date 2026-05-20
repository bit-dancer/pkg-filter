/**
 * Debian Package Filter Proxy - Точка входа
 * 
 * Оптимизировано для работы на слабом железе (2 ядра, 1 Гб ОЗУ)
 * с большим количеством пакетов (20 репозиториев по 60 тысяч пакетов)
 */

import { initApp, repoManager } from './src/server';

// Запуск приложения
async function main() {
  try {
    await initApp();
    console.log('Application started successfully');
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('Shutting down...');
      repoManager.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('Shutting down...');
      repoManager.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start application:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
