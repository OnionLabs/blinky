import { beforeEach, describe, expect, it } from 'vitest';
import { SerialTransport } from '../src/connection/SerialTransport';
import { createMockTransport } from './helpers/mockSerial';

describe('SerialTransport (MockBinding)', () => {
  let transport: SerialTransport;
  let emitData: (data: string | Buffer) => void;

  beforeEach(async () => {
    const mock = createMockTransport();
    transport = mock.transport;
    emitData = mock.emitData;
  });

  it('open and close', async () => {
    expect(transport.isOpen).toBe(false);
    await transport.open();
    expect(transport.isOpen).toBe(true);
    await transport.close();
    expect(transport.isOpen).toBe(false);
  });

  it('open is idempotent', async () => {
    await transport.open();
    await transport.open(); // should not throw
    expect(transport.isOpen).toBe(true);
    await transport.close();
  });

  it('write throws when port is closed', async () => {
    await expect(transport.write('hello')).rejects.toThrow('Port is not open');
  });

  it('write succeeds when open', async () => {
    await transport.open();
    await expect(transport.write('hello')).resolves.toBeUndefined();
    await transport.close();
  });

  it('emits data events', async () => {
    await transport.open();
    const received: Buffer[] = [];
    transport.on('data', (d: Buffer) => received.push(d));

    emitData('hello board');

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 50));
    const combined = Buffer.concat(received).toString('utf-8');
    expect(combined).toContain('hello board');
    await transport.close();
  });

  it('readUntil resolves when predicate matches', async () => {
    await transport.open();

    const promise = transport.readUntil(
      (buf) => buf.toString('utf-8').includes('DONE'),
      2000,
    );

    // Simulate board sending data in chunks
    emitData('partial...');
    setTimeout(() => emitData('...DONE'), 50);

    const result = await promise;
    expect(result.toString('utf-8')).toContain('DONE');
    await transport.close();
  });

  it('readUntil times out when predicate never matches', async () => {
    await transport.open();

    const promise = transport.readUntil(
      (buf) => buf.toString('utf-8').includes('NEVER'),
      200, // short timeout
    );

    emitData('some data but not the magic word');

    await expect(promise).rejects.toThrow(/Timeout/);
    await transport.close();
  });

  it('dispose cleans up', async () => {
    await transport.open();
    transport.dispose();
    expect(transport.isOpen).toBe(false);
  });

  it('mute() suppresses data events', async () => {
    await transport.open();
    const received: Buffer[] = [];
    transport.on('data', (d: Buffer) => received.push(d));

    transport.mute();
    expect(transport.isMuted).toBe(true);
    emitData('hidden data');
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(0);

    transport.unmute();
    expect(transport.isMuted).toBe(false);
    emitData('visible data');
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    expect(Buffer.concat(received).toString('utf-8')).toContain('visible data');
    await transport.close();
  });

  it('readUntil works while muted', async () => {
    await transport.open();
    transport.mute();

    const promise = transport.readUntil(
      (buf) => buf.toString('utf-8').includes('FOUND'),
      2000,
    );

    emitData('FOUND');
    const result = await promise;
    expect(result.toString('utf-8')).toContain('FOUND');

    transport.unmute();
    await transport.close();
  });
});
