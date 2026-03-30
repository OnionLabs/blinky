import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MicroPythonLinkProvider } from '../src/repl/TerminalLinkProvider';

describe('MicroPythonLinkProvider', () => {
  const provider = new MicroPythonLinkProvider();

  describe('provideTerminalLinks', () => {
    it('matches standard traceback line', () => {
      const links = provider.provideTerminalLinks({
        line: '  File "main.py", line 5, in <module>',
        terminal: {} as any,
      });
      expect(links).toHaveLength(1);
      expect(links[0].startIndex).toBe(2);
      expect(links[0].tooltip).toContain('main.py:5');
    });

    it('matches multiple entries on one line', () => {
      const links = provider.provideTerminalLinks({
        line: 'File "a.py", line 1 then File "b.py", line 2',
        terminal: {} as any,
      });
      expect(links).toHaveLength(2);
    });

    it('returns empty for non-traceback lines', () => {
      const links = provider.provideTerminalLinks({
        line: '>>> print("hello")',
        terminal: {} as any,
      });
      expect(links).toHaveLength(0);
    });

    it('returns empty for empty line', () => {
      const links = provider.provideTerminalLinks({
        line: '',
        terminal: {} as any,
      });
      expect(links).toHaveLength(0);
    });

    it('matches absolute board paths', () => {
      const links = provider.provideTerminalLinks({
        line: '  File "/lib/util.py", line 12, in helper',
        terminal: {} as any,
      });
      expect(links).toHaveLength(1);
      expect(links[0].tooltip).toContain('/lib/util.py:12');
    });
  });

  describe('handleTerminalLink', () => {
    it('opens matching workspace file at line', async () => {
      const spy = vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue(
        [vscode.Uri.file('/workspace/main.py')] as any,
      );
      const docSpy = vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any);
      const showSpy = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any);

      await provider.handleTerminalLink({
        startIndex: 0,
        length: 10,
        data: { boardPath: '/main.py', line: 5 },
      } as any);

      expect(spy).toHaveBeenCalledWith('**/main.py', undefined, 1);
      expect(docSpy).toHaveBeenCalled();
      expect(showSpy).toHaveBeenCalled();
    });

    it('shows warning when file not found in workspace', async () => {
      vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([] as any);
      const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);

      await provider.handleTerminalLink({
        startIndex: 0,
        length: 10,
        data: { boardPath: '/missing.py', line: 1 },
      } as any);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('handles link with no data', async () => {
      // Should not throw
      await provider.handleTerminalLink({ startIndex: 0, length: 5 } as any);
    });

    it('strips leading slash from board path for file search', async () => {
      const spy = vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([] as any);
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);

      await provider.handleTerminalLink({
        startIndex: 0,
        length: 10,
        data: { boardPath: '/lib/util.py', line: 3 },
      } as any);

      expect(spy).toHaveBeenCalledWith('**/lib/util.py', undefined, 1);
    });
  });
});
