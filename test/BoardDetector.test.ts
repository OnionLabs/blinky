import { describe, expect, it, vi } from 'vitest';
import { BoardDetector } from '../src/board/BoardDetector';

describe('BoardDetector', () => {
  function createMockConnection(stdout: string, stderr = '') {
    return {
      executeRaw: vi.fn().mockResolvedValue({ stdout, stderr }),
    } as any;
  }

  const esp32Profile = {
    id: 'esp32',
    name: 'ESP32',
    usbIds: [],
    platformLabels: { esp32: 'ESP32', esp32s3: 'ESP32-S3' },
  };

  const rp2Profile = {
    id: 'rp2',
    name: 'Raspberry Pi Pico',
    usbIds: [],
    platformLabels: { rp2: 'Raspberry Pi Pico' },
  };

  it('detects ESP32 board info', async () => {
    const detector = new BoardDetector([esp32Profile]);
    const conn = createMockConnection('esp32\n1.23.0\nESP32 module with ESP32\n');
    const info = await detector.detect(conn);

    expect(info.platform).toBe('esp32');
    expect(info.version).toBe('1.23.0');
    expect(info.machine).toBe('ESP32 module with ESP32');
    expect(info.label).toContain('ESP32');
    expect(info.label).toContain('1.23.0');
  });

  it('returns unknown on stderr', async () => {
    const detector = new BoardDetector([]);
    const conn = createMockConnection('', 'Error: something broke');
    const info = await detector.detect(conn);

    expect(info.platform).toBe('unknown');
    expect(info.version).toBe('0.0.0');
    expect(info.machine).toBe('unknown');
    expect(info.label).toBe('MicroPython Board');
  });

  it('handles partial output gracefully', async () => {
    const detector = new BoardDetector([]);
    const conn = createMockConnection('rp2\n');
    const info = await detector.detect(conn);

    expect(info.platform).toBe('rp2');
    // Missing lines get fallback values
    expect(info.version).toBe('0.0.0');
    expect(info.machine).toBe('unknown');
  });

  it('handles empty stdout', async () => {
    const detector = new BoardDetector([]);
    const conn = createMockConnection('\n\n\n');
    const info = await detector.detect(conn);

    expect(info.platform).toBe('unknown');
  });

  it('uses platform label from profiles', async () => {
    const detector = new BoardDetector([rp2Profile]);
    const conn = createMockConnection('rp2\n1.22.0\nRaspberry Pi Pico W\n');
    const info = await detector.detect(conn);

    expect(info.label).toContain('Raspberry Pi Pico');
  });
});
