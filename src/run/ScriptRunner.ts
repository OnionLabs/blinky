import * as vscode from 'vscode';
import { DeviceConnection } from '../connection/DeviceConnection';
import { BoardFileSystem } from '../filesystem/BoardFileSystem';
import { DiagnosticManager } from './DiagnosticParser';

/**
 * Handles uploading and executing Python scripts on a MicroPython board.
 * Output appears in the REPL terminal; errors produce diagnostics.
 */
export class ScriptRunner implements vscode.Disposable {
  private _diagnostics: DiagnosticManager;
  private _running = false;
  private _activeConnection: DeviceConnection | undefined;

  constructor(diagnostics: DiagnosticManager) {
    this._diagnostics = diagnostics;
  }

  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Cancel the currently running script by interrupting the board.
   */
  async cancel(): Promise<void> {
    if (this._running && this._activeConnection?.isConnected) {
      await this._activeConnection.interrupt();
    }
  }

  /**
   * Run a local Python file on the board:
   * 1. Upload the file to the board
   * 2. Execute it via raw REPL
   * 3. Parse any errors into diagnostics
   */
  async runFile(
    connection: DeviceConnection,
    boardFs: BoardFileSystem,
    localUri: vscode.Uri,
  ): Promise<void> {
    if (this._running) {
      vscode.window.showWarningMessage('A script is already running.');
      return;
    }

    this._running = true;
    this._activeConnection = connection;
    this._diagnostics.clear();

    try {
      // Read local file
      const fileData = await vscode.workspace.fs.readFile(localUri);
      const code = Buffer.from(fileData).toString('utf-8');
      const fileName = localUri.fsPath.split('/').pop()!;
      const remotePath = `/${fileName}`;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Running ${fileName}…`, cancellable: true },
        async (progress, token) => {
          // Interrupt the board if user cancels
          token.onCancellationRequested(() => {
            connection.interrupt().catch(() => {});
          });

          // Step 1: Upload
          progress.report({ message: 'Uploading…' });
          await boardFs.writeFile(remotePath, code);

          if (token.isCancellationRequested) return;

          // Step 2: Execute with compile() to preserve filename in tracebacks
          progress.report({ message: 'Executing…' });
          const execCode = `exec(compile(open(${JSON.stringify(remotePath)}).read(), ${JSON.stringify(remotePath)}, 'exec'))`;
          const result = await connection.executeRaw(execCode);

          // Step 3: Handle results
          if (result.stderr) {
            this._diagnostics.setFromStderr(result.stderr, localUri);
            vscode.window.showErrorMessage(`${fileName}: ${result.stderr.split('\n').pop()?.trim() || 'Error'}`);
          }
        },
      );
    } finally {
      this._running = false;
      this._activeConnection = undefined;
    }
  }

  /**
   * Execute a code snippet directly (for Run Selection).
   * Does not upload - sends code straight to the board via raw REPL.
   */
  async runCode(
    connection: DeviceConnection,
    code: string,
    sourceUri?: vscode.Uri,
  ): Promise<void> {
    if (this._running) {
      vscode.window.showWarningMessage('A script is already running.');
      return;
    }

    this._running = true;
    this._activeConnection = connection;
    this._diagnostics.clear();

    try {
      const result = await connection.executeRaw(code);

      if (result.stderr) {
        this._diagnostics.setFromStderr(result.stderr, sourceUri);
      }
    } finally {
      this._running = false;
      this._activeConnection = undefined;
    }
  }

  dispose(): void {
    this._diagnostics.dispose();
  }
}
