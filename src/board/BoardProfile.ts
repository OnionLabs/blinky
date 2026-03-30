/**
 * Board profile - describes a family of MicroPython boards.
 * The core plugin is board-agnostic; profiles provide the board-specific
 * knowledge (USB identifiers, platform labels, etc.).
 */
export interface BoardProfile {
  /** Profile identifier, e.g. 'esp32', 'rp2040', 'stm32' */
  id: string;
  /** Human-readable name, e.g. 'ESP32' */
  name: string;
  /** Known USB VID:PID combos for auto-detection */
  usbIds: UsbDeviceId[];
  /** Map of sys.platform → human-readable chip name */
  platformLabels: Record<string, string>;
}

export interface UsbDeviceId {
  /** Vendor ID (lowercase hex, no 0x prefix) */
  vid: string;
  /** Product ID (lowercase hex, no 0x prefix) */
  pid: string;
  /** Human-readable chip/adapter description */
  description: string;
}

/**
 * Match a VID/PID against all registered profiles.
 * Returns the first matching profile + USB entry, or undefined.
 */
export function matchUsbId(
  profiles: BoardProfile[],
  vid: string,
  pid: string,
): { profile: BoardProfile; usbId: UsbDeviceId } | undefined {
  for (const profile of profiles) {
    const usbId = profile.usbIds.find((u) => u.vid === vid && u.pid === pid);
    if (usbId) {
      return { profile, usbId };
    }
  }
  return undefined;
}

/**
 * Look up a human-readable label for a platform string across all profiles.
 * Falls back to uppercased platform name if not found.
 */
export function platformLabel(profiles: BoardProfile[], platform: string): string {
  for (const profile of profiles) {
    const label = profile.platformLabels[platform];
    if (label) return label;
  }
  return platform.toUpperCase();
}
