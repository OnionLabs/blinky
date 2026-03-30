import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { showBoardError, showConnectionError } from '../src/ui/ErrorHelpers';

describe('ErrorHelpers', () => {
  describe('showConnectionError', () => {
    it('shows access denied message', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showConnectionError(new Error('Access denied'));
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('serial port'),
        expect.any(String),
        expect.any(String),
      );
    });

    it('shows timeout message', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showConnectionError(new Error('Timeout'));
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('responding'),
        expect.any(String),
      );
    });

    it('shows file not found message', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showConnectionError(new Error('File not found'));
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('serial port'),
        expect.any(String),
        expect.any(String),
      );
    });

    it('shows generic message for unknown errors', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showConnectionError(new Error('Something weird'));
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Something weird'),
        expect.any(String),
        expect.any(String),
      );
    });

    it('handles string errors', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showConnectionError('raw string error');
      expect(spy).toHaveBeenCalled();
    });

    it('retries on Retry click with retryCommand', async () => {
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Retry' as any);
      const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
      await showConnectionError(new Error('fail'), 'blinky.connect');
      expect(execSpy).toHaveBeenCalledWith('blinky.connect');
    });

    it('selects port on Select Different Port click', async () => {
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Select Different Port' as any);
      const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
      await showConnectionError(new Error('fail'));
      expect(execSpy).toHaveBeenCalledWith('blinky.selectPort');
    });
  });

  describe('showBoardError', () => {
    it('shows last line of traceback', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showBoardError('Traceback:\n  File "x.py", line 1\nValueError: oops');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('ValueError: oops'),
        expect.any(String),
      );
    });

    it('handles single-line stderr', async () => {
      const spy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as any);
      await showBoardError('OSError: ENOENT');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('OSError: ENOENT'),
        expect.any(String),
      );
    });
  });
});
