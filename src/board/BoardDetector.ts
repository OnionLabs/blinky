import { DeviceConnection } from '../connection/DeviceConnection';
import { BoardProfile, platformLabel } from './BoardProfile';

export interface BoardInfo {
  platform: string;   // e.g. 'esp32', 'esp32s3', 'rp2'
  version: string;    // e.g. '1.23.0'
  machine: string;    // e.g. 'ESP32S3 module with ESP32S3'
  label: string;      // Human-readable label for UI
}

const DETECT_SCRIPT = `
def _():
    import sys, os
    try:
        m = os.uname()
        print(m.sysname)
        print('.'.join(str(x) for x in sys.implementation.version[:3]))
        print(m.machine)
    except:
        print('unknown')
        print('0.0.0')
        print('unknown')
_()
del _
`.trim();

/**
 * Queries the connected board for its platform, version, and machine info
 * via a raw REPL command. Board-agnostic - uses registered profiles
 * only for human-readable label resolution.
 */
export class BoardDetector {
  private _profiles: BoardProfile[];

  constructor(profiles: BoardProfile[]) {
    this._profiles = profiles;
  }

  async detect(connection: DeviceConnection): Promise<BoardInfo> {
    const result = await connection.executeRaw(DETECT_SCRIPT);

    if (result.stderr) {
      return {
        platform: 'unknown',
        version: '0.0.0',
        machine: 'unknown',
        label: 'MicroPython Board',
      };
    }

    const lines = result.stdout.trim().split('\n').map((l) => l.trim());
    const platform = lines[0] || 'unknown';
    const version = lines[1] || '0.0.0';
    const machine = lines[2] || 'unknown';

    const label = `${platformLabel(this._profiles, platform)} (v${version})`;

    return { platform, version, machine, label };
  }
}
