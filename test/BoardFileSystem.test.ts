import { SerialPortMock } from 'serialport';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceConnection } from '../src/connection/DeviceConnection';
import { BoardFileEntry, BoardFileSystem } from '../src/filesystem/BoardFileSystem';

const MOCK_PORT = '/dev/mock-fs';

function setup() {
  SerialPortMock.binding.reset();
  SerialPortMock.binding.createPort(MOCK_PORT, { echo: false, record: true });

  const conn = new DeviceConnection({
    path: MOCK_PORT,
    baudRate: 115200,
    replTimeoutMs: 3000,
    portFactory: (opts) => new SerialPortMock({ ...opts }),
  });

  const getPort = () => {
    const transport = (conn as any)._transport;
    return (transport as any)._port as SerialPortMock;
  };

  return { conn, getPort };
}

/**
 * Helper: simulate a raw REPL conversation for an executeRaw() call.
 * Timing must account for RawRepl.enter() doing: CTRL-C + 100ms + CTRL-C + 100ms + CTRL-A,
 * then exec() doing: CTRL-C + 50ms + code+CTRL-D.
 */
function simulateRawRepl(port: SerialPortMock, stdout: string, stderr = '') {
  // Raw REPL enter prompt - must arrive after ~250ms of enter() setup
  setTimeout(() => {
    port.port.emitData(Buffer.from('raw REPL; CTRL-B to exit\r\n>'));
  }, 300);
  // Exec response - must arrive after code is sent (~350ms+ from start)
  setTimeout(() => {
    port.port.emitData(Buffer.from(`OK${stdout}\x04${stderr}\x04>`));
  }, 500);
}

describe('BoardFileSystem', () => {
  let conn: DeviceConnection;
  let fs: BoardFileSystem;
  let getPort: () => SerialPortMock;

  beforeEach(async () => {
    const s = setup();
    conn = s.conn;
    getPort = s.getPort;
    await conn.connect();
    fs = new BoardFileSystem(conn);
  });

  afterEach(() => {
    conn.dispose();
  });

  describe('ls()', () => {
    it('returns parsed directory listing', async () => {
      const entries: BoardFileEntry[] = [
        { name: 'boot.py', path: '/boot.py', isDir: false, size: 139 },
        { name: 'lib', path: '/lib', isDir: true, size: 0 },
      ];
      const promise = fs.ls('/');
      simulateRawRepl(getPort(), JSON.stringify(entries));

      const result = await promise;
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('boot.py');
      expect(result[0].isDir).toBe(false);
      expect(result[0].size).toBe(139);
      expect(result[1].name).toBe('lib');
      expect(result[1].isDir).toBe(true);
    });

    it('throws on error response', async () => {
      const promise = fs.ls('/nonexistent');
      simulateRawRepl(getPort(), JSON.stringify({ error: 'ENOENT' }));

      await expect(promise).rejects.toThrow('ENOENT');
    });
  });

  describe('stat()', () => {
    it('returns stat info', async () => {
      const promise = fs.stat('/boot.py');
      simulateRawRepl(getPort(), JSON.stringify({ isDir: false, size: 139 }));

      const result = await promise;
      expect(result.isDir).toBe(false);
      expect(result.size).toBe(139);
    });
  });

  describe('readFile()', () => {
    it('decodes base64 content', async () => {
      const content = 'print("hello")';
      const b64 = Buffer.from(content).toString('base64');
      const promise = fs.readFile('/test.py');
      simulateRawRepl(getPort(), b64 + '\n');

      const result = await promise;
      expect(result.toString('utf-8')).toBe(content);
    });

    it('handles multi-line base64', async () => {
      const content = 'A'.repeat(1000);
      const b64 = Buffer.from(content).toString('base64');
      // Split into ~76 char lines like ubinascii would
      const lines = b64.match(/.{1,76}/g)!.join('\n') + '\n';
      const promise = fs.readFile('/big.py');
      simulateRawRepl(getPort(), lines);

      const result = await promise;
      expect(result.toString('utf-8')).toBe(content);
    });
  });

  describe('readTextFile()', () => {
    it('returns UTF-8 string', async () => {
      const content = '# hello\nprint(1)\n';
      const b64 = Buffer.from(content).toString('base64');
      const promise = fs.readTextFile('/test.py');
      simulateRawRepl(getPort(), b64 + '\n');

      const result = await promise;
      expect(result).toBe(content);
    });
  });

  describe('writeFile()', () => {
    it('succeeds on OK response', async () => {
      // Atomic write performs (write to tmp) + (rename tmp -> final),
      // so two raw REPL operations need to succeed. Stub executeRaw
      // directly to keep the test focused on writeFile semantics.
      const stub = vi.fn().mockResolvedValue({ stdout: 'OK\n', stderr: '' });
      (fs as any)._connection = { executeRaw: stub } as any;

      await expect(fs.writeFile('/test.py', 'print(1)\n')).resolves.toBeUndefined();
      // 1 putStart + 1 rename
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it('throws on error response', async () => {
      const stub = vi.fn()
        // putStart fails
        .mockResolvedValueOnce({ stdout: 'ERR:EACCES\n', stderr: '' })
        // tmp cleanup attempt
        .mockResolvedValueOnce({ stdout: 'OK\n', stderr: '' });
      (fs as any)._connection = { executeRaw: stub } as any;

      await expect(fs.writeFile('/readonly.py', 'x')).rejects.toThrow('EACCES');
    });
  });

  describe('rm()', () => {
    it('succeeds on OK', async () => {
      const promise = fs.rm('/test.py');
      simulateRawRepl(getPort(), 'OK');

      await expect(promise).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      const promise = fs.rm('/nonexist');
      simulateRawRepl(getPort(), 'ERR:ENOENT');

      await expect(promise).rejects.toThrow('ENOENT');
    });
  });

  describe('rmdir()', () => {
    it('succeeds on OK', async () => {
      const promise = fs.rmdir('/lib');
      simulateRawRepl(getPort(), 'OK');

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('mkdir()', () => {
    it('succeeds on OK', async () => {
      const promise = fs.mkdir('/newdir');
      simulateRawRepl(getPort(), 'OK');

      await expect(promise).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      const promise = fs.mkdir('/boot.py');
      simulateRawRepl(getPort(), 'ERR:EEXIST');

      await expect(promise).rejects.toThrow('EEXIST');
    });
  });

  describe('rename()', () => {
    it('succeeds on OK', async () => {
      const promise = fs.rename('/old.py', '/new.py');
      simulateRawRepl(getPort(), 'OK');

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('exists()', () => {
    it('returns true when stat succeeds', async () => {
      const promise = fs.exists('/boot.py');
      simulateRawRepl(getPort(), JSON.stringify({ isDir: false, size: 100 }));

      expect(await promise).toBe(true);
    });

    it('returns false when stat fails', async () => {
      const promise = fs.exists('/nope');
      simulateRawRepl(getPort(), '', 'OSError: ENOENT');

      expect(await promise).toBe(false);
    });
  });
});
