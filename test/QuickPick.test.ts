import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { pickPort } from '../src/ui/QuickPick';

function createMockDiscovery(ports: any[] = []) {
  return {
    listPorts: vi.fn().mockResolvedValue(ports),
  } as any;
}

describe('pickPort', () => {
  it('returns undefined when no ports found and user dismisses', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);
    const discovery = createMockDiscovery([]);
    const result = await pickPort(discovery);
    expect(result).toBeUndefined();
  });

  it('shows quick pick with known boards first', async () => {
    const ports = [
      { path: '/dev/ttyUSB0', label: 'ESP32', isKnownBoard: true },
      { path: '/dev/ttyS0', label: 'Unknown', isKnownBoard: false },
    ];
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
      label: 'ESP32',
      description: '/dev/ttyUSB0',
      port: ports[0],
    } as any);

    const discovery = createMockDiscovery(ports);
    const result = await pickPort(discovery);
    expect(result).toEqual(ports[0]);
  });

  it('returns undefined when user cancels quick pick', async () => {
    const ports = [{ path: '/dev/ttyUSB0', label: 'ESP32', isKnownBoard: true }];
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

    const discovery = createMockDiscovery(ports);
    const result = await pickPort(discovery);
    expect(result).toBeUndefined();
  });

  it('handles ports with only unknown boards', async () => {
    const ports = [
      { path: '/dev/ttyS0', label: 'Port A', isKnownBoard: false },
      { path: '/dev/ttyS1', label: 'Port B', isKnownBoard: false },
    ];
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
      label: 'Port A',
      description: '/dev/ttyS0',
      port: ports[0],
    } as any);

    const discovery = createMockDiscovery(ports);
    const result = await pickPort(discovery);
    expect(result).toEqual(ports[0]);
  });

  it('retries on Refresh click when no ports', async () => {
    const discovery = createMockDiscovery([]);
    let callCount = 0;
    vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? 'Refresh' as any : undefined;
    });

    const result = await pickPort(discovery);
    expect(result).toBeUndefined();
    expect(discovery.listPorts).toHaveBeenCalledTimes(2);
  });
});
