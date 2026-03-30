import * as vscode from 'vscode';
import { loadTemplates } from './Templates';

const PENDING_KEY = 'blinky.pendingScaffoldOpen';

/**
 * Open main.py if a scaffold left a pending marker (after openFolder reload).
 */
export async function openPendingScaffold(globalState: vscode.Memento, extensionId: string): Promise<void> {
  const pending = globalState.get<string>(PENDING_KEY);
  if (!pending) return;
  await globalState.update(PENDING_KEY, undefined);
  const mainUri = vscode.Uri.joinPath(vscode.Uri.parse(pending), 'main.py');
  try {
    await vscode.window.showTextDocument(mainUri);
  } catch {
    // File may not exist if user removed it
  }
  // Reopen the walkthrough so users don't lose it after workspace switch
  try {
    await vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      `${extensionId}#blinky.getStarted`,
    );
  } catch {
    // Walkthrough may not exist - ignore
  }
}

export async function scaffoldProject(globalState: vscode.Memento, extensionPath: string): Promise<void> {
  const templates = loadTemplates(extensionPath);
  const picked = await vscode.window.showQuickPick(
    templates.map((t) => ({ label: t.label, description: t.description, id: t.id })),
    { placeHolder: 'Select a project template' },
  );
  if (!picked) return;

  const template = templates.find((t) => t.id === picked.id);
  if (!template) return;

  const folders = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Project Folder',
  });
  if (!folders?.length) return;

  const folderUri = folders[0];
  const filesToWrite = Object.entries(template.files);

  // Check for existing files
  const existing: string[] = [];
  for (const [relativePath] of filesToWrite) {
    const fileUri = vscode.Uri.joinPath(folderUri, relativePath);
    try {
      await vscode.workspace.fs.stat(fileUri);
      existing.push(relativePath);
    } catch {
      // Does not exist
    }
  }

  let skipExisting = false;
  if (existing.length > 0) {
    const answer = await vscode.window.showWarningMessage(
      `Some files already exist (${existing.join(', ')}). Overwrite?`,
      'Yes',
      'No',
    );
    if (answer === 'No') skipExisting = true;
    if (!answer) return;
  }

  for (const [relativePath, content] of filesToWrite) {
    if (skipExisting && existing.includes(relativePath)) continue;
    const fileUri = vscode.Uri.joinPath(folderUri, relativePath);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content));
  }

  const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
  if (currentFolder !== folderUri.toString()) {
    // Store pending so main.py opens after reload
    await globalState.update(PENDING_KEY, folderUri.toString());
    await vscode.commands.executeCommand('vscode.openFolder', folderUri);
  } else {
    await vscode.window.showTextDocument(vscode.Uri.joinPath(folderUri, 'main.py'));
  }
}
