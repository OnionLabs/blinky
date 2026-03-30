import * as vscode from 'vscode';

export const NOTEBOOK_TYPE = 'mpnb';

interface ReplNotebookData {
  cells: Array<{
    kind: 'code' | 'markdown';
    value: string;
    outputs?: Array<{
      type: 'stdout' | 'stderr' | 'error';
      text: string;
    }>;
  }>;
}

/**
 * Serializer for .mpnb notebook files.
 * Format is a simple JSON structure with cells and their outputs.
 */
export class ReplNotebookSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(
    content: Uint8Array,
  ): Promise<vscode.NotebookData> {
    const text = new TextDecoder().decode(content);

    let raw: ReplNotebookData;
    try {
      raw = text.trim() ? JSON.parse(text) : { cells: [] };
    } catch {
      raw = { cells: [{ kind: 'code', value: text }] };
    }

    const cells = raw.cells.map((cell) => {
      const kind = cell.kind === 'markdown'
        ? vscode.NotebookCellKind.Markup
        : vscode.NotebookCellKind.Code;

      const language = cell.kind === 'markdown' ? 'markdown' : 'python';
      const cellData = new vscode.NotebookCellData(kind, cell.value, language);

      // Restore outputs
      if (cell.outputs?.length) {
        cellData.outputs = cell.outputs.map((out) => {
          if (out.type === 'error') {
            return new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.stderr(out.text),
            ]);
          }
          return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stdout(out.text),
          ]);
        });
      }

      return cellData;
    });

    // Ensure at least one empty code cell
    if (cells.length === 0) {
      cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'python'));
    }

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
  ): Promise<Uint8Array> {
    const cells = data.cells.map((cell) => {
      const kind = cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' as const : 'code' as const;

      const outputs = cell.outputs?.flatMap((output) =>
        output.items.map((item) => {
          const text = new TextDecoder().decode(item.data);
          const type = item.mime.includes('stderr') ? 'error' as const : 'stdout' as const;
          return { type, text };
        }),
      ) ?? [];

      return {
        kind,
        value: cell.value,
        ...(outputs.length > 0 ? { outputs } : {}),
      };
    });

    const raw: ReplNotebookData = { cells };
    return new TextEncoder().encode(JSON.stringify(raw, null, 2) + '\n');
  }
}
