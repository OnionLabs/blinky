import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerFileCommands } from '../src/filesystem/FileCommands';

// Capture registered commands
const registeredCommands = new Map<string, (...args: any[]) => any>();
vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((id: string, cb: any) => {
  registeredCommands.set(id, cb);
  return { dispose: () => {} };
});

function createMockFs() {
  return {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('content')),
    rm: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ls: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockTreeProvider() {
  return {
    refresh: vi.fn(),
  } as any;
}

function createMockContentProvider() {
  return {
    invalidate: vi.fn(),
  } as any;
}

describe('FileCommands', () => {
  let mockFs: ReturnType<typeof createMockFs>;
  let tree: ReturnType<typeof createMockTreeProvider>;
  let content: ReturnType<typeof createMockContentProvider>;

  function setup() {
    registeredCommands.clear();
    mockFs = createMockFs();
    tree = createMockTreeProvider();
    content = createMockContentProvider();
    const context = { subscriptions: [] } as any;
    registerFileCommands(context, tree, () => mockFs, content);
  }

  it('registers all expected commands', () => {
    setup();
    expect(registeredCommands.has('blinky.uploadFile')).toBe(true);
    expect(registeredCommands.has('blinky.downloadFile')).toBe(true);
    expect(registeredCommands.has('blinky.deleteEntry')).toBe(true);
    expect(registeredCommands.has('blinky.renameEntry')).toBe(true);
    expect(registeredCommands.has('blinky.newFolder')).toBe(true);
    expect(registeredCommands.has('blinky.newFile')).toBe(true);
    expect(registeredCommands.has('blinky.previewFile')).toBe(true);
    expect(registeredCommands.has('blinky.refreshFiles')).toBe(true);
  });

  describe('deleteEntry', () => {
    it('deletes a file after confirmation', async () => {
      setup();
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as any);
      const entry = { name: 'test.py', path: '/test.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.deleteEntry')!(entry);
      expect(mockFs.rm).toHaveBeenCalledWith('/test.py');
      expect(tree.refresh).toHaveBeenCalled();
    });

    it('deletes a directory after confirmation', async () => {
      setup();
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as any);
      const entry = { name: 'lib', path: '/lib', isDir: true, size: 0 };
      await registeredCommands.get('blinky.deleteEntry')!(entry);
      expect(mockFs.rmdir).toHaveBeenCalledWith('/lib');
    });

    it('does nothing when user cancels', async () => {
      setup();
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);
      const entry = { name: 'test.py', path: '/test.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.deleteEntry')!(entry);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('does nothing without entry', async () => {
      setup();
      await registeredCommands.get('blinky.deleteEntry')!();
      expect(mockFs.rm).not.toHaveBeenCalled();
    });
  });

  describe('renameEntry', () => {
    it('renames a file', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('new.py');
      const entry = { name: 'old.py', path: '/old.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.renameEntry')!(entry);
      expect(mockFs.rename).toHaveBeenCalledWith('/old.py', '/new.py');
      expect(tree.refresh).toHaveBeenCalled();
    });

    it('renames in subdirectory', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('util.py');
      const entry = { name: 'helper.py', path: '/lib/helper.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.renameEntry')!(entry);
      expect(mockFs.rename).toHaveBeenCalledWith('/lib/helper.py', '/lib/util.py');
    });

    it('does nothing when user cancels', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);
      const entry = { name: 'old.py', path: '/old.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.renameEntry')!(entry);
      expect(mockFs.rename).not.toHaveBeenCalled();
    });

    it('does nothing when name unchanged', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('old.py');
      const entry = { name: 'old.py', path: '/old.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.renameEntry')!(entry);
      expect(mockFs.rename).not.toHaveBeenCalled();
    });
  });

  describe('newFolder', () => {
    it('creates a folder at root', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('data');
      await registeredCommands.get('blinky.newFolder')!();
      expect(mockFs.mkdir).toHaveBeenCalledWith('/data');
      expect(tree.refresh).toHaveBeenCalled();
    });

    it('creates a folder inside a directory', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('sub');
      const entry = { name: 'lib', path: '/lib', isDir: true, size: 0 };
      await registeredCommands.get('blinky.newFolder')!(entry);
      expect(mockFs.mkdir).toHaveBeenCalledWith('/lib/sub');
    });

    it('does nothing when cancelled', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);
      await registeredCommands.get('blinky.newFolder')!();
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });
  });

  describe('newFile', () => {
    it('creates an empty file at root', async () => {
      setup();
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('config.json');
      await registeredCommands.get('blinky.newFile')!();
      expect(mockFs.writeFile).toHaveBeenCalledWith('/config.json', '');
      expect(tree.refresh).toHaveBeenCalled();
    });
  });

  describe('refreshFiles', () => {
    it('refreshes the tree', () => {
      setup();
      registeredCommands.get('blinky.refreshFiles')!();
      expect(tree.refresh).toHaveBeenCalled();
    });
  });

  describe('uploadFile', () => {
    it('uploads selected files', async () => {
      setup();
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue([
        vscode.Uri.file('/local/main.py'),
      ] as any);
      await registeredCommands.get('blinky.uploadFile')!();
      expect(mockFs.writeFile).toHaveBeenCalledWith('/main.py', expect.any(Buffer));
      expect(tree.refresh).toHaveBeenCalled();
    });

    it('uploads to a target directory', async () => {
      setup();
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue([
        vscode.Uri.file('/local/util.py'),
      ] as any);
      const entry = { name: 'lib', path: '/lib', isDir: true, size: 0 };
      await registeredCommands.get('blinky.uploadFile')!(entry);
      expect(mockFs.writeFile).toHaveBeenCalledWith('/lib/util.py', expect.any(Buffer));
    });

    it('does nothing when dialog cancelled', async () => {
      setup();
      vi.spyOn(vscode.window, 'showOpenDialog').mockResolvedValue(undefined);
      await registeredCommands.get('blinky.uploadFile')!();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('downloadFile', () => {
    it('downloads a file to workspace', async () => {
      setup();
      const entry = { name: 'main.py', path: '/main.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.downloadFile')!(entry);
      expect(mockFs.readFile).toHaveBeenCalledWith('/main.py');
    });

    it('does nothing for directories', async () => {
      setup();
      const entry = { name: 'lib', path: '/lib', isDir: true, size: 0 };
      await registeredCommands.get('blinky.downloadFile')!(entry);
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('does nothing without workspace folder', async () => {
      setup();
      const origFolders = vscode.workspace.workspaceFolders;
      vscode.workspace.workspaceFolders = undefined;
      const entry = { name: 'main.py', path: '/main.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.downloadFile')!(entry);
      expect(mockFs.readFile).not.toHaveBeenCalled();
      vscode.workspace.workspaceFolders = origFolders;
    });
  });

  describe('previewFile', () => {
    it('opens board file in preview mode', async () => {
      setup();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(
        { label: '$(eye) Preview', description: 'Open read-only from board', value: 'preview' } as any,
      );
      const showSpy = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any);
      const entry = { name: 'main.py', path: '/main.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.previewFile')!(entry);
      expect(content.invalidate).toHaveBeenCalledWith('/main.py');
      expect(showSpy).toHaveBeenCalled();
    });

    it('downloads and edits when user chooses edit', async () => {
      setup();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(
        { label: '$(pencil) Download & Edit', description: 'Save to workspace and open for editing', value: 'edit' } as any,
      );
      const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
      const entry = { name: 'main.py', path: '/main.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.previewFile')!(entry);
      expect(execSpy).toHaveBeenCalledWith('blinky.downloadFile', entry);
    });

    it('does nothing when quick pick cancelled', async () => {
      setup();
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
      const entry = { name: 'main.py', path: '/main.py', isDir: false, size: 10 };
      await registeredCommands.get('blinky.previewFile')!(entry);
      expect(content.invalidate).not.toHaveBeenCalled();
    });

    it('does nothing for directories', async () => {
      setup();
      const entry = { name: 'lib', path: '/lib', isDir: true, size: 0 };
      await registeredCommands.get('blinky.previewFile')!(entry);
      expect(content.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('requireFs guard', () => {
    it('shows warning when not connected', async () => {
      registeredCommands.clear();
      tree = createMockTreeProvider();
      content = createMockContentProvider();
      const context = { subscriptions: [] } as any;
      const spy = vi.spyOn(vscode.window, 'showWarningMessage');
      registerFileCommands(context, tree, () => undefined, content);
      await registeredCommands.get('blinky.newFile')!();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Connect'));
    });
  });
});
