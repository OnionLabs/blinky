import * as vscode from 'vscode';

/**
 * Contextual, non-blocking notifications shown at appropriate moments.
 * Each notification is shown at most once per install (tracked via globalState).
 */
export class OnboardingNotifications {
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  /**
   * Show a tip after first successful connection.
   */
  async onFirstConnect(): Promise<void> {
    if (this._shown('firstConnect')) return;
    await this._mark('firstConnect');

    const action = await vscode.window.showInformationMessage(
      'Connected! Use the MicroPython panel in the sidebar to browse board files, or press F5 to run a Python file.',
      'Open REPL',
      'Got it',
    );
    if (action === 'Open REPL') {
      vscode.commands.executeCommand('blinky.openRepl');
    }
  }

  /**
   * Show a tip after first file run.
   */
  async onFirstRun(): Promise<void> {
    if (this._shown('firstRun')) return;
    await this._mark('firstRun');

    vscode.window.showInformationMessage(
      'Tip: Use Shift+Enter to run the current line or selection. Ctrl+C (Shift+F5) stops a running script.',
    );
  }

  /**
   * Show a tip after first sync.
   */
  async onFirstSync(): Promise<void> {
    if (this._shown('firstSync')) return;
    await this._mark('firstSync');

    vscode.window.showInformationMessage(
      'Tip: Sync uses SHA-256 hashing to only upload changed files. Configure excluded patterns in Settings → blinky.syncExclude.',
    );
  }

  private _shown(key: string): boolean {
    return this._context.globalState.get<boolean>(`blinky.onboarding.${key}`, false);
  }

  private async _mark(key: string): Promise<void> {
    await this._context.globalState.update(`blinky.onboarding.${key}`, true);
  }
}
