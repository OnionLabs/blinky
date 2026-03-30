import * as vscode from 'vscode';
import { BoardFileSystem } from './BoardFileSystem';

export const BOARD_SCHEME = 'upyboard';

/**
 * Virtual document provider for board files.
 * Uses a `upyboard:` URI scheme so the same board file always opens in the same tab.
 * Content is cached and only refreshed on explicit invalidation.
 */
export class BoardContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  private _cache = new Map<string, string>();
  private _getFs: () => BoardFileSystem | undefined;

  constructor(getFs: () => BoardFileSystem | undefined) {
    this._getFs = getFs;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const boardPath = uri.path;

    // Return cached content if available
    const cached = this._cache.get(boardPath);
    if (cached !== undefined) return cached;

    const fs = this._getFs();
    if (!fs) return '// Not connected to board';

    try {
      const content = await fs.readTextFile(boardPath);
      this._cache.set(boardPath, content);
      return content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `// Error reading ${boardPath}: ${message}`;
    }
  }

  /**
   * Invalidate a specific file's cache (e.g. after upload/sync).
   */
  invalidate(boardPath: string): void {
    this._cache.delete(boardPath);
    this._onDidChange.fire(vscode.Uri.parse(`${BOARD_SCHEME}:${boardPath}`));
  }

  /**
   * Invalidate all cached content.
   */
  invalidateAll(): void {
    const paths = [...this._cache.keys()];
    this._cache.clear();
    for (const p of paths) {
      this._onDidChange.fire(vscode.Uri.parse(`${BOARD_SCHEME}:${p}`));
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._cache.clear();
  }
}
