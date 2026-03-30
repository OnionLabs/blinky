import * as vscode from 'vscode';

/**
 * Provides clickable links in the REPL terminal for MicroPython tracebacks.
 * Matches patterns like:  File "main.py", line 12
 * Opens the corresponding local file at the indicated line.
 */
export class MicroPythonLinkProvider implements vscode.TerminalLinkProvider {
  private static readonly TRACEBACK_RE = /File "([^"]+)", line (\d+)/g;

  provideTerminalLinks(
    context: vscode.TerminalLinkContext,
  ): vscode.TerminalLink[] {
    const links: vscode.TerminalLink[] = [];
    let match: RegExpExecArray | null;

    MicroPythonLinkProvider.TRACEBACK_RE.lastIndex = 0;
    while ((match = MicroPythonLinkProvider.TRACEBACK_RE.exec(context.line)) !== null) {
      const boardPath = match[1];
      const line = parseInt(match[2], 10);
      links.push({
        startIndex: match.index,
        length: match[0].length,
        tooltip: `Open ${boardPath}:${line}`,
        data: { boardPath, line },
      } as vscode.TerminalLink & { data: { boardPath: string; line: number } });
    }

    return links;
  }

  async handleTerminalLink(link: vscode.TerminalLink & { data?: { boardPath: string; line: number } }): Promise<void> {
    if (!link.data) return;

    const { boardPath, line } = link.data;

    // Strip leading / from board paths
    const relativePath = boardPath.startsWith('/') ? boardPath.slice(1) : boardPath;

    // Search workspace for the matching file
    const files = await vscode.workspace.findFiles(`**/${relativePath}`, undefined, 1);

    if (files.length > 0) {
      const doc = await vscode.workspace.openTextDocument(files[0]);
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
      });
    } else {
      vscode.window.showWarningMessage(
        `File "${relativePath}" not found in workspace. It may only exist on the board.`,
      );
    }
  }
}
