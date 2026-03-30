import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { DiagnosticManager } from '../src/run/DiagnosticParser';

describe('DiagnosticManager', () => {
  it('creates a diagnostic collection', () => {
    const dm = new DiagnosticManager();
    // Should not throw
    dm.dispose();
  });

  describe('setFromStderr', () => {
    it('sets diagnostics for a single file error', () => {
      const dm = new DiagnosticManager();
      const stderr = `Traceback (most recent call last):
  File "/main.py", line 5, in <module>
NameError: name 'x' is not defined`;
      const localUri = vscode.Uri.file('/workspace/main.py');

      dm.setFromStderr(stderr, localUri);

      // Access the internal collection via the mock
      const collection = (dm as any)._collection;
      // The collection should have entries
      // Since we're using mock, verify it was set
      expect(collection._map.size).toBeGreaterThan(0);
      dm.dispose();
    });

    it('resolves to local file when basename matches', () => {
      const dm = new DiagnosticManager();
      const stderr = `Traceback (most recent call last):
  File "/main.py", line 3, in <module>
ValueError: bad`;
      const localUri = vscode.Uri.file('/workspace/main.py');

      dm.setFromStderr(stderr, localUri);
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(1);
      dm.dispose();
    });

    it('resolves to workspace path when no local file', () => {
      const dm = new DiagnosticManager();
      const stderr = `Traceback (most recent call last):
  File "/lib/util.py", line 7, in helper
RuntimeError: boom`;

      dm.setFromStderr(stderr);
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(1);
      dm.dispose();
    });

    it('handles multiple files in traceback', () => {
      const dm = new DiagnosticManager();
      const stderr = `Traceback (most recent call last):
  File "/main.py", line 1, in <module>
  File "/lib/helper.py", line 5, in go
TypeError: wrong type`;

      dm.setFromStderr(stderr);
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(2);
      dm.dispose();
    });

    it('does nothing for non-error stderr', () => {
      const dm = new DiagnosticManager();
      dm.setFromStderr('some random output');
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(0);
      dm.dispose();
    });

    it('does nothing for empty stderr', () => {
      const dm = new DiagnosticManager();
      dm.setFromStderr('');
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(0);
      dm.dispose();
    });

    it('does not resolve when no workspace folders', () => {
      const saved = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;

      const dm = new DiagnosticManager();
      const stderr = `Traceback (most recent call last):
  File "/main.py", line 1, in <module>
ValueError: x`;

      dm.setFromStderr(stderr);
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(0);

      (vscode.workspace as any).workspaceFolders = saved;
      dm.dispose();
    });
  });

  describe('clear', () => {
    it('clears all diagnostics', () => {
      const dm = new DiagnosticManager();
      const stderr = `Traceback (most recent call last):
  File "/main.py", line 1, in <module>
ValueError: x`;
      const localUri = vscode.Uri.file('/workspace/main.py');
      dm.setFromStderr(stderr, localUri);
      dm.clear();
      const collection = (dm as any)._collection;
      expect(collection._map.size).toBe(0);
      dm.dispose();
    });
  });
});
