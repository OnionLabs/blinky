import * as vscode from 'vscode';
import { BOARD_SCHEME, BoardContentProvider } from './BoardContentProvider';
import { BoardFileEntry, BoardFileSystem } from './BoardFileSystem';
import { FileTreeProvider } from './FileTreeProvider';

/**
 * Registers all filesystem-related commands.
 * Returns disposables to push into context.subscriptions.
 */
export function registerFileCommands(
  context: vscode.ExtensionContext,
  treeProvider: FileTreeProvider,
  getFs: () => BoardFileSystem | undefined,
  contentProvider: BoardContentProvider,
): vscode.Disposable[] {
  const requireFs = (): BoardFileSystem | undefined => {
    const fs = getFs();
    if (!fs) {
      vscode.window.showWarningMessage('Connect to a board first.');
    }
    return fs;
  };

  return [
    // Upload file to board
    vscode.commands.registerCommand('blinky.uploadFile', async (entry?: BoardFileEntry) => {
      const fs = requireFs();
      if (!fs) return;
      const targetDir = entry?.isDir ? entry.path : '/';

      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Upload to Board',
      });
      if (!uris?.length) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Uploading…' },
        async (progress) => {
          for (let i = 0; i < uris.length; i++) {
            const uri = uris[i];
            const fileName = uri.fsPath.split('/').pop()!;
            progress.report({ message: fileName, increment: (100 / uris.length) });

            const data = await vscode.workspace.fs.readFile(uri);
            const remotePath = targetDir === '/'
              ? `/${fileName}`
              : `${targetDir}/${fileName}`;
            await fs.writeFile(remotePath, Buffer.from(data));
          }
        },
      );

      treeProvider.refresh();
      vscode.window.showInformationMessage(`Uploaded ${uris.length} file(s)`);
    }),

    // Download file from board to workspace
    vscode.commands.registerCommand('blinky.downloadFile', async (entry?: BoardFileEntry) => {
      if (!entry || entry.isDir) return;
      const fs = requireFs();
      if (!fs) return;

      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showWarningMessage('Open a workspace folder first to download files.');
        return;
      }

      const localPath = vscode.Uri.joinPath(folders[0].uri, entry.path);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Downloading ${entry.name}…` },
        async () => {
          const data = await fs.readFile(entry.path);
          // Ensure parent directories exist locally
          const parentDir = vscode.Uri.joinPath(localPath, '..');
          await vscode.workspace.fs.createDirectory(parentDir);
          await vscode.workspace.fs.writeFile(localPath, data);
        },
      );

      const doc = await vscode.workspace.openTextDocument(localPath);
      await vscode.window.showTextDocument(doc);
    }),

    // Delete file or directory
    vscode.commands.registerCommand('blinky.deleteEntry', async (entry?: BoardFileEntry) => {
      if (!entry) return;
      const fs = requireFs();
      if (!fs) return;

      const confirm = await vscode.window.showWarningMessage(
        `Delete ${entry.path}?`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;

      if (entry.isDir) {
        await fs.rmdir(entry.path);
      } else {
        await fs.rm(entry.path);
      }

      treeProvider.refresh();
    }),

    // Rename file or directory
    vscode.commands.registerCommand('blinky.renameEntry', async (entry?: BoardFileEntry) => {
      if (!entry) return;
      const fs = requireFs();
      if (!fs) return;

      const newName = await vscode.window.showInputBox({
        prompt: `Rename ${entry.name} to:`,
        value: entry.name,
        validateInput: (v) => v.trim() ? null : 'Name cannot be empty',
      });
      if (!newName || newName === entry.name) return;

      const parentDir = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
      const newPath = parentDir === '/'
        ? `/${newName}`
        : `${parentDir}/${newName}`;

      await fs.rename(entry.path, newPath);
      treeProvider.refresh();
    }),

    // Create new folder
    vscode.commands.registerCommand('blinky.newFolder', async (entry?: BoardFileEntry) => {
      const fs = requireFs();
      if (!fs) return;
      const parentDir = entry?.isDir ? entry.path : '/';

      const name = await vscode.window.showInputBox({
        prompt: 'New folder name:',
        validateInput: (v) => v.trim() ? null : 'Name cannot be empty',
      });
      if (!name) return;

      const fullPath = parentDir === '/'
        ? `/${name}`
        : `${parentDir}/${name}`;

      await fs.mkdir(fullPath);
      treeProvider.refresh();
    }),

    // Create new file
    vscode.commands.registerCommand('blinky.newFile', async (entry?: BoardFileEntry) => {
      const fs = requireFs();
      if (!fs) return;
      const parentDir = entry?.isDir ? entry.path : '/';

      const name = await vscode.window.showInputBox({
        prompt: 'New file name:',
        validateInput: (v) => v.trim() ? null : 'Name cannot be empty',
      });
      if (!name) return;

      const fullPath = parentDir === '/'
        ? `/${name}`
        : `${parentDir}/${name}`;

      await fs.writeFile(fullPath, '');
      treeProvider.refresh();
    }),

    // Preview / open file content — let user choose preview or download
    vscode.commands.registerCommand('blinky.previewFile', async (entry?: BoardFileEntry) => {
      if (!entry || entry.isDir) return;
      const fs = requireFs();
      if (!fs) return;

      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) Preview', description: 'Open read-only from board', value: 'preview' as const },
          { label: '$(pencil) Download & Edit', description: 'Save to workspace and open for editing', value: 'edit' as const },
        ],
        { placeHolder: entry.name },
      );
      if (!choice) return;

      if (choice.value === 'edit') {
        await vscode.commands.executeCommand('blinky.downloadFile', entry);
      } else {
        contentProvider.invalidate(entry.path);
        const uri = vscode.Uri.parse(`${BOARD_SCHEME}:${entry.path}`);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(doc, guessLanguage(entry.name));
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    }),

    // Refresh tree
    vscode.commands.registerCommand('blinky.refreshFiles', () => {
      treeProvider.refresh();
    }),
  ];
}

function guessLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'py': return 'python';
    case 'json': return 'json';
    case 'txt': return 'plaintext';
    case 'html': return 'html';
    case 'css': return 'css';
    case 'js': return 'javascript';
    case 'cfg':
    case 'ini': return 'ini';
    default: return 'plaintext';
  }
}
