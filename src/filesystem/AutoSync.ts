import * as path from 'path';
import * as vscode from 'vscode';
import { DeviceConnection } from '../connection/DeviceConnection';
import { BoardFileSystem } from './BoardFileSystem';

/**
 * Watches the workspace for file saves and automatically uploads
 * changed files to the connected MicroPython board.
 *
 * Toggle button lives in the Board Files view title bar.
 * Uses the `blinky.autoSyncEnabled` context key so package.json
 * can swap the icon between sync and sync-ignored.
 */
export class AutoSync implements vscode.Disposable {
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _enabled = false;
  private _getFs: () => BoardFileSystem | undefined;
  private _getConnection: () => DeviceConnection | undefined;
  private _outputChannel: vscode.OutputChannel;
  private _disposables: vscode.Disposable[] = [];
  private _uploading = false;
  private _onDidUpload: (() => void) | undefined;

  constructor(
    getFs: () => BoardFileSystem | undefined,
    getConnection: () => DeviceConnection | undefined,
    outputChannel: vscode.OutputChannel,
    onDidUpload?: () => void,
  ) {
    this._getFs = getFs;
    this._getConnection = getConnection;
    this._outputChannel = outputChannel;
    this._onDidUpload = onDidUpload;
    vscode.commands.executeCommand('setContext', 'blinky.autoSyncEnabled', false);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  toggle(): void {
    if (this._enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  enable(): void {
    if (this._enabled) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showWarningMessage('Open a workspace folder to enable auto-sync.');
      return;
    }

    if (!this._getFs()) {
      vscode.window.showWarningMessage('Connect to a board first to enable auto-sync.');
      return;
    }

    this._enabled = true;
    vscode.commands.executeCommand('setContext', 'blinky.autoSyncEnabled', true);

    this._watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folders[0], '**/*'),
    );

    this._watcher.onDidChange((uri) => this._onFileSaved(uri, folders[0]));
    this._watcher.onDidCreate((uri) => this._onFileSaved(uri, folders[0]));
    this._watcher.onDidDelete((uri) => this._onFileDeleted(uri, folders[0]));

    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file' && folders[0]) {
        this._onFileSaved(doc.uri, folders[0]);
      }
    });
    this._disposables.push(saveListener);

    this._outputChannel.appendLine('Auto-sync enabled');
    vscode.window.showInformationMessage('Auto-sync enabled — files will upload on save.');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    vscode.commands.executeCommand('setContext', 'blinky.autoSyncEnabled', false);

    this._watcher?.dispose();
    this._watcher = undefined;

    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];

    this._outputChannel.appendLine('Auto-sync disabled');
  }

  dispose(): void {
    this.disable();
  }

  private async _onFileSaved(
    uri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
  ): Promise<void> {
    if (!this._enabled || this._uploading) return;

    const relativePath = path.relative(folder.uri.fsPath, uri.fsPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
    if (this._isExcluded(relativePath)) return;

    const conn = this._getConnection();
    if (!conn?.isConnected) return;

    // Set uploading early to prevent concurrent handlers from slipping through
    this._uploading = true;

    if (conn.isBusy) {
      this._outputChannel.appendLine(
        `Auto-sync: skipped ${relativePath} (board busy with another operation)`,
      );
      this._uploading = false;
      return;
    }

    // Probe whether a user script is running
    const isIdle = await conn.probeIdle();
    if (!isIdle) {
      const choice = await vscode.window.showErrorMessage(
        `Auto-sync: cannot upload "${relativePath}" — a script is running on the board.`,
        'Interrupt & Upload',
        'Skip',
      );
      if (choice !== 'Interrupt & Upload') {
        this._uploading = false;
        return;
      }
      await conn.writeRaw('\x03');
      await new Promise((r) => setTimeout(r, 300));
    }

    const remotePath = '/' + relativePath.split(path.sep).join('/');
    const boardFs = this._getFs();
    if (!boardFs) {
      this._uploading = false;
      return;
    }

    try {
      // Ensure parent directories exist on the board
      const parts = remotePath.split('/').filter(Boolean);
      if (parts.length > 1) {
        let dir = '';
        for (let i = 0; i < parts.length - 1; i++) {
          dir += '/' + parts[i];
          const exists = await boardFs.exists(dir);
          if (!exists) {
            await boardFs.mkdir(dir);
          }
        }
      }

      const content = await vscode.workspace.fs.readFile(uri);
      await boardFs.writeFile(remotePath, Buffer.from(content));
      this._outputChannel.appendLine(`Auto-sync: uploaded ${relativePath}`);
      this._onDidUpload?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._outputChannel.appendLine(`Auto-sync error: ${relativePath} — ${msg}`);
      vscode.window.showWarningMessage(`Auto-sync failed for ${relativePath}: ${msg}`);
    } finally {
      this._uploading = false;
    }
  }

  private async _onFileDeleted(
    uri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
  ): Promise<void> {
    if (!this._enabled || this._uploading) return;

    const relativePath = path.relative(folder.uri.fsPath, uri.fsPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
    if (this._isExcluded(relativePath)) return;

    const conn = this._getConnection();
    if (!conn?.isConnected) return;

    // Set uploading early to prevent concurrent handlers
    this._uploading = true;

    if (conn.isBusy) {
      this._outputChannel.appendLine(
        `Auto-sync: skipped delete ${relativePath} (board busy)`,
      );
      this._uploading = false;
      return;
    }

    const isIdle = await conn.probeIdle();
    if (!isIdle) {
      const choice = await vscode.window.showErrorMessage(
        `Auto-sync: cannot delete "${relativePath}" — a script is running on the board.`,
        'Interrupt & Delete',
        'Skip',
      );
      if (choice !== 'Interrupt & Delete') {
        this._uploading = false;
        return;
      }
      await conn.writeRaw('\x03');
      await new Promise((r) => setTimeout(r, 300));
    }

    const remotePath = '/' + relativePath.split(path.sep).join('/');
    const boardFs = this._getFs();
    if (!boardFs) {
      this._uploading = false;
      return;
    }

    try {
      // Try file removal first; if it fails, try directory removal
      try {
        await boardFs.rm(remotePath);
      } catch {
        await boardFs.rmdir(remotePath);
      }
      this._outputChannel.appendLine(`Auto-sync: deleted ${relativePath}`);
      this._onDidUpload?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._outputChannel.appendLine(`Auto-sync delete error: ${relativePath} — ${msg}`);
    } finally {
      this._uploading = false;
    }
  }

  private _isExcluded(relativePath: string): boolean {
    const config = vscode.workspace.getConfiguration('blinky');
    const excludes: string[] = config.get('syncExclude', []);
    const allExcludes = [...excludes, '.git', 'node_modules'];

    const segments = relativePath.split(path.sep);

    for (const pattern of allExcludes) {
      if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        if (relativePath.endsWith(ext)) return true;
      } else {
        if (segments.includes(pattern)) return true;
      }
    }

    return false;
  }
}
