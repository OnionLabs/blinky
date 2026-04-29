import { BoardProfile } from '../BoardProfile';

export const esp8266Profile: BoardProfile = {
  id: 'esp8266',
  name: 'ESP8266',
  usbIds: [
    // Most ESP8266 boards (ESP-01, NodeMCU, Wemos D1 Mini) use these USB-serial bridges.
    // These VID:PIDs overlap with ESP32 — port discovery shows both as candidates.

    // Silicon Labs CP210x (NodeMCU v2, some Wemos D1 Mini)
    { vid: '10c4', pid: 'ea60', description: 'CP210x (ESP8266)' },

    // WCH CH340 (NodeMCU v3, Wemos D1 Mini clones)
    { vid: '1a86', pid: '7523', description: 'CH340 (ESP8266)' },
    { vid: '1a86', pid: '5523', description: 'CH341 (ESP8266)' },

    // FTDI FT232R (some ESP-01 adapters)
    { vid: '0403', pid: '6001', description: 'FT232R (ESP8266)' },
  ],
  platformLabels: {
    esp8266: 'ESP8266',
  },
  capabilities: {
    hasWiFi: true,
    hasBLE: false,
    hasNativeUsb: false,
    supportsRawPaste: true,
    flashTool: 'espflash',
    firmwareFormat: 'bin',
    bootloaderEntry: 'auto-rts',
    // ESP8266 is Xtensa LX106; group with the family's xtensa label.
    cpuArch: 'xtensa',
  },
};
