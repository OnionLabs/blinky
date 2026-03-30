/**
 * Test helper: creates a SerialTransport backed by SerialPortMock.
 * Provides emitData() to simulate board responses.
 */
import { SerialPortMock } from 'serialport';
import { SerialTransport } from '../../src/connection/SerialTransport';

export const MOCK_PORT = '/dev/mock-esp32';

/**
 * Set up a mock serial environment.
 * Returns a transport and a function to simulate incoming data.
 */
export function createMockTransport(options?: { baudRate?: number }) {
  SerialPortMock.binding.reset();
  SerialPortMock.binding.createPort(MOCK_PORT, { echo: false, record: true });

  const transport = new SerialTransport({
    path: MOCK_PORT,
    baudRate: options?.baudRate ?? 115200,
    portFactory: (opts) => new SerialPortMock({ ...opts }),
  });

  /**
   * Emit data as if the board sent it.
   * Must be called after transport.open().
   */
  const emitData = (data: string | Buffer) => {
    const port = (transport as any)._port as SerialPortMock;
    if (!port) throw new Error('Transport not opened yet');
    port.port.emitData(typeof data === 'string' ? Buffer.from(data) : data);
  };

  return { transport, emitData };
}
