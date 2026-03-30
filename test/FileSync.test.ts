import * as crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DeviceConnection } from '../src/connection/DeviceConnection';
import { BoardFileSystem } from '../src/filesystem/BoardFileSystem';
import { FileSync } from '../src/filesystem/FileSync';

/**
 * Mock DeviceConnection for FileSync tests.
 * We don't need real serial - just mock executeRaw() responses.
 */
function createMockConnection() {
  const executeRaw = vi.fn();
  return {
    connection: { executeRaw } as unknown as DeviceConnection,
    executeRaw,
  };
}

/**
 * Helper: compute SHA256 of data (same as FileSync.hashLocal).
 */
function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * The default syncExclude config value (matches package.json default).
 */
const DEFAULT_SYNC_EXCLUDE = [
  '.git', '.vscode', '__pycache__', '.DS_Store', 'node_modules',
  '*.pyc', '.gitignore', '.venv', 'venv',
];

/**
 * Mock workspace.getConfiguration to return the default syncExclude list.
 */
function mockSyncConfig() {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (_key: string, defaultValue?: any) => {
      if (_key === 'syncExclude') return DEFAULT_SYNC_EXCLUDE;
      return defaultValue;
    },
  } as any);
}

/**
 * Helper to mock a board snapshot response.
 */
function mockSnapshot(mock: ReturnType<typeof createMockConnection>, entries: any[]) {
  mock.executeRaw.mockResolvedValueOnce({
    stdout: JSON.stringify(entries),
    stderr: '',
  });
}

describe('FileSync', () => {
  let mock: ReturnType<typeof createMockConnection>;
  let boardFs: BoardFileSystem;
  let fileSync: FileSync;

  beforeEach(() => {
    mock = createMockConnection();
    boardFs = new BoardFileSystem(mock.connection);
    fileSync = new FileSync(mock.connection, boardFs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('snapshot', () => {
    it('returns parsed board file tree with hashes', async () => {
      const hash = sha256('hello');
      mockSnapshot(mock, [
        { path: '/main.py', isDir: false, size: 5, hash },
        { path: '/lib', isDir: true, size: 0, hash: null },
      ]);

      const result = await fileSync.snapshot();
      expect(result).toHaveLength(2);
      expect(result[0].hash).toBe(hash);
      expect(result[1].isDir).toBe(true);
    });

    it('throws on stderr', async () => {
      mock.executeRaw.mockResolvedValueOnce({ stdout: '', stderr: 'crash' });
      await expect(fileSync.snapshot()).rejects.toThrow('Board snapshot failed');
    });
  });

  describe('hashLocal', () => {
    it('computes SHA256 of file content', async () => {
      const content = Buffer.from('print("hello")');
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValueOnce(content as any);

      const hash = await fileSync.hashLocal(vscode.Uri.file('/test.py'));
      expect(hash).toBe(sha256(content));
    });
  });

  describe('plan', () => {
    it('detects new files that need uploading', async () => {
      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([
        ['main.py', vscode.FileType.File],
      ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      // Board snapshot: empty
      mockSnapshot(mock, []);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.upload).toHaveLength(1);
      expect(plan.upload[0].remotePath).toBe('/main.py');
      expect(plan.upload[0].reason).toBe('new');
      expect(plan.orphaned).toHaveLength(0);
    });

    it('detects changed files by hash comparison', async () => {
      const localContent = Buffer.from('new code');
      const remoteHash = sha256('old code');

      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([
        ['main.py', vscode.FileType.File],
      ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(localContent as any);

      // Board snapshot: main.py exists with old hash
      mockSnapshot(mock, [
        { path: '/main.py', isDir: false, size: 10, hash: remoteHash },
      ]);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.upload).toHaveLength(1);
      expect(plan.upload[0].reason).toBe('changed');
    });

    it('skips unchanged files', async () => {
      const content = Buffer.from('same code');
      const hash = sha256(content);

      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([
        ['main.py', vscode.FileType.File],
      ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(content as any);

      // Board snapshot: same hash
      mockSnapshot(mock, [
        { path: '/main.py', isDir: false, size: 10, hash },
      ]);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.upload).toHaveLength(0);
      expect(plan.unchanged).toEqual(['/main.py']);
    });

    it('detects orphaned files on the board', async () => {
      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([]);

      mockSnapshot(mock, [
        { path: '/old.py', isDir: false, size: 5, hash: sha256('old') },
      ]);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.orphaned).toEqual(['/old.py']);
    });

    it('excludes system files from orphans', async () => {
      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([]);

      mockSnapshot(mock, [
        { path: '/boot.py', isDir: false, size: 50, hash: sha256('boot') },
        { path: '/webrepl_cfg.py', isDir: false, size: 20, hash: sha256('cfg') },
        { path: '/old.py', isDir: false, size: 5, hash: sha256('old') },
      ]);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      // boot.py and webrepl_cfg.py are system files - not orphaned
      expect(plan.orphaned).toEqual(['/old.py']);
    });

    it('excludes .git and __pycache__ by default', async () => {
      mockSyncConfig();
      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([
        ['.git', vscode.FileType.Directory],
        ['__pycache__', vscode.FileType.Directory],
        ['main.py', vscode.FileType.File],
      ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      mockSnapshot(mock, []);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.upload).toHaveLength(1);
      expect(plan.upload[0].remotePath).toBe('/main.py');
    });

    it('excludes *.pyc files', async () => {
      mockSyncConfig();
      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([
        ['main.py', vscode.FileType.File],
        ['module.pyc', vscode.FileType.File],
      ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      mockSnapshot(mock, []);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.upload).toHaveLength(1);
      expect(plan.upload[0].remotePath).toBe('/main.py');
    });

    it('includes directories that need creating', async () => {
      vi.spyOn(vscode.workspace.fs, 'readDirectory')
        .mockResolvedValueOnce([
          ['lib', vscode.FileType.Directory],
        ])
        .mockResolvedValueOnce([
          ['helper.py', vscode.FileType.File],
        ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      mockSnapshot(mock, []);

      const plan = await fileSync.plan(vscode.Uri.file('/workspace'));

      expect(plan.mkdirs).toEqual(['/lib']);
      expect(plan.upload).toHaveLength(1);
      expect(plan.upload[0].remotePath).toBe('/lib/helper.py');
    });

    it('uses only one executeRaw call for snapshot', async () => {
      vi.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValueOnce([
        ['a.py', vscode.FileType.File],
        ['b.py', vscode.FileType.File],
      ]);
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      const hashA = sha256(Buffer.from('code'));
      mockSnapshot(mock, [
        { path: '/a.py', isDir: false, size: 4, hash: hashA },
        { path: '/b.py', isDir: false, size: 4, hash: hashA },
      ]);

      await fileSync.plan(vscode.Uri.file('/workspace'));

      // Only 1 executeRaw call (the snapshot), not N+1
      expect(mock.executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute', () => {
    it('creates directories and uploads files', async () => {
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      // mkdir returns OK
      mock.executeRaw.mockResolvedValueOnce({ stdout: 'OK\n', stderr: '' });
      // writeFile (putStart) returns OK
      mock.executeRaw.mockResolvedValueOnce({ stdout: 'OK\n', stderr: '' });

      const plan = {
        mkdirs: ['/lib'],
        upload: [{ localUri: vscode.Uri.file('/workspace/lib/a.py'), remotePath: '/lib/a.py', reason: 'new' as const }],
        orphaned: [],
        unchanged: ['/boot.py'],
      };

      const result = await fileSync.execute(plan, { deleteOrphans: false });

      expect(result.uploaded).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('deletes orphans when requested', async () => {
      // rm returns OK
      mock.executeRaw.mockResolvedValueOnce({ stdout: 'OK\n', stderr: '' });

      const plan = {
        mkdirs: [],
        upload: [],
        orphaned: ['/old.py'],
        unchanged: [],
      };

      const result = await fileSync.execute(plan, { deleteOrphans: true });

      expect(result.deleted).toBe(1);
    });

    it('does not delete orphans when not requested', async () => {
      const plan = {
        mkdirs: [],
        upload: [],
        orphaned: ['/old.py'],
        unchanged: [],
      };

      const result = await fileSync.execute(plan, { deleteOrphans: false });

      expect(result.deleted).toBe(0);
      expect(mock.executeRaw).not.toHaveBeenCalled();
    });

    it('collects errors without stopping', async () => {
      vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from('code') as any);

      // writeFile fails
      mock.executeRaw.mockResolvedValueOnce({ stdout: 'ERR:disk full\n', stderr: '' });

      const plan = {
        mkdirs: [],
        upload: [{ localUri: vscode.Uri.file('/workspace/big.py'), remotePath: '/big.py', reason: 'changed' as const }],
        orphaned: [],
        unchanged: [],
      };

      const result = await fileSync.execute(plan, { deleteOrphans: false });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('upload /big.py');
    });
  });
});
