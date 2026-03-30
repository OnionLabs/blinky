import * as vscode from 'vscode';
import { DeviceConnection } from '../connection/DeviceConnection';
import { NOTEBOOK_TYPE } from './ReplNotebookSerializer';

/**
 * Notebook controller that executes cells on a connected MicroPython board.
 * Each cell is sent via executeRaw() - variables persist across cells
 * (same as running them sequentially in the REPL).
 */
export class ReplNotebookController {
  private _controller: vscode.NotebookController;
  private _executionOrder = 0;
  private _getConnection: () => DeviceConnection | undefined;

  constructor(getConnection: () => DeviceConnection | undefined) {
    this._getConnection = getConnection;

    this._controller = vscode.notebooks.createNotebookController(
      'blinky-repl',
      NOTEBOOK_TYPE,
      'MicroPython Board',
    );

    this._controller.supportedLanguages = ['python'];
    this._controller.supportsExecutionOrder = true;
    this._controller.description = 'Execute code on a connected MicroPython board';
    this._controller.executeHandler = this._executeAll.bind(this);
    this._controller.interruptHandler = this._interruptAll.bind(this);
  }

  dispose(): void {
    this._controller.dispose();
  }

  private _activeTokenSource: vscode.CancellationTokenSource | undefined;

  private _interruptAll(): void {
    this._activeTokenSource?.cancel();
  }

  private async _executeAll(
    cells: vscode.NotebookCell[],
  ): Promise<void> {
    for (const cell of cells) {
      await this._executeCell(cell);
    }
  }

  private async _executeCell(cell: vscode.NotebookCell): Promise<void> {
    const connection = this._getConnection();

    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    if (!connection?.isConnected) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.stderr(
            'Not connected to a board. Use the status bar or Cmd+Shift+P → blinky: Connect',
          ),
        ]),
      ]);
      execution.end(false, Date.now());
      return;
    }

    const code = cell.document.getText().trim();
    if (!code) {
      execution.replaceOutput([]);
      execution.end(true, Date.now());
      return;
    }

    const tokenSource = new vscode.CancellationTokenSource();
    this._activeTokenSource = tokenSource;
    execution.token.onCancellationRequested(() => tokenSource.cancel());

    let stdoutBuffer = '';

    try {
      const result = await connection.executeRawStreaming(code, {
        onStdout: (chunk: string) => {
          stdoutBuffer += chunk;
          execution.replaceOutput([
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.stdout(stdoutBuffer),
            ]),
          ]);
        },
        signal: tokenSource.token,
      });

      const outputs: vscode.NotebookCellOutput[] = [];

      if (result.stdout?.trim()) {
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stdout(result.stdout),
          ]),
        );
      }

      if (result.stderr?.trim()) {
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr(result.stderr),
          ]),
        );
      }

      execution.replaceOutput(outputs);
      execution.end(!result.stderr?.trim(), Date.now());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (tokenSource.token.isCancellationRequested) {
        const outputs: vscode.NotebookCellOutput[] = [];
        if (stdoutBuffer.trim()) {
          outputs.push(
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.stdout(stdoutBuffer),
            ]),
          );
        }
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr('Interrupted (KeyboardInterrupt)'),
          ]),
        );
        execution.replaceOutput(outputs);
        execution.end(false, Date.now());
      } else {
        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr(`Execution error: ${message}`),
          ]),
        ]);
        execution.end(false, Date.now());
      }
    } finally {
      this._activeTokenSource = undefined;
      tokenSource.dispose();
    }
  }
}
