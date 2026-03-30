import { describe, expect, it, vi } from 'vitest';
import { BOARD_SCHEME, BoardContentProvider } from '../src/filesystem/BoardContentProvider';

describe('BoardContentProvider', () => {
  function createMockFs() {
    return {
      readTextFile: vi.fn().mockResolvedValue('# hello'),
    } as any;
  }

  it('exports BOARD_SCHEME', () => {
    expect(BOARD_SCHEME).toBe('boardfs');
  });

  it('returns file content from board', async () => {
    const mockFs = createMockFs();
    const provider = new BoardContentProvider(() => mockFs);

    const uri = { path: '/main.py' } as any;
    const content = await provider.provideTextDocumentContent(uri);
    expect(content).toBe('# hello');
    expect(mockFs.readTextFile).toHaveBeenCalledWith('/main.py');
  });

  it('caches content after first read', async () => {
    const mockFs = createMockFs();
    const provider = new BoardContentProvider(() => mockFs);

    const uri = { path: '/main.py' } as any;
    await provider.provideTextDocumentContent(uri);
    await provider.provideTextDocumentContent(uri);
    expect(mockFs.readTextFile).toHaveBeenCalledTimes(1);
  });

  it('returns not-connected message when no fs', async () => {
    const provider = new BoardContentProvider(() => undefined);
    const uri = { path: '/main.py' } as any;
    const content = await provider.provideTextDocumentContent(uri);
    expect(content).toContain('Not connected');
  });

  it('returns error message on read failure', async () => {
    const mockFs = createMockFs();
    mockFs.readTextFile.mockRejectedValue(new Error('Read failed'));
    const provider = new BoardContentProvider(() => mockFs);

    const uri = { path: '/main.py' } as any;
    const content = await provider.provideTextDocumentContent(uri);
    expect(content).toContain('Error');
    expect(content).toContain('Read failed');
  });

  it('invalidate clears cache and fires change', async () => {
    const mockFs = createMockFs();
    const provider = new BoardContentProvider(() => mockFs);

    const uri = { path: '/main.py' } as any;
    await provider.provideTextDocumentContent(uri);

    let changeUri: any;
    provider.onDidChange((u) => { changeUri = u; });
    provider.invalidate('/main.py');

    expect(changeUri).toBeDefined();
    // Next read should fetch again
    await provider.provideTextDocumentContent(uri);
    expect(mockFs.readTextFile).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll clears all cached content', async () => {
    const mockFs = createMockFs();
    const provider = new BoardContentProvider(() => mockFs);

    await provider.provideTextDocumentContent({ path: '/a.py' } as any);
    await provider.provideTextDocumentContent({ path: '/b.py' } as any);

    const changed: any[] = [];
    provider.onDidChange((u) => changed.push(u));
    provider.invalidateAll();
    expect(changed).toHaveLength(2);

    // Re-read should call readTextFile again
    await provider.provideTextDocumentContent({ path: '/a.py' } as any);
    expect(mockFs.readTextFile).toHaveBeenCalledTimes(3);
  });

  it('dispose clears cache and emitter', () => {
    const provider = new BoardContentProvider(() => undefined);
    provider.dispose();
    // Should not throw
  });

  it('handles non-Error exceptions in read', async () => {
    const mockFs = createMockFs();
    mockFs.readTextFile.mockRejectedValue('string error');
    const provider = new BoardContentProvider(() => mockFs);

    const content = await provider.provideTextDocumentContent({ path: '/x.py' } as any);
    expect(content).toContain('string error');
  });
});
