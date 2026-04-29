import { DeviceConnection } from '../connection/DeviceConnection';

export interface BoardFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

/** Python scripts executed on-board to perform filesystem operations.
 *  Each script is wrapped in a function to avoid polluting the board's
 *  global namespace with temporary variables.
 */
const SCRIPTS = {
  ls: (dir: string) => `
def _():
    import os, json
    try:
        entries = []
        for name in os.listdir(${JSON.stringify(dir)}):
            full = ${JSON.stringify(dir)} + ('/' if ${JSON.stringify(dir)} != '/' else '') + name
            try:
                s = os.stat(full)
                entries.append({'name': name, 'path': full, 'isDir': bool(s[0] & 0x4000), 'size': s[6]})
            except:
                entries.append({'name': name, 'path': full, 'isDir': False, 'size': 0})
        print(json.dumps(entries))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
_()
del _
`.trim(),

  stat: (path: string) => `
def _():
    import os, json
    try:
        s = os.stat(${JSON.stringify(path)})
        print(json.dumps({'isDir': bool(s[0] & 0x4000), 'size': s[6]}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
_()
del _
`.trim(),

  /** Read file as base64 for binary-safe transfer */
  catB64: (path: string) => `
def _():
    import sys, ubinascii
    try:
        f = open(${JSON.stringify(path)}, 'rb')
        while True:
            c = f.read(384)
            if not c:
                break
            sys.stdout.write(ubinascii.b2a_base64(c).decode())
        f.close()
    except Exception as e:
        sys.stderr.write(str(e))
_()
del _
`.trim(),

  /** Write first chunk (truncates existing file) */
  putStart: (path: string, b64Chunk: string) => `
def _():
    import ubinascii
    try:
        f = open(${JSON.stringify(path)}, 'wb')
        data = ${JSON.stringify(b64Chunk)}
        for i in range(0, len(data), 512):
            f.write(ubinascii.a2b_base64(data[i:i+512]))
        f.close()
        print('OK')
    except Exception as e:
        print('ERR:' + str(e))
_()
del _
`.trim(),

  /** Append chunk to existing file */
  putAppend: (path: string, b64Chunk: string) => `
def _():
    import ubinascii
    try:
        f = open(${JSON.stringify(path)}, 'ab')
        data = ${JSON.stringify(b64Chunk)}
        for i in range(0, len(data), 512):
            f.write(ubinascii.a2b_base64(data[i:i+512]))
        f.close()
        print('OK')
    except Exception as e:
        print('ERR:' + str(e))
_()
del _
`.trim(),

  rm: (path: string) => `
def _():
    import os
    os.remove(${JSON.stringify(path)})
    print('OK')
try:
    _()
except Exception as e:
    print('ERR:' + str(e))
del _
`.trim(),

  rmdir: (path: string) => `
def _():
    import os
    def _rmtree(p):
        for f in os.listdir(p):
            fp = p + '/' + f
            try:
                s = os.stat(fp)
                if s[0] & 0x4000:
                    _rmtree(fp)
                else:
                    os.remove(fp)
            except:
                pass
        os.rmdir(p)
    _rmtree(${JSON.stringify(path)})
    print('OK')
try:
    _()
except Exception as e:
    print('ERR:' + str(e))
del _
`.trim(),

  mkdir: (path: string) => `
def _():
    import os
    os.mkdir(${JSON.stringify(path)})
    print('OK')
try:
    _()
except Exception as e:
    print('ERR:' + str(e))
del _
`.trim(),

  rename: (oldPath: string, newPath: string) => `
def _():
    import os
    os.rename(${JSON.stringify(oldPath)}, ${JSON.stringify(newPath)})
    print('OK')
try:
    _()
except Exception as e:
    print('ERR:' + str(e))
del _
`.trim(),
};

/**
 * Filesystem operations on a MicroPython board via raw REPL.
 * All methods are async and use DeviceConnection.executeRaw()
 * which serializes access through the mutex.
 */
export class BoardFileSystem {
  private _connection: DeviceConnection;

  constructor(connection: DeviceConnection) {
    this._connection = connection;
  }

  /**
   * List entries in a directory.
   */
  async ls(dir: string = '/'): Promise<BoardFileEntry[]> {
    const result = await this._connection.executeRaw(SCRIPTS.ls(dir));
    if (result.stderr) {
      throw new Error(`ls ${dir}: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.error) {
      throw new Error(`ls ${dir}: ${parsed.error}`);
    }
    return parsed as BoardFileEntry[];
  }

  /**
   * Get stat info for a path.
   */
  async stat(path: string): Promise<{ isDir: boolean; size: number }> {
    const result = await this._connection.executeRaw(SCRIPTS.stat(path));
    if (result.stderr) {
      throw new Error(`stat ${path}: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.error) {
      throw new Error(`stat ${path}: ${parsed.error}`);
    }
    return parsed;
  }

  /**
   * Read file content as a Buffer (binary-safe via base64).
   */
  async readFile(path: string): Promise<Buffer> {
    const result = await this._connection.executeRaw(SCRIPTS.catB64(path));
    if (result.stderr) {
      throw new Error(`read ${path}: ${result.stderr}`);
    }
    // Decode base64 lines
    const lines = result.stdout.trim().split('\n');
    const buffers = lines
      .filter((line) => line.length > 0)
      .map((line) => Buffer.from(line.trim(), 'base64'));
    return Buffer.concat(buffers);
  }

  /**
   * Read file as UTF-8 string.
   */
  async readTextFile(path: string): Promise<string> {
    const buf = await this.readFile(path);
    return buf.toString('utf-8');
  }

  /**
   * Write data to a file on the board (binary-safe via base64).
   */
  /**
   * Max base64 bytes per chunk sent to the board.
   * Keeps each raw REPL command well under the ~4KB practical limit.
   */
  private static readonly CHUNK_B64_SIZE = 2048;

  async writeFile(path: string, data: Buffer | string): Promise<void> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    const b64 = buf.toString('base64');

    // Split into chunks to avoid exceeding raw REPL command size limits
    const chunkSize = BoardFileSystem.CHUNK_B64_SIZE;
    const chunks = [];
    for (let i = 0; i < b64.length; i += chunkSize) {
      chunks.push(b64.slice(i, i + chunkSize));
    }

    // Empty file case
    if (chunks.length === 0) {
      chunks.push('');
    }

    // Write to a temp file first, then atomically rename. This prevents a
    // partial / corrupt destination if the connection drops or a chunk fails.
    const tmpPath = path + '.blnk.tmp';

    try {
      for (let i = 0; i < chunks.length; i++) {
        const script = i === 0
          ? SCRIPTS.putStart(tmpPath, chunks[i])
          : SCRIPTS.putAppend(tmpPath, chunks[i]);
        const result = await this._connection.executeRaw(script);
        const output = result.stdout.trim();
        if (output.startsWith('ERR:') || result.stderr) {
          throw new Error(`write ${path}: ${output.replace('ERR:', '') || result.stderr}`);
        }
      }

      // Atomically replace destination. MicroPython's os.rename overwrites
      // an existing file on most ports; if not, fall back to remove+rename.
      try {
        await this.rename(tmpPath, path);
      } catch {
        // Destination may already exist on ports where rename doesn't overwrite.
        try { await this.rm(path); } catch { /* ignore */ }
        await this.rename(tmpPath, path);
      }
    } catch (err) {
      // Best-effort cleanup of the temp file so we don't leave litter.
      try { await this.rm(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * Delete a file.
   */
  async rm(path: string): Promise<void> {
    const result = await this._connection.executeRaw(SCRIPTS.rm(path));
    const output = result.stdout.trim();
    if (output.startsWith('ERR:') || result.stderr) {
      throw new Error(`rm ${path}: ${output.replace('ERR:', '') || result.stderr}`);
    }
  }

  /**
   * Recursively delete a directory and its contents.
   */
  async rmdir(path: string): Promise<void> {
    const result = await this._connection.executeRaw(SCRIPTS.rmdir(path));
    const output = result.stdout.trim();
    if (output.startsWith('ERR:') || result.stderr) {
      throw new Error(`rmdir ${path}: ${output.replace('ERR:', '') || result.stderr}`);
    }
  }

  /**
   * Create a directory.
   */
  async mkdir(path: string): Promise<void> {
    const result = await this._connection.executeRaw(SCRIPTS.mkdir(path));
    const output = result.stdout.trim();
    if (output.startsWith('ERR:') || result.stderr) {
      throw new Error(`mkdir ${path}: ${output.replace('ERR:', '') || result.stderr}`);
    }
  }

  /**
   * Rename / move a file or directory.
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const result = await this._connection.executeRaw(SCRIPTS.rename(oldPath, newPath));
    const output = result.stdout.trim();
    if (output.startsWith('ERR:') || result.stderr) {
      throw new Error(`rename ${oldPath} → ${newPath}: ${output.replace('ERR:', '') || result.stderr}`);
    }
  }

  /**
   * Check if a path exists.
   */
  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
