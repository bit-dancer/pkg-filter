/**
 * Парсер формата Debian Packages
 * Формат: http://www.debian.org/doc/debian-policy/ch-controlfields.html#s-f-records
 */

export interface PackageRecord {
  Package: string;
  Version: string;
  Architecture?: string;
  Maintainer?: string;
  Depends?: string;
  PreDepends?: string;
  Recommends?: string;
  Suggests?: string;
  Priority?: string;
  Section?: string;
  InstalledSize?: string;
  MD5sum?: string;
  SHA256?: string;
  Filename?: string;
  Size?: string;
  Description?: string;
  [key: string]: string | undefined;
}

/**
 * Парсит содержимое файла Packages (текстовый формат)
 * Возвращает массив записей пакетов
 */
export function parsePackages(content: string): PackageRecord[] {
  const packages: PackageRecord[] = [];
  let currentPackage: PackageRecord | null = null;
  
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Пустая строка означает конец записи пакета
    if (line.trim() === '') {
      if (currentPackage !== null && Object.keys(currentPackage).length > 0) {
        packages.push(currentPackage);
        currentPackage = null;
      }
      continue;
    }
    
    // Продолжение многострочного поля (начинается с пробела)
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (currentPackage !== null) {
        // Найти последнее добавленное поле и добавить к нему значение
        const lastField = Object.keys(currentPackage).pop();
        if (lastField) {
          currentPackage[lastField] += '\n' + line.slice(1);
        }
      }
      continue;
    }
    
    // Новое поле (формат "Key: Value")
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      
      if (currentPackage === null) {
        currentPackage = {};
      }
      currentPackage[key] = value;
    }
  }
  
  // Добавить последний пакет, если он есть
  if (currentPackage !== null && Object.keys(currentPackage).length > 0) {
    packages.push(currentPackage);
  }
  
  return packages;
}

/**
 * Сериализует массив записей пакетов обратно в текстовый формат
 */
export function serializePackages(packages: PackageRecord[]): string {
  return packages.map(pkg => {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(pkg)) {
      // Разбить длинные строки на несколько строк (продолжение с пробелом)
      if (value !== undefined) {
        const valueLines = value.split('\n');
        lines.push(`${key}: ${valueLines[0]}`);
        for (let i = 1; i < valueLines.length; i++) {
          lines.push(` ${valueLines[i]}`);
        }
      }
    }
    return lines.join('\n');
  }).join('\n\n') + '\n';
}
