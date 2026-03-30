import * as vscode from 'vscode';
import { BoardFileEntry, BoardFileSystem } from './BoardFileSystem';

/**
 * Tree data provider for the MicroPython board filesystem sidebar.
 * Shows a tree of files/folders on the connected board.
 */
export class FileTreeProvider implements vscode.TreeDataProvider<BoardFileEntry>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<BoardFileEntry | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _fs: BoardFileSystem | undefined;
  private _cache = new Map<string, BoardFileEntry[]>();
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

  get fs(): BoardFileSystem | undefined {
    return this._fs;
  }

  /**
   * Bind to a connected board's filesystem. Call with undefined on disconnect.
   */
  setFileSystem(fs: BoardFileSystem | undefined): void {
    this._fs = fs;
    this._cache.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Refresh the entire tree or a subtree.
   * Debounced to coalesce rapid successive calls.
   */
  refresh(element?: BoardFileEntry): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      // Don't clear the cache here - it serves as a fallback if ls() fails.
      // The cache is updated on every successful ls() in getChildren().
      this._onDidChangeTreeData.fire(element);
    }, 200);
  }

  getTreeItem(element: BoardFileEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.name,
      element.isDir
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    if (element.isDir) {
      item.contextValue = 'boardDir';
      item.iconPath = new vscode.ThemeIcon('folder');
    } else {
      item.contextValue = 'boardFile';
      item.iconPath = new vscode.ThemeIcon('file');
      item.description = this._formatSize(element.size);
      item.command = {
        command: 'blinky.previewFile',
        title: 'Open File',
        arguments: [element],
      };
    }

    item.tooltip = element.path;
    return item;
  }

  async getChildren(element?: BoardFileEntry): Promise<BoardFileEntry[]> {
    if (!this._fs) {
      return [];
    }

    const dir = element?.path ?? '/';
    try {
      const entries = await this._fs.ls(dir);
      // Sort: directories first, then alphabetical
      const sorted = entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      this._cache.set(dir, sorted);
      return sorted;
    } catch {
      // Return cached results instead of empty to avoid flickering
      return this._cache.get(dir) ?? [];
    }
  }

  dispose(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    this._onDidChangeTreeData.dispose();
  }

  private _formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
