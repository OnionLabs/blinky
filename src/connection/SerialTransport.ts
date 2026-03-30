import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';

/** Any SerialPort-like stream (real or mock) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerialPortLike = SerialPort | InstanceType<any>;

export type PortFactory = (options: { path: string; baudRate: number; autoOpen: false }) => SerialPortLike;

export interface SerialTransportOptions {
  path: string;
  baudRate?: number;
  /** Inject a custom port factory for testing (defaults to real SerialPort) */
  portFactory?: PortFactory;
}

/**
 * Thin wrapper around serialport. Owns the exclusive connection.
 * Emits 'data', 'error', 'close' events.
 */
export class SerialTransport extends EventEmitter {
  private _port: SerialPortLike | null = null;
  private _path: string;
  private _baudRate: number;
  private _portFactory: PortFactory;
  private _muted = false;

  constructor(options: SerialTransportOptions) {
    super();
    this._path = options.path;
    this._baudRate = options.baudRate ?? 115200;
    this._portFactory = options.portFactory ?? ((opts) => new SerialPort(opts));
  }

  get isOpen(): boolean {
    return this._port?.isOpen ?? false;
  }

  get path(): string {
    return this._path;
  }

  get baudRate(): number {
    return this._baudRate;
  }

  async open(): Promise<void> {
    if (this._port?.isOpen) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this._port = this._portFactory(
        { path: this._path, baudRate: this._baudRate, autoOpen: false as const },
      );

      this._port.on('data', (data: Buffer) => {
        // Always emit on internal channel for readUntil
        this.emit('_rawData', data);
        // Only emit public 'data' when not muted
        if (!this._muted) {
          this.emit('data', data);
        }
      });
      this._port.on('error', (err: Error) => this.emit('error', err));
      this._port.on('close', () => this.emit('close'));

      this._port.open((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    if (!this._port?.isOpen) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this._port!.close((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  write(data: Buffer | string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._port?.isOpen) {
        reject(new Error('Port is not open'));
        return;
      }
      this._port.write(data, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          this._port!.drain((drainErr: Error | null) => {
            if (drainErr) reject(drainErr);
            else resolve();
          });
        }
      });
    });
  }

  /**
   * Read from the port until `predicate` matches accumulated data, or timeout.
   * Returns the accumulated buffer.
   */
  readUntil(predicate: (buf: Buffer) => boolean, timeoutMs: number = 5000): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      // eslint-disable-next-line prefer-const
      let timer: ReturnType<typeof setTimeout> | undefined;

      const onData = (data: Buffer) => {
        chunks.push(data);
        const accumulated = Buffer.concat(chunks);
        if (predicate(accumulated)) {
          cleanup();
          resolve(accumulated);
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Port closed while waiting for data'));
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.removeListener('_rawData', onData);
        this.removeListener('error', onError);
        this.removeListener('close', onClose);
      };

      timer = setTimeout(() => {
        cleanup();
        const accumulated = Buffer.concat(chunks);
        reject(new Error(
          `Timeout after ${timeoutMs}ms waiting for response. Got ${accumulated.length} bytes: ${accumulated.toString('utf-8').slice(0, 200)}`
        ));
      }, timeoutMs);

      this.on('_rawData', onData);
      this.on('error', onError);
      this.on('close', onClose);
    });
  }

  /**
   * Suppress public 'data' events. readUntil() still works via internal channel.
   */
  mute(): void {
    this._muted = true;
  }

  /**
   * Resume public 'data' events.
   */
  unmute(): void {
    this._muted = false;
  }

  get isMuted(): boolean {
    return this._muted;
  }

  dispose(): void {
    if (this._port?.isOpen) {
      this._port.close();
    }
    this._port = null;
    this.removeAllListeners();
  }
}
