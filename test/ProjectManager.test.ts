import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { openPendingScaffold, scaffoldProject } from '../src/project/ProjectManager';

function createMockMemento(data: Record<string, any> = {}) {
  const store = { ...data };
  return {
    get: <T>(key: string, defaultValue?: T): T => (store[key] as T) ?? (defaultValue as T),
    update: vi.fn(async (key: string, value: any) => {
      if (value === undefined) {
        delete store[key];
      } else {
        store[key] = value;
      }
    }),
    keys: () => Object.keys(store),
  } as any as vscode.Memento;
}

describe('ProjectManager', () => {
  describe('openPendingScaffold', () => {
    it('does nothing when no pending scaffold', async () => {
      const memento = createMockMemento();
      await openPendingScaffold(memento);
      expect(memento.update).not.toHaveBeenCalled();
    });

    it('opens main.py and clears pending when marker exists', async () => {
      const memento = createMockMemento({ 'blinky.pendingScaffoldOpen': '/workspace/project' });
      const showSpy = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any);
      vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

      await openPendingScaffold(memento);

      expect(memento.update).toHaveBeenCalledWith('blinky.pendingScaffoldOpen', undefined);
      expect(showSpy).toHaveBeenCalled();
    });

    it('handles file not found gracefully', async () => {
      const memento = createMockMemento({ 'blinky.pendingScaffoldOpen': '/workspace/project' });
      vi.spyOn(vscode.window, 'showTextDocument').mockRejectedValue(new Error('not found'));
      vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

      // Should not throw
      await openPendingScaffold(memento);
    });

    it('handles walkthrough command failure gracefully', async () => {
      const memento = createMockMemento({ 'blinky.pendingScaffoldOpen': '/workspace/project' });
      vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any);
      vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(new Error('no walkthrough'));

      // Should not throw
      await openPendingScaffold(memento);
    });
  });

  describe('scaffoldProject', () => {
    it('does nothing when user cancels template pick', async () => {
      const memento = createMockMemento();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

      await scaffoldProject(memento, process.cwd());
      expect(memento.update).not.toHaveBeenCalled();
    });

    it('does nothing when user cancels folder picker', async () => {
      const memento = createMockMemento();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ id: 'blink' } as any);
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue(undefined);

      await scaffoldProject(memento, process.cwd());
      expect(memento.update).not.toHaveBeenCalled();
    });

    it('writes template files to selected folder', async () => {
      const memento = createMockMemento();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ id: 'blink' } as any);
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue([vscode.Uri.file('/tmp/proj')] as any);
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);
      const writeSpy = vi.spyOn(vscode.workspace.fs, 'writeFile');
      const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

      await scaffoldProject(memento, process.cwd());

      expect(writeSpy).toHaveBeenCalled();
      // Should open folder since it's different from workspace
      expect(execSpy).toHaveBeenCalledWith('vscode.openFolder', expect.anything());
    });

    it('opens main.py when folder matches workspace', async () => {
      const memento = createMockMemento();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ id: 'blink' } as any);
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue(
        [vscode.Uri.file('/workspace')] as any,
      );
      const showSpy = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any);

      await scaffoldProject(memento, process.cwd());

      expect(showSpy).toHaveBeenCalled();
    });

    it('skips existing files when user says No', async () => {
      const memento = createMockMemento();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ id: 'blink' } as any);
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue([vscode.Uri.file('/tmp/proj')] as any);
      // Make stat succeed (file exists)
      vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({} as any);
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('No' as any);
      const writeSpy = vi.spyOn(vscode.workspace.fs, 'writeFile');
      vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

      await scaffoldProject(memento, process.cwd());

      // Should skip existing files — writeFile not called for files that exist
      // But it still writes since skipExisting only skips ones in the existing list
      // The key point is it doesn't abort entirely
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('aborts when user dismisses overwrite dialog', async () => {
      const memento = createMockMemento();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ id: 'blink' } as any);
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue([vscode.Uri.file('/tmp/proj')] as any);
      vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({} as any);
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);
      const writeSpy = vi.spyOn(vscode.workspace.fs, 'writeFile');

      await scaffoldProject(memento, process.cwd());

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});
