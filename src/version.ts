/**
 * Version of the application
 * Updated automatically or manually to reflect current release
 */
export const VERSION = '2.1.0';

/**
 * Build metadata (optional, can be filled by CI/CD)
 */
export const BUILD_DATE = new Date().toISOString();

/**
 * Get full version string
 */
export function getVersion(): string {
  return `v${VERSION}`;
}

/**
 * Get detailed version info
 */
export function getVersionInfo(): { version: string; buildDate: string } {
  return {
    version: getVersion(),
    buildDate: BUILD_DATE
  };
}
