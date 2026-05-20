export interface Dependency {
  name: string;
  versionOp?: string; // '=', '>=', '<<', etc.
  version?: string;
  orGroup: number; // ID группы OR (пакеты с одинаковым ID разделены '|')
}

/**
 * Parses a dependency string like "pkg1 (>= 1.0), pkg2 | pkg3"
 * Returns a flat list of dependencies with OR group IDs.
 */
export function parseDependencies(depStr: string): Dependency[] {
  if (!depStr || depStr.trim() === "") return [];

  const deps: Dependency[] = [];
  let orGroup = 0;

  // Split by comma to get main blocks
  const blocks = depStr.split(',');

  for (const block of blocks) {
    const parts = block.split('|').map(s => s.trim());

    // If multiple parts, they belong to the same OR group
    const currentOrGroup = parts.length > 1 ? ++orGroup : 0;

    for (const part of parts) {
      const dep = parseSingleDependency(part);
      if (dep) {
        dep.orGroup = parts.length > 1 ? currentOrGroup : 0;
        deps.push(dep);
      }
    }
  }

  return deps;
}

function parseSingleDependency(str: string): Dependency | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  // Regex to match: Name [ (Op Version) ]
  // Handles spaces around operators loosely
  const match = trimmed.match(/^([a-zA-Z0-9.+\-]+)\s*(?:\(\s*([><=]+)\s*([^)]+)\))?$/);

  if (!match) {
    // Fallback for complex cases or strict parsing failure
    // Just return name if version part is malformed
    const nameMatch = trimmed.match(/^([a-zA-Z0-9.+\-]+)/);
    if (nameMatch) {
      return { name: nameMatch[1], orGroup: 0 };
    }
    return null;
  }

  return {
    name: match[1],
    versionOp: match[2],
    version: match[3],
    orGroup: 0 // Will be set by caller
  };
}

/**
 * Checks if a version satisfies a constraint
 */
export function satisfiesConstraint(version: string, op: string, target: string): boolean {
  const cmp = compareVersions(version, target);

  switch (op) {
    case '=': return cmp === 0;
    case '==': return cmp === 0;
    case '<=': return cmp <= 0;
    case '>=': return cmp >= 0;
    case '<': return cmp < 0;
    case '<<': return cmp < 0; // Strict less
    case '>': return cmp > 0;
    case '>>': return cmp > 0; // Strict greater
    default: return true; // Unknown op, assume match
  }
}

// Import compareVersions from the sibling file
import { compareVersions } from './debian-version';