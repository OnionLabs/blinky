import { SerialPortMock } from 'serialport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceConnection } from '../src/connection/DeviceConnection';
import { ReplTerminal } from '../src/repl/ReplTerminal';

const MOCK_PORT = '/dev/mock-repl';

function setup() {
  SerialPortMock.binding.reset();
  SerialPortMock.binding.createPort(MOCK_PORT, { echo: false, record: true });

  const conn = new DeviceConnection({
    path: MOCK_PORT,
    baudRate: 115200,
    portFactory: (opts) => new SerialPortMock({ ...opts }),
  });

  const terminal = new ReplTerminal(conn);

  const getPort = () => {
    const transport = (conn as any)._transport;
    return (transport as any)._port as SerialPortMock;
  };

  return { conn, terminal, getPort };
}

describe('ReplTerminal', () => {
  let conn: DeviceConnection;
  let terminal: ReplTerminal;
  let getPort: () => SerialPortMock;
  let writes: string[];

  beforeEach(async () => {
    const s = setup();
    conn = s.conn;
    terminal = s.terminal;
    getPort = s.getPort;
    writes = [];

    // Capture output written to the terminal
    terminal.onDidWrite((text) => writes.push(text));

    await conn.connect();
  });

  afterEach(async () => {
    // Close terminal first to detach listeners, then allow pending writes to settle
    terminal.close();
    await new Promise((r) => setTimeout(r, 50));
    conn.dispose();
  });

  it('open() writes welcome banner', () => {
    terminal.open(undefined);
    const output = writes.join('');
    expect(output).toContain('MicroPython REPL');
    expect(output).toContain(MOCK_PORT);
  });

  it('displays data from board', async () => {
    terminal.open(undefined);

    // Wait for initial CTRL-B/C to be sent
    await new Promise((r) => setTimeout(r, 50));

    // Simulate board sending a prompt
    getPort().port.emitData(Buffer.from('>>> '));
    await new Promise((r) => setTimeout(r, 50));

    const output = writes.join('');
    expect(output).toContain('>>> ');
  });

  it('sends regular characters to the board', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    // Type 'a'
    terminal.handleInput('a');
    await new Promise((r) => setTimeout(r, 50));

    const port = getPort();
    expect(port.port.recording.toString()).toContain('a');
  });

  it('sends CTRL-C (\\x03) to the board', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    terminal.handleInput('\x03');
    await new Promise((r) => setTimeout(r, 50));

    const recording = getPort().port.recording.toString('utf-8');
    expect(recording).toContain('\x03');
  });

  it('sends CTRL-D (\\x04) to the board', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    terminal.handleInput('\x04');
    await new Promise((r) => setTimeout(r, 50));

    const recording = getPort().port.recording.toString('utf-8');
    expect(recording).toContain('\x04');
  });

  it('sends CTRL-E (\\x05) to the board', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    terminal.handleInput('\x05');
    await new Promise((r) => setTimeout(r, 50));

    const recording = getPort().port.recording.toString('utf-8');
    expect(recording).toContain('\x05');
  });

  it('converts backspace (\\x7f) to \\x08', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    terminal.handleInput('\x7f');
    await new Promise((r) => setTimeout(r, 50));

    const recording = getPort().port.recording.toString('utf-8');
    expect(recording).toContain('\x08');
  });

  it('ignores input when disconnected', async () => {
    terminal.open(undefined);
    // Wait for open()'s initial CTRL-B/C writes to complete
    await new Promise((r) => setTimeout(r, 100));
    await conn.disconnect();

    // Should not throw
    terminal.handleInput('a');
  });

  it('shows [Disconnected] when connection drops', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    await conn.disconnect();
    await new Promise((r) => setTimeout(r, 50));

    const output = writes.join('');
    expect(output).toContain('[Disconnected - board was reset or unplugged]');
  });

  it('tracks prompt type from parsed data', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    expect(terminal.currentPrompt).toBe('none');

    getPort().port.emitData(Buffer.from('>>> '));
    await new Promise((r) => setTimeout(r, 50));

    expect(terminal.currentPrompt).toBe('normal');
  });

  it('sanitizes \\n to \\r\\n for terminal display', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    // Send output with bare \n (no \r)
    getPort().port.emitData(Buffer.from('line1\nline2\n>>> '));
    await new Promise((r) => setTimeout(r, 50));

    const output = writes.join('');
    // Should contain \r\n, not bare \n
    expect(output).toContain('line1\r\nline2\r\n');
  });

  it('buffers output while paused and flushes on resume', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    terminal.pause();

    getPort().port.emitData(Buffer.from('paused output\r\n>>> '));
    await new Promise((r) => setTimeout(r, 50));

    // Output captured so far (before pause data)
    const beforeResume = writes.join('');

    terminal.resume();
    await new Promise((r) => setTimeout(r, 10));

    const afterResume = writes.join('');
    // After resume, the paused data should appear
    expect(afterResume.length).toBeGreaterThan(beforeResume.length);
    expect(afterResume).toContain('paused output');
  });

  it('Ctrl-L clears terminal screen', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    // Set a current prompt
    getPort().port.emitData(Buffer.from('>>> '));
    await new Promise((r) => setTimeout(r, 50));

    terminal.handleInput('\x0c');
    await new Promise((r) => setTimeout(r, 50));

    const output = writes.join('');
    expect(output).toContain('\x1b[2J\x1b[H');
  });

  it('colorizes MicroPython version banner', async () => {
    terminal.open(undefined);
    await new Promise((r) => setTimeout(r, 50));

    getPort().port.emitData(Buffer.from('MicroPython v1.27.0 on 2025-12-09; ESP32C6 module with ESP32C6\r\n>>> '));
    await new Promise((r) => setTimeout(r, 50));

    const output = writes.join('');
    // Should contain cyan ANSI code around the version line
    expect(output).toContain('\x1b[36m');
    expect(output).toContain('MicroPython v1.27.0');
  });
});
