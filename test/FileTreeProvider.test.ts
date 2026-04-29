import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { FileTreeProvider } from '../src/filesystem/FileTreeProvider';

function createMockFs() {
  return {
    ls: vi.fn().mockResolvedValue([
      { name: 'lib', path: '/lib', isDir: true, size: 0 },
      { name: 'main.py', path: '/main.py', isDir: false, size: 128 },
      { name: 'boot.py', path: '/boot.py', isDir: false, size: 64 },
    ]),
  } as any;
}

describe('FileTreeProvider', () => {
  it('returns empty when no filesystem is set', async () => {
    const provider = new FileTreeProvider();
    const children = await provider.getChildren();
    expect(children).toEqual([]);
    provider.dispose();
  });

  it('returns sorted children with dirs first', async () => {
    const provider = new FileTreeProvider();
    const mockFs = createMockFs();
    provider.setFileSystem(mockFs);

    const children = await provider.getChildren();
    expect(children).toHaveLength(3);
    expect(children[0].name).toBe('lib');
    expect(children[0].isDir).toBe(true);
    expect(children[1].name).toBe('boot.py');
    expect(children[2].name).toBe('main.py');
    provider.dispose();
  });

  it('lists subdirectory children', async () => {
    const provider = new FileTreeProvider();
    const mockFs = createMockFs();
    mockFs.ls.mockResolvedValue([
      { name: 'helper.py', path: '/lib/helper.py', isDir: false, size: 256 },
    ]);
    provider.setFileSystem(mockFs);

    const children = await provider.getChildren({ path: '/lib', name: 'lib', isDir: true, size: 0 });
    expect(children).toHaveLength(1);
    expect(children[0].name).toBe('helper.py');
    provider.dispose();
  });

  it('returns error placeholder on ls error', async () => {
    const provider = new FileTreeProvider();
    const mockFs = createMockFs();
    mockFs.ls.mockRejectedValue(new Error('fail'));
    provider.setFileSystem(mockFs);

    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].path).toBe('__blinky_error__');
    expect(children[0].name).toContain('fail');
    provider.dispose();
  });

  it('getTreeItem creates folder item', () => {
    const provider = new FileTreeProvider();
    const item = provider.getTreeItem({ name: 'lib', path: '/lib', isDir: true, size: 0 });
    expect(item.label).toBe('lib');
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(item.contextValue).toBe('boardDir');
    provider.dispose();
  });

  it('getTreeItem creates file item with size', () => {
    const provider = new FileTreeProvider();
    const item = provider.getTreeItem({ name: 'main.py', path: '/main.py', isDir: false, size: 128 });
    expect(item.label).toBe('main.py');
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(item.contextValue).toBe('boardFile');
    expect(item.description).toBe('128 B');
    expect(item.command?.command).toBe('blinky.previewFile');
    provider.dispose();
  });

  it('formats KB sizes', () => {
    const provider = new FileTreeProvider();
    const item = provider.getTreeItem({ name: 'big.py', path: '/big.py', isDir: false, size: 2048 });
    expect(item.description).toBe('2.0 KB');
    provider.dispose();
  });

  it('formats MB sizes', () => {
    const provider = new FileTreeProvider();
    const item = provider.getTreeItem({ name: 'huge.bin', path: '/huge.bin', isDir: false, size: 1048576 });
    expect(item.description).toBe('1.0 MB');
    provider.dispose();
  });

  it('refresh fires change event (debounced)', async () => {
    const provider = new FileTreeProvider();
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });
    provider.refresh();
    expect(fired).toBe(false); // debounced, not immediate
    await new Promise((r) => setTimeout(r, 250));
    expect(fired).toBe(true);
    provider.dispose();
  });

  it('setFileSystem fires change event', () => {
    const provider = new FileTreeProvider();
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });
    provider.setFileSystem(createMockFs());
    expect(fired).toBe(true);
    provider.dispose();
  });

  it('fs getter returns current filesystem', () => {
    const provider = new FileTreeProvider();
    expect(provider.fs).toBeUndefined();
    const mockFs = createMockFs();
    provider.setFileSystem(mockFs);
    expect(provider.fs).toBe(mockFs);
    provider.dispose();
  });
});
