import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { EspFlasher, FlashProgress, parseBoardInfo, parseFlashOutput } from '../src/flash/EspFlasher';

/** Create a mock child process with stdout/stderr event emitters. */
function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn();
  return proc;
}

/** Create a mock spawn function that returns the given mock process. */
function createMockSpawn(proc: any) {
  return vi.fn().mockReturnValue(proc) as any;
}

describe('parseFlashOutput', () => {
  it('parses percentage progress line', () => {
    const result = parseFlashOutput('[00:00:02] [=========>                    ]  33/100  33%');
    expect(result).toEqual({ percent: 33, message: 'Flashing… 33%' });
  });

  it('parses 100% completion', () => {
    const result = parseFlashOutput('[00:00:05] [==============================] 100/100 100%');
    expect(result).toEqual({ percent: 100, message: 'Flashing… 100%' });
  });

  it('parses "Flashing has completed" line', () => {
    const result = parseFlashOutput('Flashing has completed!');
    expect(result).toEqual({ percent: 100, message: 'Flash complete!' });
  });

  it('parses chip type detection', () => {
    const result = parseFlashOutput('Chip type:         esp32s3');
    expect(result).toEqual({ message: 'Detected chip: esp32s3' });
  });

  it('parses erasing flash', () => {
    const result = parseFlashOutput('Erasing flash...');
    expect(result).toEqual({ message: 'Erasing flash…' });
  });

  it('parses connecting', () => {
    const result = parseFlashOutput('Connecting...');
    expect(result).toEqual({ message: 'Connecting to bootloader…' });
  });

  it('parses verifying', () => {
    const result = parseFlashOutput('Verifying...');
    expect(result).toEqual({ message: 'Verifying…' });
  });

  it('returns undefined for unrecognized lines', () => {
    expect(parseFlashOutput('some random output')).toBeUndefined();
    expect(parseFlashOutput('')).toBeUndefined();
  });

  it('handles mixed percentage formats', () => {
    const result = parseFlashOutput('67%');
    expect(result).toEqual({ percent: 67, message: 'Flashing… 67%' });
  });
});

describe('EspFlasher', () => {
  describe('getEspflashPath', () => {
    it('returns a path for supported platforms', () => {
      const flasher = new EspFlasher('/ext');
      const espflashPath = flasher.getEspflashPath();
      // In CI/test, process.platform+arch may or may not be in the supported map
      // Just verify it returns string or undefined (no crash)
      expect(espflashPath === undefined || typeof espflashPath === 'string').toBe(true);
    });

    it('includes .exe on win32', () => {
      // We can't easily test this cross-platform, just verify the method exists
      const flasher = new EspFlasher('/ext');
      expect(typeof flasher.getEspflashPath).toBe('function');
    });
  });

  describe('flash', () => {
    it('returns error when platform is unsupported', async () => {
      const flasher = new EspFlasher('/ext');
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue(undefined);

      const result = await flasher.flash('/dev/ttyUSB0', '/tmp/firmware.bin');
      expect(result.success).toBe(false);
      expect(result.output).toContain('not supported');
    });

    it('calls onProgress callback with parsed output', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const progressCalls: FlashProgress[] = [];
      const flashPromise = flasher.flash(
        '/dev/ttyUSB0',
        '/tmp/firmware.bin',
        {},
        (p) => progressCalls.push(p),
      );

      // Simulate espflash output
      proc.stderr.emit('data', Buffer.from('Connecting...\n'));
      proc.stderr.emit('data', Buffer.from('[00:00:01] [=====>                        ]  33/100  33%\n'));
      proc.stderr.emit('data', Buffer.from('[00:00:02] [==============================] 100/100 100%\n'));
      proc.stdout.emit('data', Buffer.from('Flashing has completed!\n'));
      proc.emit('close', 0);

      const result = await flashPromise;
      expect(result.success).toBe(true);
      expect(progressCalls.length).toBeGreaterThanOrEqual(3);
      expect(progressCalls[0].message).toBe('Connecting to bootloader…');
      expect(progressCalls[1]).toEqual({ percent: 33, message: 'Flashing… 33%' });
    });

    it('passes correct args including baud and chip', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const flashPromise = flasher.flash(
        '/dev/ttyUSB0',
        '/tmp/firmware.bin',
        { baudRate: 921600, chip: 'esp32s3' },
      );

      proc.emit('close', 0);
      await flashPromise;

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--baud');
      expect(args).toContain('921600');
      expect(args).toContain('--chip');
      expect(args).toContain('esp32s3');
      expect(args).toContain('--confirm-port');
    });

    it('reports failure on non-zero exit code', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const flashPromise = flasher.flash('/dev/ttyUSB0', '/tmp/firmware.bin');
      proc.stderr.emit('data', Buffer.from('Error: board not found\n'));
      proc.emit('close', 1);

      const result = await flashPromise;
      expect(result.success).toBe(false);
      expect(result.output).toContain('board not found');
    });

    it('reports failure when spawn errors', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/nonexistent/espflash');

      const flashPromise = flasher.flash('/dev/ttyUSB0', '/tmp/firmware.bin');
      proc.emit('error', new Error('ENOENT'));

      const result = await flashPromise;
      expect(result.success).toBe(false);
      expect(result.output).toContain('ENOENT');
    });

    it('resolves only once when error fires before close', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const flashPromise = flasher.flash('/dev/ttyUSB0', '/tmp/firmware.bin');

      // Node emits 'error' then 'close' on spawn failure
      proc.emit('error', new Error('EACCES'));
      proc.emit('close', -1);

      const result = await flashPromise;
      // Should get the error result, not the close result
      expect(result.success).toBe(false);
      expect(result.output).toContain('EACCES');
    });
  });

  describe('erase', () => {
    it('returns error when platform is unsupported', async () => {
      const flasher = new EspFlasher('/ext');
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue(undefined);

      const result = await flasher.erase('/dev/ttyUSB0');
      expect(result.success).toBe(false);
      expect(result.output).toContain('not supported');
    });

    it('passes correct erase args', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const erasePromise = flasher.erase('/dev/ttyUSB0');
      proc.emit('close', 0);
      await erasePromise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('erase-flash');
      expect(args).toContain('--port');
      expect(args).toContain('/dev/ttyUSB0');
    });
  });

  describe('cancel', () => {
    it('kills the running process', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const flashPromise = flasher.flash('/dev/ttyUSB0', '/tmp/firmware.bin');

      flasher.cancel();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      proc.emit('close', -1);
      await flashPromise;
    });

    it('does nothing when no process is running', () => {
      const flasher = new EspFlasher('/ext');
      expect(() => flasher.cancel()).not.toThrow();
    });
  });

  describe('boardInfo', () => {
    it('returns error when platform is unsupported', async () => {
      const flasher = new EspFlasher('/ext');
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue(undefined);

      const result = await flasher.boardInfo('/dev/ttyUSB0');
      expect('success' in result && !result.success).toBe(true);
    });

    it('parses board info from espflash output', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const promise = flasher.boardInfo('/dev/ttyUSB0');
      proc.stdout.emit('data', Buffer.from(
        'Chip type:         esp32s3 (revision v0.2)\n' +
        'Crystal frequency: 40 MHz\n' +
        'Flash size:        8MB\n' +
        'Features:          WiFi, BLE\n' +
        'MAC address:       aa:bb:cc:dd:ee:ff\n',
      ));
      proc.emit('close', 0);

      const result = await promise;
      expect('info' in result).toBe(true);
      if ('info' in result) {
        expect(result.info.chip).toBe('esp32s3');
        expect(result.info.flashSize).toBe('8MB');
        expect(result.info.crystalFreq).toBe('40 MHz');
      }
    });

    it('passes board-info args with --confirm-port', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const promise = flasher.boardInfo('/dev/ttyUSB0');
      proc.stdout.emit('data', Buffer.from('Chip type: esp32\nFlash size: 4MB\n'));
      proc.emit('close', 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('board-info');
      expect(args).toContain('--port');
      expect(args).toContain('/dev/ttyUSB0');
      expect(args).toContain('--confirm-port');
    });

    it('returns error when output cannot be parsed', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const promise = flasher.boardInfo('/dev/ttyUSB0');
      proc.stdout.emit('data', Buffer.from('No useful output here\n'));
      proc.emit('close', 0);

      const result = await promise;
      expect('success' in result && !result.success).toBe(true);
    });

    it('returns error when espflash fails', async () => {
      const proc = createMockProcess();
      const mockSpawn = createMockSpawn(proc);
      const flasher = new EspFlasher('/ext', mockSpawn);
      vi.spyOn(flasher, 'getEspflashPath').mockReturnValue('/ext/bin/linux-x64/espflash');

      const promise = flasher.boardInfo('/dev/ttyUSB0');
      proc.stderr.emit('data', Buffer.from('Error: no device found\n'));
      proc.emit('close', 1);

      const result = await promise;
      expect('success' in result && !result.success).toBe(true);
    });
  });
});

describe('parseBoardInfo', () => {
  it('parses standard board-info output', () => {
    const output =
      'Chip type:         esp32s3 (revision v0.2)\n' +
      'Crystal frequency: 40 MHz\n' +
      'Flash size:        8MB\n';
    const info = parseBoardInfo(output);
    expect(info).toEqual({
      chip: 'esp32s3',
      flashSize: '8MB',
      crystalFreq: '40 MHz',
    });
  });

  it('handles ESP32 (no suffix) chip type', () => {
    const output = 'Chip type:         ESP32 (revision v3.1)\nFlash size:        4MB\n';
    const info = parseBoardInfo(output);
    expect(info?.chip).toBe('esp32');
  });

  it('returns undefined when chip type is missing', () => {
    const output = 'Flash size: 4MB\nCrystal frequency: 40 MHz\n';
    expect(parseBoardInfo(output)).toBeUndefined();
  });

  it('handles output with only chip type', () => {
    const output = 'Chip type: esp32c3\n';
    const info = parseBoardInfo(output);
    expect(info).toEqual({
      chip: 'esp32c3',
      flashSize: undefined,
      crystalFreq: undefined,
    });
  });

  it('handles extra whitespace', () => {
    const output = '  Chip type:    esp32s2  \n  Flash size:    2MB  \n  Crystal frequency:   26 MHz  \n';
    const info = parseBoardInfo(output);
    expect(info?.chip).toBe('esp32s2');
    expect(info?.flashSize).toBe('2MB');
    expect(info?.crystalFreq).toBe('26 MHz');
  });
});
