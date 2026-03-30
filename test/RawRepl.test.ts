import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RawRepl } from '../src/connection/RawRepl';
import { SerialTransport } from '../src/connection/SerialTransport';
import { createMockTransport } from './helpers/mockSerial';

describe('RawRepl (MockBinding)', () => {
  let transport: SerialTransport;
  let emitData: (data: string | Buffer) => void;
  let repl: RawRepl;

  beforeEach(async () => {
    const mock = createMockTransport();
    transport = mock.transport;
    emitData = mock.emitData;
    await transport.open();
    repl = new RawRepl(transport, 3000);
  });

  afterEach(async () => {
    transport.dispose();
  });

  it('enter() sends CTRL-C, CTRL-A and waits for raw prompt', async () => {
    // Simulate the board responding to enter sequence
    const enterPromise = repl.enter();

    // The board responds after receiving CTRL-A
    setTimeout(() => {
      emitData('raw REPL; CTRL-B to exit\r\n>');
    }, 250);

    await expect(enterPromise).resolves.toBeUndefined();
  });

  it('exec() sends code and parses stdout/stderr', async () => {
    // Simulate a full exec cycle
    const execPromise = repl.exec('print("hello")');

    // Board response: OK<stdout>\x04<stderr>\x04>
    setTimeout(() => {
      emitData('OK');
      emitData('hello\n');
      emitData('\x04'); // end of stdout
      emitData('\x04'); // end of stderr (empty)
      emitData('>');
    }, 100);

    const result = await execPromise;
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
  });

  it('exec() captures stderr from tracebacks', async () => {
    const execPromise = repl.exec('raise ValueError("oops")');

    setTimeout(() => {
      emitData('OK');
      emitData('\x04'); // empty stdout
      emitData('Traceback (most recent call last):\n  File "<stdin>", line 1\nValueError: oops\n');
      emitData('\x04>');
    }, 100);

    const result = await execPromise;
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ValueError: oops');
  });

  it('exec() handles multi-line output', async () => {
    const execPromise = repl.exec('for i in range(3): print(i)');

    setTimeout(() => {
      emitData('OK0\n1\n2\n\x04\x04>');
    }, 100);

    const result = await execPromise;
    expect(result.stdout).toBe('0\n1\n2\n');
    expect(result.stderr).toBe('');
  });

  it('exec() handles response arriving in chunks', async () => {
    const execPromise = repl.exec('print("chunked")');

    setTimeout(() => emitData('OK'), 200);
    setTimeout(() => emitData('chun'), 300);
    setTimeout(() => emitData('ked\n'), 400);
    setTimeout(() => emitData('\x04\x04>'), 500);

    const result = await execPromise;
    expect(result.stdout).toBe('chunked\n');
    expect(result.stderr).toBe('');
  });

  it('interrupt() sends CTRL-C', async () => {
    // Should not throw
    await expect(repl.interrupt()).resolves.toBeUndefined();
  });

  it('enter() times out if board does not respond', async () => {
    const repl2 = new RawRepl(transport, 500); // short timeout

    const enterPromise = repl2.enter();
    // Don't emit any data - should timeout

    await expect(enterPromise).rejects.toThrow(/Timeout/);
  });

  it('exit() sends CTRL-B and unmutes transport', async () => {
    // Should resolve without error
    await expect(repl.exit()).resolves.toBeUndefined();
  });

  it('softReset() sends CTRL-D and waits for friendly prompt', async () => {
    const resetPromise = repl.softReset();

    setTimeout(() => {
      emitData('MicroPython v1.20\r\n>>>');
    }, 200);

    await expect(resetPromise).resolves.toBeUndefined();
  });

  describe('execRawPaste()', () => {
    it('falls back to exec() when raw-paste not supported (timeout)', async () => {
      // The initResponse readUntil will timeout → falls back to exec()
      const repl2 = new RawRepl(transport, 3000);

      const execPromise = repl2.execRawPaste('print("fallback")');

      // First: the raw-paste init will timeout after 2s → falls back to exec()
      // For the fallback exec(), we provide the standard response
      setTimeout(() => {
        emitData('OKfallback\n\x04\x04>');
      }, 2500);

      const result = await execPromise;
      expect(result.stdout).toBe('fallback\n');
      expect(result.stderr).toBe('');
    });

    it('falls back to exec() when device declines raw-paste (R\\x00)', async () => {
      const execPromise = repl.execRawPaste('print("declined")');

      // Device responds with R + \x00 (not supported)
      setTimeout(() => {
        emitData('R\x00');
      }, 100);

      // After fallback to exec(), board responds with standard response
      setTimeout(() => {
        emitData('OKdeclined\n\x04\x04>');
      }, 500);

      const result = await execPromise;
      expect(result.stdout).toBe('declined\n');
    });

    it('succeeds with raw-paste for small code', async () => {
      const execPromise = repl.execRawPaste('print(1)');

      // Device accepts raw-paste: R + \x01
      setTimeout(() => {
        emitData('R\x01');
      }, 100);

      // Then board responds with exec result
      setTimeout(() => {
        emitData('OK1\n\x04\x04>');
      }, 300);

      const result = await execPromise;
      expect(result.stdout).toBe('1\n');
      expect(result.stderr).toBe('');
    });

    it('sends large code in flow-controlled chunks', async () => {
      const bigCode = 'x = "' + 'A'.repeat(600) + '"';
      const execPromise = repl.execRawPaste(bigCode);

      // Accept raw-paste
      setTimeout(() => emitData('R\x01'), 100);
      // Flow control: send continue byte for each chunk
      setTimeout(() => emitData('\x01'), 200);
      setTimeout(() => emitData('\x01'), 300);
      // Final response
      setTimeout(() => emitData('OK\x04\x04>'), 500);

      const result = await execPromise;
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('handles device abort during flow control', async () => {
      const bigCode = 'x = "' + 'A'.repeat(600) + '"';
      const execPromise = repl.execRawPaste(bigCode);

      // Accept raw-paste
      setTimeout(() => emitData('R\x01'), 100);
      // Device aborts
      setTimeout(() => emitData('\x04'), 200);
      // Final response
      setTimeout(() => emitData('OK\x04error\x04>'), 400);

      const result = await execPromise;
      expect(result.stderr).toBe('error');
    });
  });

  describe('execStreaming()', () => {
    it('streams stdout chunks via onStdout callback', async () => {
      const chunks: string[] = [];
      const execPromise = repl.execStreaming('print("stream")', {
        onStdout: (chunk) => chunks.push(chunk),
      });

      setTimeout(() => emitData('OK'), 100);
      setTimeout(() => emitData('str'), 200);
      setTimeout(() => emitData('eam\n'), 300);
      setTimeout(() => emitData('\x04\x04'), 400);

      const result = await execPromise;
      expect(result.stdout).toBe('stream\n');
      expect(result.stderr).toBe('');
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toBe('stream\n');
    });

    it('captures stderr from streaming exec', async () => {
      const execPromise = repl.execStreaming('raise ValueError("boom")');

      setTimeout(() => {
        emitData('OK\x04ValueError: boom\n\x04');
      }, 100);

      const result = await execPromise;
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('ValueError: boom');
    });

    it('works without onStdout callback', async () => {
      const execPromise = repl.execStreaming('print("quiet")');

      setTimeout(() => {
        emitData('OKquiet\n\x04\x04');
      }, 100);

      const result = await execPromise;
      expect(result.stdout).toBe('quiet\n');
    });

    it('rejects when port closes during streaming', async () => {
      const execPromise = repl.execStreaming('import time; time.sleep(10)');

      setTimeout(() => {
        transport.emit('close');
      }, 100);

      await expect(execPromise).rejects.toThrow(/Port closed/);
    });

    it('rejects when port errors during streaming', async () => {
      const execPromise = repl.execStreaming('long_running()');

      setTimeout(() => {
        transport.emit('error', new Error('USB disconnected'));
      }, 100);

      await expect(execPromise).rejects.toThrow('USB disconnected');
    });

    it('rejects when output exceeds size limit', async () => {
      const execPromise = repl.execStreaming('huge_output()');

      // Emit directly on transport's _rawData channel to bypass serial mock piping
      await new Promise((r) => setTimeout(r, 50));
      transport.emit('_rawData', Buffer.from('OK'));
      const bigChunk = Buffer.alloc(1024 * 1024, 0x58); // 1MB of 'X'
      let rejected = false;
      execPromise.catch(() => { rejected = true; });
      for (let i = 0; i < 12 && !rejected; i++) {
        await new Promise((r) => setTimeout(r, 1));
        transport.emit('_rawData', bigChunk);
      }

      await expect(execPromise).rejects.toThrow(/10 MB/);
    }, 10000);

    it('supports cancellation via signal', async () => {
      let cancelCallback: (() => void) | undefined;
      const signal = {
        onCancellationRequested(cb: () => void) {
          cancelCallback = cb;
          return { dispose: () => {} };
        },
      };

      const execPromise = repl.execStreaming('while True: pass', { signal });

      // Send OK, then cancel
      setTimeout(() => emitData('OK'), 100);
      setTimeout(() => {
        cancelCallback?.();
        // Board sends interrupt response after CTRL-C
        emitData('\x04KeyboardInterrupt\x04');
      }, 200);

      const result = await execPromise;
      expect(result.stderr).toContain('KeyboardInterrupt');
    });

    it('handles OK arriving in same chunk as data', async () => {
      const chunks: string[] = [];
      const execPromise = repl.execStreaming('print(42)', {
        onStdout: (c) => chunks.push(c),
      });

      setTimeout(() => {
        emitData('OK42\n\x04\x04');
      }, 100);

      const result = await execPromise;
      expect(result.stdout).toBe('42\n');
    });
  });

  describe('_parseExecResponse edge cases', () => {
    it('returns raw as stderr when no OK found', async () => {
      const result = (repl as any)._parseExecResponse('garbage data');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('garbage data');
    });

    it('handles missing EOT markers', async () => {
      const result = (repl as any)._parseExecResponse('OKpartial');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('handles OK with only first EOT', async () => {
      const result = (repl as any)._parseExecResponse('OKstdout\x04nostderr');
      expect(result.stdout).toBe('stdout');
      expect(result.stderr).toBe('');
    });
  });
});
