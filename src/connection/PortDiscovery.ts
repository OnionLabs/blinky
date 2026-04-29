import type { PortInfo } from '@serialport/bindings-interface';
import { SerialPort } from 'serialport';
import { BoardProfile, matchUsbId } from '../board/BoardProfile';

export interface DiscoveredPort {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  label: string;           // Human-readable label for QuickPick
  isKnownBoard: boolean;   // Matched a registered board profile
  matchedProfile?: string; // Profile id that matched, if any
}

export type PortListFn = () => Promise<PortInfo[]>;

/** Optional logger for surfacing port-enumeration failures (eg. missing udev rules). */
export type PortDiscoveryLogger = (message: string) => void;

/**
 * Enumerates serial ports and identifies known boards by VID/PID
 * using registered board profiles.
 */
export class PortDiscovery {
  private _listFn: PortListFn;
  private _profiles: BoardProfile[];
  private _logger: PortDiscoveryLogger | undefined;

  constructor(profiles: BoardProfile[], listFn?: PortListFn, logger?: PortDiscoveryLogger) {
    this._profiles = profiles;
    this._listFn = listFn ?? (() => SerialPort.list());
    this._logger = logger;
  }

  /**
   * List all available serial ports, annotated with board identification.
   */
  async listPorts(): Promise<DiscoveredPort[]> {
    let ports;
    try {
      ports = await this._listFn();
    } catch (err) {
      // SerialPort.list() fails when udev or OS serial subsystem is unavailable.
      // Surface via logger when supplied so users can see why no ports show up.
      const msg = err instanceof Error ? err.message : String(err);
      this._logger?.(`Port enumeration failed: ${msg}`);
      return [];
    }

    return ports.map((port) => {
      const vid = port.vendorId?.toLowerCase();
      const pid = port.productId?.toLowerCase();
      const match = vid && pid
        ? matchUsbId(this._profiles, vid, pid)
        : undefined;

      const label = match
        ? `${port.path} - ${match.usbId.description}`
        : port.manufacturer
          ? `${port.path} - ${port.manufacturer}`
          : port.path;

      return {
        path: port.path,
        manufacturer: port.manufacturer,
        vendorId: vid,
        productId: pid,
        serialNumber: port.serialNumber,
        label,
        isKnownBoard: !!match,
        matchedProfile: match?.profile.id,
      };
    });
  }

  /**
   * List only ports that match a registered board profile.
   */
  async listKnownPorts(): Promise<DiscoveredPort[]> {
    const all = await this.listPorts();
    return all.filter((p) => p.isKnownBoard);
  }

  /**
   * Auto-detect: returns the port if exactly one known board is found,
   * otherwise returns null (caller should show a picker).
   */
  async autoDetect(): Promise<DiscoveredPort | null> {
    const known = await this.listKnownPorts();
    return known.length === 1 ? known[0] : null;
  }
}
