import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

export interface FirmwareVersion {
  /** Version string (e.g. '1.27.0') */
  version: string;
  /** Tag name from GitHub (e.g. 'v1.27.0') */
  tag: string;
  /** ISO date string (e.g. '2025-12-09') */
  date: string;
  /** Whether this is a prerelease */
  prerelease: boolean;
}

export interface BoardMapping {
  /** MicroPython board name (e.g. 'ESP32_GENERIC_S3') */
  board: string;
  /** Human-readable name */
  label: string;
  /** Available firmware variants */
  variants: { id: string; label: string }[];
}

/**
 * Maps espflash chip names to MicroPython board names and available variants.
 */
export const CHIP_BOARD_MAP: Record<string, BoardMapping | undefined> = {
  esp32: {
    board: 'ESP32_GENERIC',
    label: 'ESP32',
    variants: [
      { id: '', label: 'Generic' },
      { id: 'SPIRAM', label: 'SPIRAM / WROVER' },
      { id: 'D2WD', label: 'D2WD (2MB flash)' },
      { id: 'UNICORE', label: 'Unicore (single-core)' },
      { id: 'OTA', label: 'OTA support' },
    ],
  },
  esp32s2: {
    board: 'ESP32_GENERIC_S2',
    label: 'ESP32-S2',
    variants: [
      { id: '', label: 'Generic' },
      { id: 'SPIRAM', label: 'SPIRAM' },
    ],
  },
  esp32s3: {
    board: 'ESP32_GENERIC_S3',
    label: 'ESP32-S3',
    variants: [
      { id: '', label: 'Generic' },
      { id: 'SPIRAM_OCT', label: 'Octal-SPIRAM' },
    ],
  },
  esp32c3: {
    board: 'ESP32_GENERIC_C3',
    label: 'ESP32-C3',
    variants: [{ id: '', label: 'Generic' }],
  },
  esp32c6: {
    board: 'ESP32_GENERIC_C6',
    label: 'ESP32-C6',
    variants: [{ id: '', label: 'Generic' }],
  },
  esp32h2: {
    board: 'ESP32_GENERIC_H2',
    label: 'ESP32-H2',
    variants: [{ id: '', label: 'Generic' }],
  },
};

export type FetchFn = typeof globalThis.fetch;

/**
 * Handles MicroPython firmware version discovery and downloads.
 *
 * Uses the GitHub Releases API to list available versions,
 * then downloads firmware .bin files from micropython.org.
 */
export class FirmwareCatalog {
  private _cacheDir: string;
  private _fetch: FetchFn;

  constructor(cacheDir: string, fetchFn?: FetchFn) {
    this._cacheDir = cacheDir;
    this._fetch = fetchFn ?? globalThis.fetch;
  }

  /**
   * Fetch available MicroPython versions from GitHub releases.
   * Returns stable releases first, prereleases at the bottom.
   */
  async fetchVersions(): Promise<FirmwareVersion[]> {
    const url = 'https://api.github.com/repos/micropython/micropython/releases?per_page=50';
    const response = await this._fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'blinky-vscode',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const releases = (await response.json()) as Array<{
      tag_name: string;
      published_at: string;
      prerelease: boolean;
      draft: boolean;
    }>;

    const versions: FirmwareVersion[] = [];

    for (const rel of releases) {
      if (rel.draft) continue;

      const tag = rel.tag_name;
      const version = tag.startsWith('v') ? tag.slice(1) : tag;
      const date = rel.published_at.split('T')[0];

      versions.push({
        version,
        tag,
        date: date.replace(/-/g, ''),
        prerelease: rel.prerelease,
      });
    }

    // Stable first, prereleases at bottom; within each group, newest first (API default)
    const stable = versions.filter((v) => !v.prerelease);
    const prerelease = versions.filter((v) => v.prerelease);
    return [...stable, ...prerelease];
  }

  /**
   * Build candidate download URLs for a specific firmware.
   *
   * Returns multiple URLs to try - the published_at date from GitHub may
   * differ by ±1 day from the actual build date in the filename.
   *
   * @param board MicroPython board name (e.g. 'ESP32_GENERIC_S3')
   * @param variant Variant ID (e.g. 'SPIRAM_OCT') or empty string for generic
   * @param version Version string (e.g. '1.27.0')
   * @param date Date string YYYYMMDD (e.g. '20251209')
   */
  buildDownloadUrls(board: string, variant: string, version: string, date: string): string[] {
    const variantSuffix = variant ? `-${variant}` : '';
    const base = `https://micropython.org/resources/firmware/${board}${variantSuffix}`;

    // Try exact date, then ±1 day to handle publish vs build date mismatch
    const dates = [date, ...adjacentDates(date)];
    return dates.map((d) => `${base}-${d}-v${version}.bin`);
  }

  /**
   * Download firmware to the cache directory.
   * Returns the local file path. Reuses cached files.
   *
   * @param urls One or more firmware download URLs to try (first success wins)
   * @param onProgress Callback with bytes downloaded so far
   * @returns Absolute path to the downloaded .bin file
   */
  async downloadFirmware(
    urls: string | string[],
    onProgress?: (downloaded: number) => void,
  ): Promise<string> {
    const urlList = Array.isArray(urls) ? urls : [urls];

    // Check cache for any of the candidate URLs
    for (const url of urlList) {
      const filename = url.split('/').pop()!;
      const cached = path.join(this._cacheDir, filename);
      if (fs.existsSync(cached)) return cached;
    }

    // Ensure cache dir exists and clean stale .tmp files
    fs.mkdirSync(this._cacheDir, { recursive: true });
    this._cleanTmpFiles();

    // Try each URL until one succeeds
    let lastError: Error | undefined;
    for (const url of urlList) {
      try {
        return await this._downloadSingle(url, onProgress);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 404 means wrong date - try next URL
        if (lastError.message.includes('HTTP 404')) continue;
        throw lastError;
      }
    }

    throw lastError ?? new Error('No download URLs provided');
  }

  /** Remove stale .tmp files from a previous interrupted download. */
  private _cleanTmpFiles(): void {
    try {
      for (const entry of fs.readdirSync(this._cacheDir)) {
        if (entry.endsWith('.tmp')) {
          try { fs.unlinkSync(path.join(this._cacheDir, entry)); } catch { /* cleanup best-effort */ }
        }
      }
    } catch { /* ignore if dir doesn't exist */ }
  }

  private _downloadSingle(
    url: string,
    onProgress?: (downloaded: number) => void,
  ): Promise<string> {
    const filename = url.split('/').pop()!;
    const destPath = path.join(this._cacheDir, filename);

    return new Promise<string>((resolve, reject) => {
      const follow = (targetUrl: string, redirectCount: number) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const get = targetUrl.startsWith('https') ? https.get : http.get;
        get(targetUrl, { headers: { 'User-Agent': 'blinky-vscode' } }, (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            res.resume(); // Drain response to free socket
            reject(new Error(`Download failed: HTTP ${res.statusCode} for ${targetUrl}`));
            return;
          }

          const tmpPath = destPath + '.tmp';
          const file = fs.createWriteStream(tmpPath);
          let downloaded = 0;

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            onProgress?.(downloaded);
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close(() => {
              // Atomic rename so partial downloads aren't cached
              fs.renameSync(tmpPath, destPath);
              resolve(destPath);
            });
          });

          file.on('error', (err) => {
            try { fs.unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
            reject(err);
          });
        }).on('error', reject);
      };

      follow(url, 0);
    });
  }
}

/**
 * Given a date string YYYYMMDD, return the adjacent dates (day before and after).
 */
export function adjacentDates(date: string): [string, string] {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(4, 6), 10) - 1; // 0-indexed
  const d = parseInt(date.slice(6, 8), 10);
  const base = new Date(Date.UTC(y, m, d));

  const prev = new Date(base);
  prev.setUTCDate(prev.getUTCDate() - 1);

  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + 1);

  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;

  return [fmt(prev), fmt(next)];
}
