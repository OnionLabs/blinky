import { describe, expect, it, vi } from 'vitest';
import { adjacentDates, CHIP_BOARD_MAP, FirmwareCatalog } from '../src/flash/FirmwareCatalog';

function createMockFetch(responseData: any, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => responseData,
  }) as any;
}

const sampleReleases = [
  {
    tag_name: 'v1.27.0',
    published_at: '2025-12-09T12:00:00Z',
    prerelease: false,
    draft: false,
  },
  {
    tag_name: 'v1.26.1',
    published_at: '2025-09-11T12:00:00Z',
    prerelease: false,
    draft: false,
  },
  {
    tag_name: 'v1.28.0-preview.1',
    published_at: '2026-03-20T12:00:00Z',
    prerelease: true,
    draft: false,
  },
  {
    tag_name: 'v1.25.0-draft',
    published_at: '2025-04-01T12:00:00Z',
    prerelease: false,
    draft: true,
  },
];

describe('CHIP_BOARD_MAP', () => {
  it('maps esp32 to ESP32_GENERIC', () => {
    const mapping = CHIP_BOARD_MAP['esp32'];
    expect(mapping?.board).toBe('ESP32_GENERIC');
    expect(mapping?.variants.length).toBeGreaterThanOrEqual(2);
  });

  it('maps esp32s3 to ESP32_GENERIC_S3', () => {
    const mapping = CHIP_BOARD_MAP['esp32s3'];
    expect(mapping?.board).toBe('ESP32_GENERIC_S3');
  });

  it('maps esp32c3 to ESP32_GENERIC_C3', () => {
    const mapping = CHIP_BOARD_MAP['esp32c3'];
    expect(mapping?.board).toBe('ESP32_GENERIC_C3');
  });

  it('returns undefined for unknown chips', () => {
    expect(CHIP_BOARD_MAP['rp2040']).toBeUndefined();
  });

  it('every mapping has at least a Generic variant', () => {
    for (const [chip, mapping] of Object.entries(CHIP_BOARD_MAP)) {
      expect(mapping, `${chip} should have mapping`).toBeDefined();
      expect(mapping!.variants[0].id, `${chip} first variant should be Generic`).toBe('');
      expect(mapping!.variants[0].label).toBe('Generic');
    }
  });
});

describe('FirmwareCatalog', () => {
  describe('fetchVersions', () => {
    it('fetches and sorts versions - stable first, prereleases last', async () => {
      const mockFetch = createMockFetch(sampleReleases);
      const catalog = new FirmwareCatalog('/tmp/cache', mockFetch);

      const versions = await catalog.fetchVersions();

      // Draft should be filtered out
      expect(versions).toHaveLength(3);

      // Stable first
      expect(versions[0].version).toBe('1.27.0');
      expect(versions[0].prerelease).toBe(false);
      expect(versions[1].version).toBe('1.26.1');
      expect(versions[1].prerelease).toBe(false);

      // Prerelease last
      expect(versions[2].version).toBe('1.28.0-preview.1');
      expect(versions[2].prerelease).toBe(true);
    });

    it('formats date as YYYYMMDD', async () => {
      const mockFetch = createMockFetch(sampleReleases);
      const catalog = new FirmwareCatalog('/tmp/cache', mockFetch);

      const versions = await catalog.fetchVersions();
      expect(versions[0].date).toBe('20251209');
    });

    it('strips v prefix from version', async () => {
      const mockFetch = createMockFetch(sampleReleases);
      const catalog = new FirmwareCatalog('/tmp/cache', mockFetch);

      const versions = await catalog.fetchVersions();
      expect(versions[0].tag).toBe('v1.27.0');
      expect(versions[0].version).toBe('1.27.0');
    });

    it('throws on API error', async () => {
      const mockFetch = createMockFetch(null, 403);
      const catalog = new FirmwareCatalog('/tmp/cache', mockFetch);

      await expect(catalog.fetchVersions()).rejects.toThrow('GitHub API error: 403');
    });

    it('sends correct headers', async () => {
      const mockFetch = createMockFetch([]);
      const catalog = new FirmwareCatalog('/tmp/cache', mockFetch);

      await catalog.fetchVersions();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.github+json',
            'User-Agent': 'blinky-vscode',
          }),
          signal: expect.anything(),
        }),
      );
    });
  });

  describe('buildDownloadUrls', () => {
    it('builds primary URL for generic variant', () => {
      const catalog = new FirmwareCatalog('/tmp/cache');
      const urls = catalog.buildDownloadUrls('ESP32_GENERIC', '', '1.27.0', '20251209');
      expect(urls[0]).toBe('https://micropython.org/resources/firmware/ESP32_GENERIC-20251209-v1.27.0.bin');
    });

    it('builds URL with variant', () => {
      const catalog = new FirmwareCatalog('/tmp/cache');
      const urls = catalog.buildDownloadUrls('ESP32_GENERIC', 'SPIRAM', '1.27.0', '20251209');
      expect(urls[0]).toBe('https://micropython.org/resources/firmware/ESP32_GENERIC-SPIRAM-20251209-v1.27.0.bin');
    });

    it('builds URL for S3 with SPIRAM_OCT', () => {
      const catalog = new FirmwareCatalog('/tmp/cache');
      const urls = catalog.buildDownloadUrls('ESP32_GENERIC_S3', 'SPIRAM_OCT', '1.27.0', '20251209');
      expect(urls[0]).toBe('https://micropython.org/resources/firmware/ESP32_GENERIC_S3-SPIRAM_OCT-20251209-v1.27.0.bin');
    });

    it('returns 3 URLs: exact date, day before, day after', () => {
      const catalog = new FirmwareCatalog('/tmp/cache');
      const urls = catalog.buildDownloadUrls('ESP32_GENERIC', '', '1.27.0', '20251209');
      expect(urls).toHaveLength(3);
      expect(urls[0]).toContain('20251209');
      expect(urls[1]).toContain('20251208');
      expect(urls[2]).toContain('20251210');
    });
  });
});

describe('adjacentDates', () => {
  it('returns day before and after', () => {
    expect(adjacentDates('20251209')).toEqual(['20251208', '20251210']);
  });

  it('handles month boundary', () => {
    expect(adjacentDates('20251201')).toEqual(['20251130', '20251202']);
  });

  it('handles year boundary', () => {
    expect(adjacentDates('20260101')).toEqual(['20251231', '20260102']);
  });

  it('handles end of month', () => {
    expect(adjacentDates('20250131')).toEqual(['20250130', '20250201']);
  });
});
