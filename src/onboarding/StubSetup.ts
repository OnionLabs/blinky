import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

/** Map board platform to PyPI stub package name */
const STUB_PACKAGES: Record<string, string> = {
  esp32: 'micropython-esp32-stubs',
  esp32s2: 'micropython-esp32s2-stubs',
  esp32s3: 'micropython-esp32s3-stubs',
  esp32c3: 'micropython-esp32c3-stubs',
  rp2: 'micropython-rp2-stubs',
  stm32: 'micropython-stm32-stubs',
  nrf: 'micropython-nrf-stubs',
  samd: 'micropython-samd-stubs',
};

/**
 * Detects whether Pylance is installed and helps configure MicroPython
 * type stubs for autocomplete.
 *
 * MicroPython type stubs (e.g. micropython-stubs) provide type info for
 * board-specific modules like `machine`, `network`, `esp32`, etc.
 */
export class StubSetup {
  private _context: vscode.ExtensionContext;
  private _boardPlatform: string | undefined;
  private _boardVersion: string | undefined;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  /**
   * Set the detected board platform so we install the right stubs.
   */
  setBoardPlatform(platform: string | undefined): void {
    this._boardPlatform = platform;
  }

  /**
   * Set the detected board firmware version for stub version pinning.
   */
  setBoardVersion(version: string | undefined): void {
    this._boardVersion = version;
  }

  /**
   * Check if Pylance (or the Python extension) is installed.
   */
  isPylanceInstalled(): boolean {
    return (
      vscode.extensions.getExtension('ms-python.vscode-pylance') !== undefined ||
      vscode.extensions.getExtension('ms-python.python') !== undefined
    );
  }

  /**
   * Check if stubs are already configured in workspace settings.
   */
  isStubsConfigured(): boolean {
    const config = vscode.workspace.getConfiguration('python.analysis');
    const extraPaths = config.get<string[]>('extraPaths', []);
    return extraPaths.some(
      (p) => p.includes('micropython-') || p === '.vscode/stubs' || p.endsWith('/stubs'),
    );
  }

  /**
   * Check if the user has dismissed the stubs prompt before.
   */
  isDismissed(): boolean {
    return this._context.globalState.get<boolean>('blinky.stubsDismissed', false);
  }

  /**
   * Mark the stubs prompt as dismissed.
   */
  async dismiss(): Promise<void> {
    await this._context.globalState.update('blinky.stubsDismissed', true);
  }

  /**
   * Prompt the user to set up MicroPython stubs if Pylance is installed
   * and stubs aren't already configured.
   */
  async promptIfNeeded(): Promise<void> {
    if (!this.isPylanceInstalled()) return;
    if (this.isStubsConfigured()) return;
    if (this.isDismissed()) return;
    await this._showPrompt();
  }

  /**
   * Always show the stubs prompt (for explicit command invocation).
   * Skips only if stubs are already configured.
   */
  async forcePrompt(): Promise<void> {
    if (this.isStubsConfigured()) {
      vscode.window.showInformationMessage('MicroPython stubs are already configured.');
      return;
    }
    if (!this.isPylanceInstalled()) {
      const action = await vscode.window.showWarningMessage(
        'Pylance (or the Python extension) is not installed. MicroPython stubs require it for autocomplete.',
        'Install Anyway',
      );
      if (action !== 'Install Anyway') return;
    }
    await this._showPrompt();
  }

  private async _showPrompt(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      'MicroPython stubs can improve autocomplete for board modules like `machine` and `network`.',
      'Install Stubs',
      'Configure Manually',
      "Don't Show Again",
    );

    if (action === 'Install Stubs') {
      await this._installStubs();
    } else if (action === 'Configure Manually') {
      await this._openStubsDocs();
    } else if (action === "Don't Show Again") {
      await this.dismiss();
    }
  }

  /**
   * Install micropython-stubs via pip into the workspace and configure extraPaths.
   */
  private async _installStubs(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscode.window.showWarningMessage('Open a workspace folder first to install stubs.');
      return;
    }

    // Check if pip is available before attempting install
    const hasPip = await this._checkPip();
    if (!hasPip) {
      const action = await vscode.window.showErrorMessage(
        'pip is not installed or not found in PATH. It is required to install MicroPython stubs.',
        'Show Install Instructions',
        'Cancel',
      );
      if (action === 'Show Install Instructions') {
        await vscode.env.openExternal(vscode.Uri.parse('https://pip.pypa.io/en/stable/installation/'));
      }
      return;
    }

    // Select the right stub package for this board
    const platform = this._boardPlatform?.toLowerCase();
    let stubPackage = platform ? STUB_PACKAGES[platform] : undefined;

    if (!stubPackage) {
      // Board not connected or unknown platform - let user pick
      const items = Object.entries(STUB_PACKAGES).map(([port, pkg]) => ({
        label: port,
        description: pkg,
        pkg,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select your board platform',
      });
      if (!picked) return;
      stubPackage = picked.pkg;
    }

    const stubsDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'stubs');

    // Pin to firmware major.minor if known (e.g. micropython-esp32-stubs==1.23.*)
    const versionSpec = this._boardVersion
      ? `==${this._boardVersion.split('.').slice(0, 2).join('.')}.*`
      : '';

    const terminal = vscode.window.createTerminal({ name: 'Install MicroPython Stubs' });
    terminal.show();
    const escapedDir = stubsDir.replace(/'/g, "'\\''");
    terminal.sendText(`mkdir -p '${escapedDir}' && python3 -m pip install --target '${escapedDir}' ${stubPackage}${versionSpec}`);

    // Configure extraPaths
    const config = vscode.workspace.getConfiguration('python.analysis');
    const extraPaths = config.get<string[]>('extraPaths', []);
    const relativePath = '.vscode/stubs';

    if (!extraPaths.includes(relativePath)) {
      await config.update('extraPaths', [...extraPaths, relativePath], vscode.ConfigurationTarget.Workspace);
    }

    // Suppress "no source" warnings for MicroPython board modules — stubs are intentionally source-less
    const diagConfig = vscode.workspace.getConfiguration('python.analysis');
    const overrides = diagConfig.get<Record<string, string>>('diagnosticSeverityOverrides', {});
    if (overrides['reportMissingModuleSource'] !== 'none') {
      await diagConfig.update(
        'diagnosticSeverityOverrides',
        { ...overrides, reportMissingModuleSource: 'none' },
        vscode.ConfigurationTarget.Workspace,
      );
    }

    vscode.window.showInformationMessage(
      `Installing ${stubPackage}. Pylance will pick them up after installation completes.`,
    );
  }

  /**
   * Check if pip is available on the system.
   */
  private _checkPip(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('python3', ['-m', 'pip', '--version'], (err) => {
        if (err) {
          execFile('pip', ['--version'], (err2) => {
            resolve(!err2);
          });
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Open the stubs documentation page.
   */
  private async _openStubsDocs(): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse('https://micropython-stubs.readthedocs.io/'));
  }
}
