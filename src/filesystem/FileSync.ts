import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DeviceConnection } from '../connection/DeviceConnection';
import { BoardFileSystem } from './BoardFileSystem';

/**
 * Result of comparing local workspace files against board files.
 */
export interface SyncPlan {
  /** Files that need to be uploaded (new or changed) */
  upload: SyncEntry[];
  /** Files on the board that don't exist locally (candidates for deletion) */
  orphaned: string[];
  /** Directories that need to be created on the board */
  mkdirs: string[];
  /** Files that are already up-to-date */
  unchanged: string[];
}

export interface SyncEntry {
  localUri: vscode.Uri;
  remotePath: string;
  reason: 'new' | 'changed';
}

export interface SyncResult {
  uploaded: number;
  deleted: number;
  unchanged: number;
  errors: string[];
}

/** Patterns always excluded (non-configurable safety net) */
const BUILTIN_EXCLUDE = ['.git', 'node_modules'];

/** MicroPython system files that should never be considered orphans */
const SYSTEM_FILES = new Set(['/boot.py', '/webrepl_cfg.py']);

/**
 * Single Python script that recursively walks the board filesystem and
 * returns every entry with its SHA256 hash (files only). One round-trip
 * instead of N ls() + N hashRemote() calls.
 *
 * Output: JSON array of {path, isDir, size, hash} objects.
 * hash is null for directories and files that can't be read.
 */
const SNAPSHOT_SCRIPT = `
def _():
    import os, json, uhashlib, ubinascii
    def _walk(d):
        r = []
        try:
            for name in os.listdir(d):
                full = d + ('/' if d != '/' else '') + name
                try:
                    s = os.stat(full)
                    isdir = bool(s[0] & 0x4000)
                    if isdir:
                        r.append({'path': full, 'isDir': True, 'size': 0, 'hash': None})
                        r.extend(_walk(full))
                    else:
                        h = None
                        try:
                            ha = uhashlib.sha256()
                            f = open(full, 'rb')
                            while True:
                                c = f.read(512)
                                if not c:
                                    break
                                ha.update(c)
                            f.close()
                            h = ubinascii.hexlify(ha.digest()).decode()
                        except:
                            pass
                        r.append({'path': full, 'isDir': False, 'size': s[6], 'hash': h})
                except:
                    r.append({'path': full, 'isDir': False, 'size': 0, 'hash': None})
        except:
            pass
        return r
    print(json.dumps(_walk('/')))
_()
del _
`.trim();

interface BoardSnapshot {
  path: string;
  isDir: boolean;
  size: number;
  hash: string | null;
}

/**
 * Diff-based file synchronization between a local workspace folder and a MicroPython board.
 * Only uploads files that have changed (by SHA256 hash comparison).
 */
export class FileSync {
  private _connection: DeviceConnection;
  private _fs: BoardFileSystem;

  constructor(connection: DeviceConnection, boardFs: BoardFileSystem) {
    this._connection = connection;
    this._fs = boardFs;
  }

  /**
   * Get a full snapshot of the board filesystem (paths + hashes) in one round-trip.
   */
  async snapshot(): Promise<BoardSnapshot[]> {
    const result = await this._connection.executeRaw(SNAPSHOT_SCRIPT);
    if (result.stderr) {
      throw new Error(`Board snapshot failed: ${result.stderr}`);
    }
    return JSON.parse(result.stdout.trim());
  }

  /**
   * Compute SHA256 hash of a local file.
   */
  async hashLocal(uri: vscode.Uri): Promise<string> {
    const data = await vscode.workspace.fs.readFile(uri);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Build a sync plan by comparing local workspace files against board files.
   */
  async plan(workspaceFolder: vscode.Uri): Promise<SyncPlan> {
    const config = vscode.workspace.getConfiguration('blinky');
    const userExclude = config.get<string[]>('syncExclude', []);
    const excludePatterns = [...new Set([...BUILTIN_EXCLUDE, ...userExclude])];

    // Collect local files
    const localFiles = await this._collectLocalFiles(workspaceFolder, excludePatterns);

    // Collect board snapshot (one round-trip: full tree + hashes)
    const boardEntries = await this.snapshot();

    const boardFileMap = new Map<string, string | null>(); // path → hash
    const boardDirSet = new Set<string>();

    for (const entry of boardEntries) {
      if (entry.isDir) {
        boardDirSet.add(entry.path);
      } else {
        boardFileMap.set(entry.path, entry.hash);
      }
    }

    const upload: SyncEntry[] = [];
    const unchanged: string[] = [];
    const mkdirs: string[] = [];
    const neededDirs = new Set<string>();

    for (const local of localFiles) {
      const remotePath = local.remotePath;

      // Collect directories that need to exist
      const dir = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
      if (dir !== '/' && !boardDirSet.has(dir) && !neededDirs.has(dir)) {
        const parts = dir.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
          current += '/' + part;
          if (!boardDirSet.has(current) && !neededDirs.has(current)) {
            neededDirs.add(current);
            mkdirs.push(current);
          }
        }
      }

      if (!boardFileMap.has(remotePath)) {
        // New file
        upload.push({ localUri: local.uri, remotePath, reason: 'new' });
      } else {
        // Exists - compare hashes
        const remoteHash = boardFileMap.get(remotePath);
        const localHash = await this.hashLocal(local.uri);

        if (remoteHash === null) {
          // Board couldn't hash the file (eg. unreadable, transient FS error).
          // Treat as needing upload but mark as 'changed' for visibility.
          upload.push({ localUri: local.uri, remotePath, reason: 'changed' });
        } else if (localHash !== remoteHash) {
          upload.push({ localUri: local.uri, remotePath, reason: 'changed' });
        } else {
          unchanged.push(remotePath);
        }
      }
    }

    // Find orphaned files on board that don't exist locally
    // Exclude MicroPython system files from orphan candidates
    const localRemotePaths = new Set(localFiles.map(f => f.remotePath));
    const orphaned = [...boardFileMap.keys()].filter(
      p => !localRemotePaths.has(p) && !SYSTEM_FILES.has(p),
    );

    return { upload, orphaned, mkdirs, unchanged };
  }

  /**
   * Execute a sync plan: create directories, upload files, optionally delete orphans.
   */
  async execute(
    syncPlan: SyncPlan,
    options: { deleteOrphans: boolean },
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<SyncResult> {
    const total = syncPlan.mkdirs.length + syncPlan.upload.length
      + (options.deleteOrphans ? syncPlan.orphaned.length : 0);
    const increment = total > 0 ? 100 / total : 0;
    const errors: string[] = [];
    let deleted = 0;

    // Create directories (in order, parents first - already sorted by plan())
    for (const dir of syncPlan.mkdirs) {
      progress?.report({ message: `Creating ${dir}`, increment });
      try {
        await this._fs.mkdir(dir);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('EEXIST')) {
          errors.push(`mkdir ${dir}: ${msg}`);
        }
      }
    }

    // Upload changed/new files
    for (const entry of syncPlan.upload) {
      const fileName = entry.remotePath.split('/').pop()!;
      progress?.report({ message: `${entry.reason === 'new' ? 'Adding' : 'Updating'} ${fileName}`, increment });
      try {
        const data = await vscode.workspace.fs.readFile(entry.localUri);
        await this._fs.writeFile(entry.remotePath, Buffer.from(data));
      } catch (err: unknown) {
        errors.push(`upload ${entry.remotePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Delete orphans if requested
    if (options.deleteOrphans) {
      for (const remotePath of syncPlan.orphaned) {
        progress?.report({ message: `Removing ${remotePath}`, increment });
        try {
          await this._fs.rm(remotePath);
          deleted++;
        } catch (err: unknown) {
          errors.push(`delete ${remotePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return {
      uploaded: syncPlan.upload.length - errors.filter(e => e.startsWith('upload')).length,
      deleted,
      unchanged: syncPlan.unchanged.length,
      errors,
    };
  }

  /**
   * Recursively collect local workspace files, respecting exclude patterns.
   */
  private async _collectLocalFiles(
    folder: vscode.Uri,
    excludePatterns: string[],
    prefix = '',
  ): Promise<Array<{ uri: vscode.Uri; remotePath: string }>> {
    const results: Array<{ uri: vscode.Uri; remotePath: string }> = [];
    const entries = await vscode.workspace.fs.readDirectory(folder);

    for (const [name, type] of entries) {
      if (this._isExcluded(name, excludePatterns)) continue;

      const childUri = vscode.Uri.joinPath(folder, name);
      const remotePath = prefix ? `${prefix}/${name}` : `/${name}`;

      if (type === vscode.FileType.Directory) {
        const children = await this._collectLocalFiles(childUri, excludePatterns, remotePath);
        results.push(...children);
      } else if (type === vscode.FileType.File) {
        results.push({ uri: childUri, remotePath });
      }
    }

    return results;
  }

  /**
   * Check if a filename matches any exclude pattern.
   */
  private _isExcluded(name: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern.startsWith('*.')) {
        if (name.endsWith(pattern.slice(1))) return true;
      } else {
        if (name === pattern) return true;
      }
    }
    return false;
  }
}
