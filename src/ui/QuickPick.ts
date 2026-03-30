import * as vscode from 'vscode';
import { DiscoveredPort, PortDiscovery } from '../connection/PortDiscovery';

/**
 * Show a QuickPick to select a serial port.
 * Known MicroPython boards are sorted to the top with a separator.
 */
export async function pickPort(discovery: PortDiscovery): Promise<DiscoveredPort | undefined> {
  const ports = await discovery.listPorts();

  if (ports.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'No serial ports found. Is a board plugged in?',
      'Refresh',
    );
    if (action === 'Refresh') {
      return pickPort(discovery);
    }
    return undefined;
  }

  const knownPorts = ports.filter((p) => p.isKnownBoard);
  const otherPorts = ports.filter((p) => !p.isKnownBoard);

  const items: Array<vscode.QuickPickItem & { port?: DiscoveredPort }> = [];

  if (knownPorts.length > 0) {
    items.push({ label: 'Detected Boards', kind: vscode.QuickPickItemKind.Separator });
    for (const p of knownPorts) {
      items.push({ label: p.label, description: p.path, port: p });
    }
  }

  if (otherPorts.length > 0) {
    items.push({ label: 'Other Ports', kind: vscode.QuickPickItemKind.Separator });
    for (const p of otherPorts) {
      items.push({ label: p.label, description: p.path, port: p });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a serial port',
    matchOnDescription: true,
  });

  return picked?.port;
}
