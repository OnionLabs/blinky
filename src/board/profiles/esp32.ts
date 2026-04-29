import { BoardProfile } from '../BoardProfile';

export const esp32Profile: BoardProfile = {
  id: 'esp32',
  name: 'ESP32',
  usbIds: [
    // Espressif native USB (VID 303A)
    { vid: '303a', pid: '0002', description: 'ESP32-S2 (CDC)' },
    { vid: '303a', pid: '0003', description: 'ESP32-S2 (DFU)' },
    { vid: '303a', pid: '1001', description: 'ESP32-S2/S3/C3/C6/H2 USB Serial/JTAG' },
    { vid: '303a', pid: '1002', description: 'ESP32-S3 USB Serial/JTAG' },

    // Silicon Labs CP210x
    { vid: '10c4', pid: 'ea60', description: 'CP210x (ESP32)' },
    { vid: '10c4', pid: 'ea70', description: 'CP2105 Dual (ESP32)' },

    // WCH USB-serial bridges
    { vid: '1a86', pid: '7523', description: 'CH340 (ESP32)' },
    { vid: '1a86', pid: '55d4', description: 'CH9102 (ESP32)' },
    { vid: '1a86', pid: '55d3', description: 'CH9102X (ESP32)' },
    { vid: '1a86', pid: '5523', description: 'CH341 (ESP32)' },

    // FTDI - used on ESP-WROVER-KIT, ESP-PROG, some third-party boards
    { vid: '0403', pid: '6001', description: 'FT232R (ESP32)' },
    { vid: '0403', pid: '6010', description: 'FT2232 Dual (ESP-PROG / WROVER-KIT)' },
    { vid: '0403', pid: '6014', description: 'FT232H (ESP32)' },
  ],
  platformLabels: {
    esp32: 'ESP32',
    esp32s2: 'ESP32-S2',
    esp32s3: 'ESP32-S3',
    esp32c3: 'ESP32-C3',
    esp32c6: 'ESP32-C6',
    esp32h2: 'ESP32-H2',
  },
  capabilities: {
    hasWiFi: true,
    hasBLE: true,
    supportsRawPaste: true,
    flashTool: 'espflash',
    firmwareFormat: 'bin',
    bootloaderEntry: 'auto-rts',
    // hasNativeUsb and cpuArch are NOT set here because the esp32 family
    // is heterogeneous: original ESP32 = xtensa + UART bridge, S2/S3 =
    // xtensa + native USB, C3/C6/H2 = risc-v + native USB. Detect at runtime
    // from sys.platform and override per-chip.
  },
};
