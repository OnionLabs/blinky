import { SerialPortMock } from 'serialport';
import { beforeEach, describe, expect, it } from 'vitest';
import { BoardProfile } from '../src/board/BoardProfile';
import { esp32Profile } from '../src/board/profiles';
import { PortDiscovery } from '../src/connection/PortDiscovery';

/** A second profile to verify multi-profile matching */
const testRp2Profile: BoardProfile = {
  id: 'rp2040',
  name: 'RP2040',
  usbIds: [
    { vid: '2e8a', pid: '0005', description: 'Raspberry Pi Pico (MicroPython)' },
  ],
  platformLabels: {
    rp2: 'RP2040',
  },
};

describe('PortDiscovery (MockBinding)', () => {
  let discovery: PortDiscovery;

  beforeEach(() => {
    SerialPortMock.binding.reset();
    discovery = new PortDiscovery([esp32Profile], () => SerialPortMock.list());
  });

  it('listPorts() returns empty when no ports', async () => {
    const ports = await discovery.listPorts();
    expect(ports).toEqual([]);
  });

  it('listPorts() finds created ports', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {});

    const ports = await discovery.listPorts();
    expect(ports.length).toBe(1);
    expect(ports[0].path).toBe('/dev/ttyUSB0');
  });

  it('identifies ESP32 CP2102 by VID/PID', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: '10c4',
      productId: 'ea60',
    });

    const ports = await discovery.listPorts();
    expect(ports[0].isKnownBoard).toBe(true);
    expect(ports[0].matchedProfile).toBe('esp32');
    expect(ports[0].label).toContain('CP210x');
  });

  it('identifies ESP32 CH340 by VID/PID', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: '1a86',
      productId: '7523',
    });

    const ports = await discovery.listPorts();
    expect(ports[0].isKnownBoard).toBe(true);
    expect(ports[0].label).toContain('CH340');
  });

  it('identifies ESP32-S2/S3 native USB by VID/PID', async () => {
    SerialPortMock.binding.createPort('/dev/ttyACM0', {
      vendorId: '303a',
      productId: '1001',
    });

    const ports = await discovery.listPorts();
    expect(ports[0].isKnownBoard).toBe(true);
    expect(ports[0].label).toContain('USB Serial/JTAG');
  });

  it('unknown VID/PID is marked isKnownBoard=false', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: 'abcd',
      productId: '1234',
      manufacturer: 'FTDI',
    });

    const ports = await discovery.listPorts();
    expect(ports[0].isKnownBoard).toBe(false);
    expect(ports[0].matchedProfile).toBeUndefined();
  });

  it('listKnownPorts() filters to recognized boards only', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: '10c4',
      productId: 'ea60',
    });
    SerialPortMock.binding.createPort('/dev/ttyUSB1', {
      vendorId: 'abcd',
      productId: '1234',
    });

    const known = await discovery.listKnownPorts();
    expect(known.length).toBe(1);
    expect(known[0].path).toBe('/dev/ttyUSB0');
  });

  it('autoDetect() returns single known port', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: '10c4',
      productId: 'ea60',
    });

    const port = await discovery.autoDetect();
    expect(port).not.toBeNull();
    expect(port!.path).toBe('/dev/ttyUSB0');
  });

  it('autoDetect() returns null when multiple known ports', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: '10c4',
      productId: 'ea60',
    });
    SerialPortMock.binding.createPort('/dev/ttyUSB1', {
      vendorId: '303a',
      productId: '1001',
    });

    const port = await discovery.autoDetect();
    expect(port).toBeNull();
  });

  it('autoDetect() returns null when no known ports', async () => {
    SerialPortMock.binding.createPort('/dev/ttyUSB0', {});

    const port = await discovery.autoDetect();
    expect(port).toBeNull();
  });

  it('supports multiple profiles simultaneously', async () => {
    const multi = new PortDiscovery(
      [esp32Profile, testRp2Profile],
      () => SerialPortMock.list(),
    );

    SerialPortMock.binding.createPort('/dev/ttyUSB0', {
      vendorId: '10c4',
      productId: 'ea60',
    });
    SerialPortMock.binding.createPort('/dev/ttyACM0', {
      vendorId: '2e8a',
      productId: '0005',
    });
    SerialPortMock.binding.createPort('/dev/ttyUSB1', {});

    const ports = await multi.listPorts();
    expect(ports.length).toBe(3);

    const esp = ports.find((p) => p.matchedProfile === 'esp32');
    const rp = ports.find((p) => p.matchedProfile === 'rp2040');
    const unknown = ports.find((p) => !p.isKnownBoard);

    expect(esp).toBeDefined();
    expect(esp!.label).toContain('CP210x');
    expect(rp).toBeDefined();
    expect(rp!.label).toContain('Pico');
    expect(unknown).toBeDefined();

    const known = await multi.listKnownPorts();
    expect(known.length).toBe(2);
  });
});
