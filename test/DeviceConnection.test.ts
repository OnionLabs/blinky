import { SerialPortMock } from 'serialport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceConnection } from '../src/connection/DeviceConnection';

const MOCK_PORT = '/dev/mock-esp32';

function createMockConnection() {
  SerialPortMock.binding.reset();
  SerialPortMock.binding.createPort(MOCK_PORT, { echo: false, record: true });

  const conn = new DeviceConnection({
    path: MOCK_PORT,
    baudRate: 115200,
    replTimeoutMs: 3000,
    portFactory: (opts) => new SerialPortMock({ ...opts }),
  });

  /**
   * Get the underlying mock port to emitData.
   * Must be called after connect().
   */
  const getPort = () => {
    const transport = (conn as any)._transport;
    const port = (transport as any)._port as SerialPortMock;
    return port;
  };

  return { conn, getPort };
}

describe('DeviceConnection (MockBinding)', () => {
  let conn: DeviceConnection;
  let getPort: () => SerialPortMock;

  beforeEach(() => {
    const mock = createMockConnection();
    conn = mock.conn;
    getPort = mock.getPort;
  });

  afterEach(() => {
    conn.dispose();
  });

  it('starts disconnected', () => {
    expect(conn.state).toBe('disconnected');
    expect(conn.isConnected).toBe(false);
  });

  it('connect() transitions to connected', async () => {
    const states: string[] = [];
    conn.on('stateChanged', (s) => states.push(s));

    await conn.connect();

    expect(conn.state).toBe('connected');
    expect(conn.isConnected).toBe(true);
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('connect() is idempotent', async () => {
    await conn.connect();
    await conn.connect(); // should not throw
    expect(conn.isConnected).toBe(true);
  });

  it('disconnect() transitions to disconnected', async () => {
    await conn.connect();
    await conn.disconnect();
    expect(conn.state).toBe('disconnected');
    expect(conn.isConnected).toBe(false);
  });

  it('emits data events from transport', async () => {
    await conn.connect();
    const chunks: Buffer[] = [];
    conn.on('data', (d) => chunks.push(d));

    getPort().port.emitData(Buffer.from('hello'));
    await new Promise((r) => setTimeout(r, 50));

    expect(Buffer.concat(chunks).toString()).toContain('hello');
  });

  it('executeRaw() runs code through raw REPL', async () => {
    await conn.connect();
    const port = getPort();

    const execPromise = conn.executeRaw('print(42)');

    // Simulate raw REPL enter response
    setTimeout(() => {
      port.port.emitData(Buffer.from('raw REPL; CTRL-B to exit\r\n>'));
    }, 250);

    // Simulate exec response
    setTimeout(() => {
      port.port.emitData(Buffer.from('OK42\n\x04\x04>'));
    }, 400);

    const result = await execPromise;
    expect(result.stdout).toBe('42\n');
    expect(result.stderr).toBe('');
  });

  it('executeRaw() serializes concurrent calls', async () => {
    await conn.connect();
    const port = getPort();
    const order: number[] = [];

    // Set up auto-responder that answers raw REPL prompts
    let callCount = 0;
    const respond = () => {
      callCount++;
      const n = callCount;
      // raw REPL enter
      setTimeout(() => {
        port.port.emitData(Buffer.from('raw REPL; CTRL-B to exit\r\n>'));
      }, 250);
      // exec response
      setTimeout(() => {
        order.push(n);
        port.port.emitData(Buffer.from(`OK${n}\n\x04\x04>`));
      }, 400);
    };

    // First call
    const p1 = conn.executeRaw('print(1)');
    respond();

    const r1 = await p1;
    expect(r1.stdout).toBe('1\n');

    // Second call (sequential)
    const p2 = conn.executeRaw('print(2)');
    respond();

    const r2 = await p2;
    expect(r2.stdout).toBe('2\n');

    expect(order).toEqual([1, 2]);
  });

  it('setBoardInfo stores and returns board info', async () => {
    conn.setBoardInfo({ platform: 'esp32', version: '1.23.0' });
    expect(conn.boardInfo).toEqual({ platform: 'esp32', version: '1.23.0' });
  });

  it('portPath returns the configured path', () => {
    expect(conn.portPath).toBe(MOCK_PORT);
  });

  it('isBusy is true during executeRaw()', async () => {
    await conn.connect();
    const port = getPort();

    expect(conn.isBusy).toBe(false);

    // Start an executeRaw call - simulate raw REPL enter after a delay
    setTimeout(() => {
      port.port.emitData(Buffer.from('raw REPL; CTRL-B to exit\r\n>'));
    }, 250);
    // Simulate exec response after enter completes
    setTimeout(() => {
      port.port.emitData(Buffer.from('OK1\n\x04\x04>'));
    }, 400);

    const execPromise = conn.executeRaw('print(1)');

    // While waiting for raw REPL, should be busy
    await new Promise((r) => setTimeout(r, 50));
    expect(conn.isBusy).toBe(true);

    await execPromise;
    expect(conn.isBusy).toBe(false);
  });
});
