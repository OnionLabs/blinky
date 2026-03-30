import * as vscode from 'vscode';

/**
 * A single parsed error location from a MicroPython traceback.
 */
export interface ParsedError {
  /** Absolute path on the board, e.g. "/main.py" */
  boardPath: string;
  /** 1-based line number from the traceback */
  line: number;
  /** Error message (e.g. "NameError: name 'foo' is not defined") */
  message: string;
}

/**
 * MicroPython traceback format:
 *
 *   Traceback (most recent call last):
 *     File "main.py", line 5, in <module>
 *     File "lib/helper.py", line 12, in do_stuff
 *   NameError: name 'foo' is not defined
 *
 * Also handles single-line errors:
 *     File "<stdin>", line 1
 *   SyntaxError: invalid syntax
 */
const FILE_LINE_RE = /^\s*File "(.+?)", line (\d+)/;
const ERROR_LINE_RE = /^(\w+Error|Exception):\s*(.+)$/;
const SINGLE_ERROR_RE = /^(\w+Error|Exception)$/;

/**
 * Parses MicroPython traceback text into structured error locations.
 */
export function parseTraceback(text: string): ParsedError[] {
  const lines = text.split('\n');
  const errors: ParsedError[] = [];

  // Find error message - it's the last non-empty line after the traceback
  let errorMessage = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const errMatch = trimmed.match(ERROR_LINE_RE);
    if (errMatch) {
      errorMessage = trimmed;
      break;
    }
    const singleMatch = trimmed.match(SINGLE_ERROR_RE);
    if (singleMatch) {
      errorMessage = trimmed;
      break;
    }
  }

  if (!errorMessage) return errors;

  // Collect all File/line references
  for (const line of lines) {
    const match = line.match(FILE_LINE_RE);
    if (match) {
      const filePath = match[1];
      const lineNum = parseInt(match[2], 10);

      // Skip <stdin> entries - can't map to a file
      if (filePath === '<stdin>') continue;

      errors.push({
        boardPath: filePath.startsWith('/') ? filePath : `/${filePath}`,
        line: lineNum,
        message: errorMessage,
      });
    }
  }

  return errors;
}

/**
 * Manages VS Code diagnostics for MicroPython errors.
 * Maps board file paths to local workspace files when possible.
 */
export class DiagnosticManager implements vscode.Disposable {
  private _collection: vscode.DiagnosticCollection;

  constructor() {
    this._collection = vscode.languages.createDiagnosticCollection('blinky');
  }

  /**
   * Parse stderr from a script execution and set diagnostics.
   * @param stderr The raw stderr output from executeRaw
   * @param localFile Optional local file URI that was executed
   */
  setFromStderr(stderr: string, localFile?: vscode.Uri): void {
    this._collection.clear();

    const errors = parseTraceback(stderr);
    if (errors.length === 0) return;

    // Group errors by file
    const byFile = new Map<string, ParsedError[]>();
    for (const err of errors) {
      const key = err.boardPath;
      const list = byFile.get(key) ?? [];
      list.push(err);
      byFile.set(key, list);
    }

    for (const [boardPath, fileErrors] of byFile) {
      // Try to resolve to local workspace file
      const uri = this._resolveUri(boardPath, localFile);
      if (!uri) continue;

      const diagnostics = fileErrors.map((err) => {
        const range = new vscode.Range(
          err.line - 1, 0,
          err.line - 1, Number.MAX_SAFE_INTEGER,
        );
        const diag = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'blinky';
        return diag;
      });

      this._collection.set(uri, diagnostics);
    }
  }

  /**
   * Clear all diagnostics.
   */
  clear(): void {
    this._collection.clear();
  }

  dispose(): void {
    this._collection.dispose();
  }

  /**
   * Try to resolve a board path to a local workspace file URI.
   * Strategy: if localFile is provided and its basename matches, use it.
   * Otherwise, search workspace for the board filename.
   */
  private _resolveUri(boardPath: string, localFile?: vscode.Uri): vscode.Uri | undefined {
    const boardName = boardPath.split('/').pop()!;

    // If the executed local file matches the board path, use it directly
    if (localFile) {
      const localName = localFile.fsPath.split('/').pop()!;
      if (localName === boardName) {
        return localFile;
      }
    }

    // Try to find the file in the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.length) {
      // Return a URI for the expected local path - VS Code will show squiggles
      // even if the file doesn't exist yet (user can then see the error location)
      return vscode.Uri.joinPath(workspaceFolders[0].uri, boardPath);
    }

    return undefined;
  }
}
