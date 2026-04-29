import * as vscode from 'vscode';
import { DeviceConnection } from '../connection/DeviceConnection';
import { BoardFileSystem } from '../filesystem/BoardFileSystem';
import { DiagnosticManager } from './DiagnosticParser';

/**
 * Handles uploading and executing Python scripts on a MicroPython board.
 * Output streams live to the Output Channel; errors produce diagnostics.
 */
export class ScriptRunner implements vscode.Disposable {
  private _diagnostics: DiagnosticManager;
  private _output: vscode.OutputChannel;
  private _running = false;
  private _activeConnection: DeviceConnection | undefined;
  private _cts: vscode.CancellationTokenSource | undefined;

  constructor(diagnostics: DiagnosticManager, output: vscode.OutputChannel) {
    this._diagnostics = diagnostics;
    this._output = output;
  }

  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Cancel the currently running script.
   * Works even if the board has reset or disconnected.
   */
  async cancel(): Promise<void> {
    this._cts?.cancel();
    if (this._activeConnection?.isConnected) {
      await this._activeConnection.interrupt().catch(() => {});
    }
  }

  /**
   * Run a local Python file on the board:
   * 1. Upload the file to the board
   * 2. Execute it via streaming raw REPL (no timeout)
   * 3. Stream stdout to the Output Channel in real time
   * 4. Parse any errors into diagnostics
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
    this._cts = new vscode.CancellationTokenSource();
    this._diagnostics.clear();

    try {
      // Read local file
      const fileData = await vscode.workspace.fs.readFile(localUri);
      const code = Buffer.from(fileData).toString('utf-8');
      const fileName = localUri.fsPath.split('/').pop()!;
      const remotePath = `/${fileName}`;

      const internalToken = this._cts.token;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Running ${fileName}…`, cancellable: true },
        async (progress, token) => {
          // Merge the UI cancel button with the internal cancellation
          const merged = new vscode.CancellationTokenSource();
          const uiSub = token.onCancellationRequested(() => merged.cancel());
          const internalSub = internalToken.onCancellationRequested(() => merged.cancel());
          try {
            // Step 1: Upload
            progress.report({ message: 'Uploading…' });
            await boardFs.writeFile(remotePath, code);

            if (merged.token.isCancellationRequested) return;

            // Step 2: Execute with streaming output. We pass the path through
            // a base64-decoded variable rather than embedding it as a string
            // literal so paths containing quotes/newlines can't break parsing
            // or be exploited as a Python-injection vector.
            progress.report({ message: 'Executing…' });
            this._output.appendLine(`--- Running ${fileName} ---`);
            this._output.show(true);

            const pathB64 = Buffer.from(remotePath, 'utf-8').toString('base64');
            const execCode =
              `import ubinascii\n` +
              `__p=ubinascii.a2b_base64(${JSON.stringify(pathB64)}).decode()\n` +
              `exec(compile(open(__p).read(), __p, 'exec'))\n` +
              `del __p`;
            let rebootDetected = false;
            const result = await connection.executeRawStreaming(execCode, {
              onStdout: (chunk) => {
                if (!rebootDetected && isRebootOutput(chunk)) {
                  rebootDetected = true;
                  merged.cancel();
                  return;
                }
                if (!rebootDetected) {
                  this._output.append(chunk);
                }
              },
              signal: merged.token,
            });

            // Step 3: Handle results
            if (rebootDetected) {
              this._output.appendLine('--- Board reset detected ---');
            } else if (result.stderr) {
              this._output.appendLine(result.stderr);
              this._diagnostics.setFromStderr(result.stderr, localUri);
              vscode.window.showErrorMessage(`${fileName}: ${result.stderr.split('\n').pop()?.trim() || 'Error'}`);
            } else {
              this._output.appendLine(`--- ${fileName} finished ---`);
            }
          } finally {
            uiSub.dispose();
            internalSub.dispose();
            merged.dispose();
          }
        },
      );
    } finally {
      this._cts?.dispose();
      this._cts = undefined;
      this._running = false;
      this._activeConnection = undefined;
    }
  }

  /**
   * Execute a code snippet directly (for Run Selection).
   * Does not upload - sends code straight to the board via streaming raw REPL.
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
    this._cts = new vscode.CancellationTokenSource();
    this._diagnostics.clear();

    try {
      this._output.show(true);
      let rebootDetected = false;
      const cts = this._cts;
      const result = await connection.executeRawStreaming(code, {
        onStdout: (chunk) => {
          if (!rebootDetected && isRebootOutput(chunk)) {
            rebootDetected = true;
            cts.cancel();
            return;
          }
          if (!rebootDetected) {
            this._output.append(chunk);
          }
        },
        signal: cts.token,
      });

      if (rebootDetected) {
        this._output.appendLine('--- Board reset detected ---');
      } else if (result.stderr) {
        this._output.appendLine(result.stderr);
        this._diagnostics.setFromStderr(result.stderr, sourceUri);
      }
    } finally {
      this._cts?.dispose();
      this._cts = undefined;
      this._running = false;
      this._activeConnection = undefined;
    }
  }

  dispose(): void {
    this._diagnostics.dispose();
  }
}

/**
 * Detect ESP ROM bootloader / MicroPython reboot output that indicates
 * the board has reset while a script was running.
 *
 * Anchored to start-of-line so user scripts that print these literal
 * strings (e.g. `print("ESP-ROM: foo")`) don't trigger a false positive.
 */
function isRebootOutput(chunk: string): boolean {
  return /(^|\r|\n)(ESP-ROM:|rst:0x|Build:|MicroPython v\d)/.test(chunk);
}
