import { describe, expect, it } from 'vitest';
import { BoardProfile, matchUsbId, platformLabel } from '../src/board/BoardProfile';
import { esp32Profile } from '../src/board/profiles';

const rp2Profile: BoardProfile = {
  id: 'rp2040',
  name: 'RP2040',
  usbIds: [
    { vid: '2e8a', pid: '0005', description: 'Raspberry Pi Pico' },
  ],
  platformLabels: { rp2: 'RP2040' },
};

describe('BoardProfile', () => {
  describe('matchUsbId', () => {
    it('matches ESP32 CP2102', () => {
      const result = matchUsbId([esp32Profile], '10c4', 'ea60');
      expect(result).toBeDefined();
      expect(result!.profile.id).toBe('esp32');
      expect(result!.usbId.description).toContain('CP210x');
    });

    it('matches across multiple profiles', () => {
      const result = matchUsbId([esp32Profile, rp2Profile], '2e8a', '0005');
      expect(result).toBeDefined();
      expect(result!.profile.id).toBe('rp2040');
    });

    it('returns undefined for unknown VID/PID', () => {
      expect(matchUsbId([esp32Profile], 'ffff', '0000')).toBeUndefined();
    });

    it('returns undefined with no profiles', () => {
      expect(matchUsbId([], '10c4', 'ea60')).toBeUndefined();
    });
  });

  describe('platformLabel', () => {
    it('resolves known platform from ESP32 profile', () => {
      expect(platformLabel([esp32Profile], 'esp32')).toBe('ESP32');
      expect(platformLabel([esp32Profile], 'esp32s3')).toBe('ESP32-S3');
    });

    it('resolves across multiple profiles', () => {
      expect(platformLabel([esp32Profile, rp2Profile], 'rp2')).toBe('RP2040');
    });

    it('falls back to uppercased name for unknown platform', () => {
      expect(platformLabel([esp32Profile], 'stm32')).toBe('STM32');
    });

    it('falls back with empty profiles', () => {
      expect(platformLabel([], 'esp32')).toBe('ESP32');
    });
  });
});
