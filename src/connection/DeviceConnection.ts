import { EventEmitter } from 'events';
import { AsyncMutex } from './AsyncMutex';
import { RawRepl, RawReplResult, StreamingExecOptions } from './RawRepl';
import { PortFactory, SerialTransport } from './SerialTransport';

export interface DeviceConnectionOptions {
  path: string;
  baudRate?: number;
  replTimeoutMs?: number;
  /** Inject a custom port factory for testing */
  portFactory?: PortFactory;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Owns the serial transport, raw REPL, and async mutex.
 * Provides executeRaw() which serializes access:
 *   1. Acquire mutex
 *   2. Enter raw REPL
 *   3. Execute code
 *   4. Exit raw REPL
 *   5. Release mutex
 *
 * Emits: 'stateChanged', 'data' (passthrough from transport for REPL terminal), 'error'
 */
export class DeviceConnection extends EventEmitter {
  private _transport: SerialTransport;
  private _rawRepl: RawRepl;
  private _mutex = new AsyncMutex();
  private _state: ConnectionState = 'disconnected';
  private _boardInfo: { platform?: string; version?: string } = {};

  constructor(options: DeviceConnectionOptions) {
    super();
    this._transport = new SerialTransport({
      path: options.path,
      baudRate: options.baudRate,
      portFactory: options.portFactory,
    });
    this._rawRepl = new RawRepl(this._transport, options.replTimeoutMs);

    this._transport.on('data', (data: Buffer) => this.emit('data', data));
    this._transport.on('error', (err: Error) => {
      this._setState('error');
      this.emit('error', err);
    });
    this._transport.on('close', () => {
      this._setState('disconnected');
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  get portPath(): string {
    return this._transport.path;
  }

  get boardInfo(): { platform?: string; version?: string } {
    return { ...this._boardInfo };
  }

  /**
   * Whether the connection is currently busy with a raw REPL operation.
   */
  get isBusy(): boolean {
    return this._mutex.locked;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return;

    this._setState('connecting');
    try {
      await this._transport.open();
      this._setState('connected');
    } catch (err) {
      this._setState('error');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') return;

    try {
      await this._transport.close();
    } finally {
      this._setState('disconnected');
      this._boardInfo = {};
    }
  }

  /**
   * Probe whether the board is idle at a REPL prompt.
   * Sends a harmless bare Enter and checks if `>>> ` comes back.
   * Returns true if idle, false if something appears to be running.
   * Non-destructive - does NOT interrupt running code.
   */
  async probeIdle(timeoutMs: number = 3000): Promise<boolean> {
    try {
      await this._transport.write('\r');
      const buf = await this._transport.readUntil(
        (b) => b.toString('utf-8').includes('>>> '),
        timeoutMs,
      );
      return buf.toString('utf-8').includes('>>> ');
    } catch {
      return false;
    }
  }

  /**
   * Execute Python code on the board via raw REPL, serialized by mutex.
   * This is the primary API for all board operations.
   */
  async executeRaw(code: string): Promise<RawReplResult> {
    return this._mutex.runExclusive(async () => {
      await this._rawRepl.enter();
      try {
        const result = await this._rawRepl.exec(code);
        return result;
      } finally {
        await this._rawRepl.exit();
      }
    });
  }

  /**
   * Execute code via raw-paste mode (faster for large scripts).
   */
  async executeRawPaste(code: string): Promise<RawReplResult> {
    return this._mutex.runExclusive(async () => {
      await this._rawRepl.enter();
      try {
        const result = await this._rawRepl.execRawPaste(code);
        return result;
      } finally {
        await this._rawRepl.exit();
      }
    });
  }

  /**
   * Execute code with streaming output and no timeout.
   * Output is delivered incrementally via options.onStdout.
   * Supports cancellation via options.signal.
   */
  async executeRawStreaming(code: string, options: StreamingExecOptions = {}): Promise<RawReplResult> {
    return this._mutex.runExclusive(async () => {
      await this._rawRepl.enter();
      try {
        const result = await this._rawRepl.execStreaming(code, options);
        return result;
      } finally {
        await this._rawRepl.exit();
      }
    });
  }

  /**
   * Write raw bytes to the transport (for interactive REPL passthrough).
   */
  async writeRaw(data: string | Buffer): Promise<void> {
    await this._transport.write(data);
  }

  /**
   * Interrupt running code on the board.
   */
  async interrupt(): Promise<void> {
    await this._rawRepl.interrupt();
  }

  /**
   * Store detected board info.
   */
  setBoardInfo(info: { platform?: string; version?: string }): void {
    this._boardInfo = { ...info };
  }

  dispose(): void {
    this._transport.dispose();
    this.removeAllListeners();
  }

  private _setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChanged', state);
    }
  }
}
