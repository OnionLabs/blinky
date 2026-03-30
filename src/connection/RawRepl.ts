import { SerialTransport } from './SerialTransport';

const CTRL_A = '\x01'; // Enter raw REPL
const CTRL_B = '\x02'; // Exit raw REPL (back to friendly)
const CTRL_C = '\x03'; // Interrupt
const CTRL_D = '\x04'; // Soft reset / execute in raw REPL
const CTRL_E = '\x05'; // Enter paste mode / raw-paste prefix

export interface RawReplResult {
  stdout: string;
  stderr: string;
}

export interface StreamingExecOptions {
  /** Called with each chunk of stdout as it arrives */
  onStdout?: (chunk: string) => void;
  /** Signal to abort execution (sends CTRL-C to interrupt). Compatible with VS Code CancellationToken. */
  signal?: { onCancellationRequested(cb: () => void): { dispose(): void } };
}

/**
 * Implements the MicroPython raw REPL protocol.
 *
 * Standard raw REPL:
 *   → CTRL-C, CTRL-A       (interrupt + enter raw)
 *   ← "raw REPL; CTRL-B to exit\r\n>"
 *   → code + CTRL-D
 *   ← "OK" + stdout + \x04 + stderr + \x04 + ">"
 *   → CTRL-B               (exit raw REPL)
 *
 * Raw-paste mode (faster, flow-controlled):
 *   → CTRL-E + "A" + \x01
 *   ← "R" + \x01           (supported) or "R" + \x00 (not)
 *   → code bytes (flow-controlled, 256-byte windows)
 *   → CTRL-D                (end of data)
 *   ← "OK" + stdout + \x04 + stderr + \x04
 */
export class RawRepl {
  private _transport: SerialTransport;
  private _timeout: number;

  constructor(transport: SerialTransport, timeoutMs: number = 5000) {
    this._transport = transport;
    this._timeout = timeoutMs;
  }

  /**
   * Enter raw REPL mode: interrupt + CTRL-A, wait for the raw prompt.
   */
  async enter(): Promise<void> {
    // Mute external data events so raw REPL protocol noise
    // doesn't leak to the interactive terminal
    this._transport.mute();

    // Send interrupt to break any running code
    await this._transport.write(CTRL_C);
    // Small delay to let interrupt take effect
    await this._sleep(100);
    // Another CTRL-C in case the first was swallowed by running code
    await this._transport.write(CTRL_C);
    await this._sleep(100);

    // Enter raw REPL
    await this._transport.write(CTRL_A);

    // Wait for "raw REPL; CTRL-B to exit\r\n>"
    await this._transport.readUntil(
      (buf) => buf.toString('utf-8').includes('raw REPL; CTRL-B to exit'),
      this._timeout,
    );
  }

  /**
   * Exit raw REPL back to friendly REPL.
   */
  async exit(): Promise<void> {
    await this._transport.write(CTRL_B);
    // Wait for the friendly REPL greeting to pass before unmuting,
    // so it doesn't leak into the terminal
    await this._sleep(100);
    this._transport.unmute();
  }

  /**
   * Execute code via standard raw REPL protocol.
   */
  async exec(code: string): Promise<RawReplResult> {
    // Soft-reset the REPL line by sending CTRL-C first for clean state
    await this._transport.write(CTRL_C);
    await this._sleep(50);

    // Send code + CTRL-D to execute
    await this._transport.write(code + CTRL_D);

    // Read response: OK<stdout>\x04<stderr>\x04>
    const response = await this._transport.readUntil(
      (buf) => {
        const s = buf.toString('utf-8');
        // Need OK...CTRL_D...CTRL_D pattern, ending with >
        const okIdx = s.indexOf('OK');
        if (okIdx === -1) return false;
        const afterOk = s.slice(okIdx + 2);
        const firstEot = afterOk.indexOf('\x04');
        if (firstEot === -1) return false;
        const secondEot = afterOk.indexOf('\x04', firstEot + 1);
        return secondEot !== -1;
      },
      this._timeout,
    );

    return this._parseExecResponse(response.toString('utf-8'));
  }

  /**
   * Execute code via raw-paste mode (faster for large payloads).
   * Falls back to standard exec if raw-paste is not supported.
   */
  async execRawPaste(code: string): Promise<RawReplResult> {
    // Try to initiate raw-paste mode
    await this._transport.write(CTRL_E + 'A' + '\x01');

    const initResponse = await this._transport.readUntil(
      (buf) => buf.length >= 2 && buf[0] === 0x52, // 'R'
      2000,
    ).catch(() => null);

    if (!initResponse || initResponse[1] !== 0x01) {
      // Raw-paste not supported, fall back to standard exec
      // Need to abort: send CTRL-C and re-enter
      await this._transport.write(CTRL_C);
      await this._sleep(50);
      return this.exec(code);
    }

    // Raw-paste supported - send code in flow-controlled chunks
    const codeBytes = Buffer.from(code, 'utf-8');
    const WINDOW_SIZE = 256;

    for (let offset = 0; offset < codeBytes.length; offset += WINDOW_SIZE) {
      const chunk = codeBytes.subarray(offset, offset + WINDOW_SIZE);
      await this._transport.write(chunk);

      // Check for flow control byte (device may send \x01 to continue or \x04 to abort)
      if (offset + WINDOW_SIZE < codeBytes.length) {
        try {
          const fc = await this._transport.readUntil(
            (buf) => buf.length > 0,
            1000,
          );
          if (fc[fc.length - 1] === 0x04) {
            // Device signaled abort
            break;
          }
        } catch {
          // Timeout on flow control is okay - device may not send acks for every window
        }
      }
    }

    // Signal end of data
    await this._transport.write(CTRL_D);

    // Read result: OK<stdout>\x04<stderr>\x04
    const response = await this._transport.readUntil(
      (buf) => {
        const s = buf.toString('utf-8');
        const okIdx = s.indexOf('OK');
        if (okIdx === -1) return false;
        const afterOk = s.slice(okIdx + 2);
        const firstEot = afterOk.indexOf('\x04');
        if (firstEot === -1) return false;
        return afterOk.indexOf('\x04', firstEot + 1) !== -1;
      },
      this._timeout,
    );

    return this._parseExecResponse(response.toString('utf-8'));
  }

  /**
   * Execute code via raw REPL with streaming output and no timeout.
   * Output is delivered incrementally via onStdout callback.
   * Supports cancellation via signal (e.g. CancellationToken).
   */
  async execStreaming(code: string, options: StreamingExecOptions = {}): Promise<RawReplResult> {
    await this._transport.write(CTRL_C);
    await this._sleep(50);

    await this._transport.write(code + CTRL_D);

    // Accumulate the full response for final parsing
    let accumulated = '';
    let okSeen = false;
    let stdoutSoFar = '';

    // Set up cancellation: send CTRL-C to interrupt the running code
    let cancelled = false;
    const onCancel = () => {
      if (!cancelled) {
        cancelled = true;
        this._transport.write(CTRL_C).catch(() => {});
      }
    };
    const cancelDisposable = options.signal?.onCancellationRequested(onCancel);

    const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB safety limit

    return new Promise<RawReplResult>((resolve, reject) => {
      const onData = (data: Buffer) => {
        accumulated += data.toString('utf-8');

        if (accumulated.length + stdoutSoFar.length > MAX_BUFFER) {
          cleanup();
          reject(new Error('Output exceeded 10 MB limit'));
          return;
        }

        // Wait for initial "OK" before streaming stdout
        if (!okSeen) {
          const okIdx = accumulated.indexOf('OK');
          if (okIdx === -1) return;
          okSeen = true;
          accumulated = accumulated.slice(okIdx + 2);
        }

        // Check for completion: \x04<stderr>\x04
        const firstEot = accumulated.indexOf('\x04');
        if (firstEot !== -1) {
          const secondEot = accumulated.indexOf('\x04', firstEot + 1);
          if (secondEot !== -1) {
            // Done! Extract final stdout chunk + stderr
            const lastStdout = accumulated.slice(0, firstEot);
            if (lastStdout && options.onStdout) {
              options.onStdout(lastStdout);
            }
            stdoutSoFar += lastStdout;
            const stderr = accumulated.slice(firstEot + 1, secondEot);
            cleanup();
            resolve({ stdout: stdoutSoFar, stderr });
            return;
          }
        }

        // Stream stdout chunks (everything before a potential \x04)
        const safeEnd = firstEot !== -1 ? firstEot : accumulated.length;
        const chunk = accumulated.slice(0, safeEnd);
        if (chunk && options.onStdout) {
          options.onStdout(chunk);
        }
        stdoutSoFar += chunk;
        accumulated = accumulated.slice(safeEnd);
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Port closed during execution'));
      };

      const cleanup = () => {
        cancelDisposable?.dispose();
        this._transport.removeListener('_rawData', onData);
        this._transport.removeListener('error', onError);
        this._transport.removeListener('close', onClose);
      };

      this._transport.on('_rawData', onData);
      this._transport.on('error', onError);
      this._transport.on('close', onClose);
    });
  }

  /**
   * Soft-reset the board (CTRL-D in friendly REPL).
   */
  async softReset(): Promise<void> {
    await this._transport.write(CTRL_D);
    // Wait for the board to reboot and show a prompt
    await this._transport.readUntil(
      (buf) => buf.toString('utf-8').includes('>>>'),
      10000, // Boards can be slow to reset
    );
  }

  /**
   * Interrupt currently running code.
   */
  async interrupt(): Promise<void> {
    await this._transport.write(CTRL_C);
  }

  /**
   * Parse the response from a raw REPL exec: "OK<stdout>\x04<stderr>\x04>"
   */
  private _parseExecResponse(raw: string): RawReplResult {
    const okIdx = raw.indexOf('OK');
    if (okIdx === -1) {
      return { stdout: '', stderr: raw };
    }

    const afterOk = raw.slice(okIdx + 2);
    const firstEot = afterOk.indexOf('\x04');
    const secondEot = afterOk.indexOf('\x04', firstEot + 1);

    const stdout = firstEot !== -1 ? afterOk.slice(0, firstEot) : '';
    const stderr = (firstEot !== -1 && secondEot !== -1)
      ? afterOk.slice(firstEot + 1, secondEot)
      : '';

    return { stdout, stderr };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
