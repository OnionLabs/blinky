import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Supported target platform keys for bundled espflash binaries.
 */
type PlatformKey = 'darwin-arm64' | 'linux-x64' | 'linux-arm64' | 'win32-x64';

/** Map of Node.js platform+arch to our binary folder names */
const PLATFORM_MAP: Record<string, PlatformKey | undefined> = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'win32-x64': 'win32-x64',
};

export interface FlashProgress {
  /** 0-100 percentage, or undefined if indeterminate */
  percent?: number;
  /** Human-readable status message */
  message: string;
}

export interface FlashResult {
  success: boolean;
  /** Combined stdout+stderr output */
  output: string;
}

export interface BoardInfo {
  /** Chip type as reported by espflash (e.g. 'esp32', 'esp32s3', 'esp32c3') */
  chip: string;
  /** Flash size (e.g. '8MB', '4MB') */
  flashSize?: string;
  /** Crystal frequency (e.g. '40 MHz') */
  crystalFreq?: string;
}

/**
 * Parse espflash progress output lines.
 *
 * espflash outputs lines like:
 *   [00:00:01] [=========>                    ]  33/100  33%
 *   [00:00:02] [====================>         ]  67/100  67%
 *   [00:00:03] [==============================] 100/100 100%
 *
 * Also:
 *   Chip type:         esp32s3
 *   Crystal frequency: 40 MHz
 *   Flash size:        8MB
 *   Flashing has completed!
 */
export function parseFlashOutput(line: string): FlashProgress | undefined {
  // Progress bar: extract percentage
  const progressMatch = line.match(/(\d+)%\s*$/);
  if (progressMatch) {
    return {
      percent: parseInt(progressMatch[1], 10),
      message: `Flashing… ${progressMatch[1]}%`,
    };
  }

  // Status lines
  if (line.includes('Flashing has completed')) {
    return { percent: 100, message: 'Flash complete!' };
  }
  if (line.includes('Chip type:')) {
    const chip = line.split(':').pop()?.trim() ?? '';
    return { message: `Detected chip: ${chip}` };
  }
  if (line.includes('Erasing flash')) {
    return { message: 'Erasing flash…' };
  }
  if (line.includes('Connecting')) {
    return { message: 'Connecting to bootloader…' };
  }
  if (line.includes('Verifying')) {
    return { message: 'Verifying…' };
  }

  return undefined;
}

/**
 * Parse espflash `board-info` output into structured data.
 *
 * Sample output:
 *   Chip type:         esp32s3 (revision v0.2)
 *   Crystal frequency: 40 MHz
 *   Flash size:        8MB
 *   Features:          WiFi, BLE
 *   MAC address:       aa:bb:cc:dd:ee:ff
 */
export function parseBoardInfo(output: string): BoardInfo | undefined {
  const chipMatch = output.match(/Chip type:\s+(\S+)/i);
  if (!chipMatch) return undefined;

  const chip = chipMatch[1].toLowerCase();
  const flashMatch = output.match(/Flash size:\s+(\S+)/i);
  const crystalMatch = output.match(/Crystal frequency:\s+(.+)/i);

  return {
    chip,
    flashSize: flashMatch?.[1],
    crystalFreq: crystalMatch?.[1].trim(),
  };
}

export type SpawnFn = typeof child_process.spawn;

/**
 * Manages firmware flashing via bundled espflash binaries.
 *
 * espflash is a Rust CLI tool that can flash ESP32 firmware over serial.
 * We bundle pre-compiled binaries for each platform and spawn them
 * as child processes.
 */
export class EspFlasher {
  private _extensionPath: string;
  private _process: child_process.ChildProcess | undefined;
  private _spawn: SpawnFn;

  constructor(extensionPath: string, spawnFn?: SpawnFn) {
    this._extensionPath = extensionPath;
    this._spawn = spawnFn ?? child_process.spawn;
  }

  /**
   * Resolve the path to the bundled espflash binary for the current platform.
   * Returns undefined if the platform isn't supported.
   */
  getEspflashPath(): string | undefined {
    const key = `${process.platform}-${process.arch}`;
    const platformKey = PLATFORM_MAP[key];
    if (!platformKey) return undefined;

    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(this._extensionPath, 'bin', platformKey, `espflash${ext}`);
  }

  /**
   * Flash a firmware file to a board.
   *
   * @param port Serial port path (e.g. /dev/ttyUSB0)
   * @param firmwarePath Absolute path to the .bin firmware file
   * @param options Optional flash configuration
   * @param onProgress Callback for progress updates
   * @returns Flash result
   */
  async flash(
    port: string,
    firmwarePath: string,
    options: {
      baudRate?: number;
      /** Override chip type (e.g. 'esp32', 'esp32s3') - usually auto-detected */
      chip?: string;
      /** Flash address for raw binary files (default: 0x0) */
      address?: string;
    } = {},
    onProgress?: (progress: FlashProgress) => void,
    onOutput?: (line: string) => void,
  ): Promise<FlashResult> {
    const espflash = this.getEspflashPath();
    if (!espflash) {
      return {
        success: false,
        output: `Firmware flashing is not supported on this platform (${process.platform}-${process.arch}). Supported: macOS ARM64, Linux x64, Windows x64.`,
      };
    }

    // Use write-bin for raw .bin files, flash for ELF/app images
    const isBin = firmwarePath.endsWith('.bin');
    const address = options.address ?? '0x0';

    const args = isBin
      ? ['write-bin', '--port', port, address, firmwarePath]
      : ['flash', firmwarePath, '--port', port];

    if (options.baudRate) {
      args.push('--baud', String(options.baudRate));
    }

    if (options.chip) {
      args.push('--chip', options.chip);
    }

    // Don't prompt for user input
    args.push('--confirm-port');

    return this._spawnProcess(espflash, args, onProgress, onOutput);
  }

  /**
   * Erase the entire flash of a connected board.
   *
   * @param port Serial port path
   * @param onProgress Callback for progress updates
   */
  async erase(
    port: string,
    onProgress?: (progress: FlashProgress) => void,
    onOutput?: (line: string) => void,
  ): Promise<FlashResult> {
    const espflash = this.getEspflashPath();
    if (!espflash) {
      return {
        success: false,
        output: `Firmware flashing is not supported on this platform (${process.platform}-${process.arch}).`,
      };
    }

    const args = ['erase-flash', '--port', port, '--confirm-port'];
    return this._spawnProcess(espflash, args, onProgress, onOutput);
  }

  /**
   * Probe a board to detect chip type, flash size, etc. without flashing.
   *
   * @param port Serial port path
   * @param onProgress Callback for progress updates
   * @returns Board info, or FlashResult with error on failure
   */
  async boardInfo(
    port: string,
    onProgress?: (progress: FlashProgress) => void,
  ): Promise<{ info: BoardInfo } | FlashResult> {
    const espflash = this.getEspflashPath();
    if (!espflash) {
      return {
        success: false,
        output: `Board detection is not supported on this platform (${process.platform}-${process.arch}).`,
      };
    }

    const args = ['board-info', '--port', port, '--confirm-port'];
    const result = await this._spawnProcess(espflash, args, onProgress);

    if (!result.success) return result;

    const info = parseBoardInfo(result.output);
    if (!info) {
      return { success: false, output: `Could not parse board info from espflash output:\n${result.output}` };
    }

    return { info };
  }

  /**
   * Cancel a running flash/erase operation.
   */
  cancel(): void {
    if (this._process && !this._process.killed) {
      this._process.kill('SIGTERM');
    }
  }

  /**
   * Ensure the binary has execute permission (no-op on Windows).
   */
  private _ensureExecutable(binaryPath: string): void {
    if (process.platform === 'win32') return;
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(binaryPath, 0o755);
      } catch {
        // File may not exist yet (tests) or be on a read-only FS - proceed anyway,
        // spawn will produce a clear error if it can't execute.
      }
    }
  }

  /**
   * Spawn espflash and stream output.
   */
  private _spawnProcess(
    command: string,
    args: string[],
    onProgress?: (progress: FlashProgress) => void,
    onOutput?: (line: string) => void,
  ): Promise<FlashResult> {
    this._ensureExecutable(command);

    return new Promise((resolve) => {
      const output: string[] = [];
      let resolved = false;

      const finish = (result: FlashResult) => {
        if (resolved) return;
        resolved = true;
        this._process = undefined;
        resolve(result);
      };

      this._process = this._spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'dumb' },
      });

      const handleData = (data: Buffer) => {
        const text = data.toString();
        output.push(text);

        for (const line of text.split('\n')) {
          const trimmed = line.replace(/\r/g, '').trim();
          if (!trimmed) continue;
          onOutput?.(trimmed);
          const progress = parseFlashOutput(trimmed);
          if (progress) {
            onProgress?.(progress);
          }
        }
      };

      this._process.stdout?.on('data', handleData);
      this._process.stderr?.on('data', handleData);

      this._process.on('close', (code) => {
        finish({ success: code === 0, output: output.join('') });
      });

      this._process.on('error', (err) => {
        finish({ success: false, output: `Failed to start espflash: ${err.message}` });
      });
    });
  }
}
