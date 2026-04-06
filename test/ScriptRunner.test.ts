import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DiagnosticManager } from '../src/run/DiagnosticParser';
import { ScriptRunner } from '../src/run/ScriptRunner';

function createMockConnection(result = { stdout: '', stderr: '' }) {
  return {
    isConnected: true,
    executeRaw: vi.fn().mockResolvedValue(result),
    executeRawStreaming: vi.fn().mockResolvedValue(result),
    interrupt: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockBoardFs() {
  return {
    writeFile: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockOutputChannel() {
  return {
    append: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
  } as any;
}

describe('ScriptRunner', () => {
  let runner: ScriptRunner;
  let diagnostics: DiagnosticManager;
  let output: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    diagnostics = new DiagnosticManager();
    output = createMockOutputChannel();
    runner = new ScriptRunner(diagnostics, output);
  });

  it('starts not running', () => {
    expect(runner.isRunning).toBe(false);
  });

  describe('runFile', () => {
    it('uploads and executes a file', async () => {
      const conn = createMockConnection({ stdout: '42\n', stderr: '' });
      const boardFs = createMockBoardFs();
      const uri = vscode.Uri.file('/workspace/main.py');

      await runner.runFile(conn, boardFs, uri);

      expect(boardFs.writeFile).toHaveBeenCalledWith('/main.py', expect.any(String));
      expect(conn.executeRawStreaming).toHaveBeenCalledWith(expect.stringContaining('exec(compile('), expect.any(Object));
      expect(runner.isRunning).toBe(false);
    });

    it('sets diagnostics on stderr', async () => {
      const stderr = `Traceback (most recent call last):
  File "/main.py", line 5, in <module>
NameError: name 'x' is not defined`;
      const conn = createMockConnection({ stdout: '', stderr });
      const boardFs = createMockBoardFs();
      const uri = vscode.Uri.file('/workspace/main.py');

      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await runner.runFile(conn, boardFs, uri);

      expect(spy).toHaveBeenCalled();
      expect(runner.isRunning).toBe(false);
    });

    it('rejects when already running', async () => {
      const conn = createMockConnection();
      const boardFs = createMockBoardFs();
      const uri = vscode.Uri.file('/workspace/main.py');

      const spy = vi.spyOn(vscode.window, 'showWarningMessage');
      (runner as any)._running = true;
      await runner.runFile(conn, boardFs, uri);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('already running'));
    });

    it('resets running flag on error', async () => {
      const conn = createMockConnection();
      conn.executeRawStreaming.mockRejectedValue(new Error('timeout'));
      const boardFs = createMockBoardFs();
      const uri = vscode.Uri.file('/workspace/main.py');

      await expect(runner.runFile(conn, boardFs, uri)).rejects.toThrow('timeout');
      expect(runner.isRunning).toBe(false);
    });
  });

  describe('runCode', () => {
    it('executes code directly', async () => {
      const conn = createMockConnection({ stdout: 'hi\n', stderr: '' });
      await runner.runCode(conn, 'print("hi")');
      expect(conn.executeRawStreaming).toHaveBeenCalledWith('print("hi")', expect.any(Object));
      expect(runner.isRunning).toBe(false);
    });

    it('sets diagnostics on stderr', async () => {
      const stderr = `Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
  File "test.py", line 3, in go
TypeError: can't convert`;
      const conn = createMockConnection({ stdout: '', stderr });
      const uri = vscode.Uri.file('/workspace/test.py');
      await runner.runCode(conn, 'go()', uri);
      expect(runner.isRunning).toBe(false);
    });

    it('rejects when already running', async () => {
      const spy = vi.spyOn(vscode.window, 'showWarningMessage');
      (runner as any)._running = true;
      const conn = createMockConnection();
      await runner.runCode(conn, 'x');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('already running'));
    });

    it('resets running flag on error', async () => {
      const conn = createMockConnection();
      conn.executeRawStreaming.mockRejectedValue(new Error('fail'));
      await expect(runner.runCode(conn, 'x')).rejects.toThrow('fail');
      expect(runner.isRunning).toBe(false);
    });
  });

  describe('cancel', () => {
    it('interrupts the active connection', async () => {
      const conn = createMockConnection();
      (runner as any)._running = true;
      (runner as any)._activeConnection = conn;
      await runner.cancel();
      expect(conn.interrupt).toHaveBeenCalled();
    });

    it('does nothing when not running', async () => {
      await runner.cancel();
      // No error thrown
    });
  });

  describe('dispose', () => {
    it('disposes diagnostics', () => {
      const spy = vi.spyOn(diagnostics, 'dispose');
      runner.dispose();
      expect(spy).toHaveBeenCalled();
    });
  });
});
