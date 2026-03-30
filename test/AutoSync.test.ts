import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AutoSync } from '../src/filesystem/AutoSync';

// Helpers to build mock dependencies
function createMockFs() {
  return {
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    ls: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockConnection(opts: { connected?: boolean; busy?: boolean; idle?: boolean } = {}) {
  return {
    isConnected: opts.connected ?? true,
    isBusy: opts.busy ?? false,
    probeIdle: vi.fn().mockResolvedValue(opts.idle ?? true),
    writeRaw: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockOutputChannel() {
  return {
    appendLine: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

describe('AutoSync', () => {
  let autoSync: AutoSync;
  let mockFs: ReturnType<typeof createMockFs>;
  let mockConn: ReturnType<typeof createMockConnection>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let uploadCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFs = createMockFs();
    mockConn = createMockConnection();
    outputChannel = createMockOutputChannel();
    uploadCallback = vi.fn();
    autoSync = new AutoSync(() => mockFs, () => mockConn, outputChannel, uploadCallback);
  });

  afterEach(() => {
    autoSync.dispose();
  });

  describe('enable/disable/toggle', () => {
    it('starts disabled', () => {
      expect(autoSync.enabled).toBe(false);
    });

    it('enables when prerequisites are met', () => {
      autoSync.enable();
      expect(autoSync.enabled).toBe(true);
    });

    it('disables after enable', () => {
      autoSync.enable();
      autoSync.disable();
      expect(autoSync.enabled).toBe(false);
    });

    it('toggle flips state', () => {
      autoSync.toggle();
      expect(autoSync.enabled).toBe(true);
      autoSync.toggle();
      expect(autoSync.enabled).toBe(false);
    });

    it('does not double-enable', () => {
      autoSync.enable();
      autoSync.enable();
      expect(autoSync.enabled).toBe(true);
    });

    it('does not double-disable', () => {
      autoSync.disable();
      expect(autoSync.enabled).toBe(false);
    });

    it('warns when no workspace folders', () => {
      const spy = vi.spyOn(vscode.window, 'showWarningMessage');
      const saved = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;
      autoSync.enable();
      expect(autoSync.enabled).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('workspace folder'));
      (vscode.workspace as any).workspaceFolders = saved;
    });

    it('warns when no board filesystem', () => {
      const spy = vi.spyOn(vscode.window, 'showWarningMessage');
      const noFs = new AutoSync(() => undefined, () => mockConn, outputChannel);
      noFs.enable();
      expect(noFs.enabled).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Connect'));
      noFs.dispose();
    });

    it('sets context key on enable/disable', () => {
      const spy = vi.spyOn(vscode.commands, 'executeCommand');
      autoSync.enable();
      expect(spy).toHaveBeenCalledWith('setContext', 'blinky.autoSyncEnabled', true);
      autoSync.disable();
      expect(spy).toHaveBeenCalledWith('setContext', 'blinky.autoSyncEnabled', false);
    });

    it('dispose disables', () => {
      autoSync.enable();
      autoSync.dispose();
      expect(autoSync.enabled).toBe(false);
    });
  });

  describe('_isExcluded (via _onFileSaved)', () => {
    // We test exclusion indirectly by calling the internal handler
    // via the public interface after enabling

    it('excludes .git paths', async () => {
      autoSync.enable();
      // Access internal method for direct testing
      const isExcluded = (autoSync as any)._isExcluded('.git/config');
      expect(isExcluded).toBe(true);
    });

    it('excludes node_modules paths', () => {
      autoSync.enable();
      const isExcluded = (autoSync as any)._isExcluded('node_modules/pkg/index.js');
      expect(isExcluded).toBe(true);
    });

    it('excludes by glob extension pattern', () => {
      // Default syncExclude includes nothing extra,
      // but .git and node_modules are always added
      const isExcluded = (autoSync as any)._isExcluded('something.pyc');
      // Default syncExclude is [] so *.pyc isn't excluded unless configured
      expect(isExcluded).toBe(false);
    });

    it('does not exclude normal files', () => {
      const isExcluded = (autoSync as any)._isExcluded('main.py');
      expect(isExcluded).toBe(false);
    });
  });

  describe('_onFileSaved', () => {
    const folder = { uri: vscode.Uri.file('/workspace') } as vscode.WorkspaceFolder;

    it('uploads a file when enabled and idle', async () => {
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/main.py');

      await (autoSync as any)._onFileSaved(uri, folder);

      expect(mockFs.writeFile).toHaveBeenCalledWith('/main.py', expect.any(Buffer));
      expect(uploadCallback).toHaveBeenCalled();
    });

    it('skips when disabled', async () => {
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('skips when connection is not connected', async () => {
      mockConn.isConnected = false;
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('skips when board is busy', async () => {
      mockConn.isBusy = true;
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('board busy'));
    });

    it('skips path traversal (..)', async () => {
      autoSync.enable();
      const uri = vscode.Uri.file('/other/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('skips excluded paths', async () => {
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/.git/config');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('shows error and skips when board is not idle and user skips', async () => {
      mockConn.probeIdle.mockResolvedValue(false);
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Skip' as any);
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('interrupts and uploads when user chooses Interrupt & Upload', async () => {
      mockConn.probeIdle.mockResolvedValue(false);
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Interrupt & Upload' as any);
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockConn.writeRaw).toHaveBeenCalledWith('\x03');
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('handles upload error gracefully', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('write failed'));
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('write failed'));
    });

    it('skips when already uploading', async () => {
      autoSync.enable();
      (autoSync as any)._uploading = true;
      const uri = vscode.Uri.file('/workspace/main.py');
      await (autoSync as any)._onFileSaved(uri, folder);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('skips when no boardFs available at upload time', async () => {
      const noFsSync = new AutoSync(() => undefined, () => mockConn, outputChannel);
      // Trick: need a valid fs for enable(), then remove it
      const tempFs = createMockFs();
      const sync = new AutoSync(() => tempFs, () => mockConn, outputChannel);
      sync.enable();
      // Now swap to return undefined
      (sync as any)._getFs = () => undefined;
      const uri = vscode.Uri.file('/workspace/main.py');
      await (sync as any)._onFileSaved(uri, folder);
      expect(tempFs.writeFile).not.toHaveBeenCalled();
      sync.dispose();
      noFsSync.dispose();
    });
  });

  describe('_onFileDeleted', () => {
    const folder = { uri: vscode.Uri.file('/workspace') } as vscode.WorkspaceFolder;

    it('deletes a file when enabled and idle', async () => {
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/old.py');
      await (autoSync as any)._onFileDeleted(uri, folder);
      expect(mockFs.rm).toHaveBeenCalledWith('/old.py');
      expect(uploadCallback).toHaveBeenCalled();
    });

    it('skips when disabled', async () => {
      const uri = vscode.Uri.file('/workspace/old.py');
      await (autoSync as any)._onFileDeleted(uri, folder);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('skips path traversal', async () => {
      autoSync.enable();
      const uri = vscode.Uri.file('/other/old.py');
      await (autoSync as any)._onFileDeleted(uri, folder);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('skips when board is busy', async () => {
      mockConn.isBusy = true;
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/old.py');
      await (autoSync as any)._onFileDeleted(uri, folder);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('handles delete error gracefully', async () => {
      mockFs.rm.mockRejectedValue(new Error('rm failed'));
      mockFs.rmdir.mockRejectedValue(new Error('rmdir failed'));
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/old.py');
      await (autoSync as any)._onFileDeleted(uri, folder);
      expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('rmdir failed'));
    });

    it('interrupts and deletes when user chooses Interrupt & Delete', async () => {
      mockConn.probeIdle.mockResolvedValue(false);
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Interrupt & Delete' as any);
      autoSync.enable();
      const uri = vscode.Uri.file('/workspace/old.py');
      await (autoSync as any)._onFileDeleted(uri, folder);
      expect(mockConn.writeRaw).toHaveBeenCalledWith('\x03');
      expect(mockFs.rm).toHaveBeenCalled();
    });

    it('skips when connection is not present', async () => {
      const sync = new AutoSync(() => mockFs, () => undefined, outputChannel);
      const tempFs = createMockFs();
      const sync2 = new AutoSync(() => tempFs, () => undefined, outputChannel);
      // Need to get past enable check
      (sync as any)._enabled = true;
      const uri = vscode.Uri.file('/workspace/old.py');
      await (sync as any)._onFileDeleted(uri, folder);
      expect(mockFs.rm).not.toHaveBeenCalled();
      sync.dispose();
      sync2.dispose();
    });
  });
});
