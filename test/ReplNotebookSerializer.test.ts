import { describe, expect, it } from 'vitest';
import { NotebookCellKind } from 'vscode';
import { ReplNotebookSerializer } from '../src/notebook/ReplNotebookSerializer';

describe('ReplNotebookSerializer', () => {
  const serializer = new ReplNotebookSerializer();

  describe('deserializeNotebook', () => {
    it('deserializes empty content to one empty code cell', async () => {
      const data = await serializer.deserializeNotebook(new TextEncoder().encode(''));
      expect(data.cells).toHaveLength(1);
      expect(data.cells[0].kind).toBe(NotebookCellKind.Code);
      expect(data.cells[0].value).toBe('');
    });

    it('deserializes valid JSON with code cells', async () => {
      const json = JSON.stringify({
        cells: [
          { kind: 'code', value: 'print("hi")' },
          { kind: 'code', value: 'x = 42' },
        ],
      });
      const data = await serializer.deserializeNotebook(new TextEncoder().encode(json));
      expect(data.cells).toHaveLength(2);
      expect(data.cells[0].value).toBe('print("hi")');
      expect(data.cells[1].value).toBe('x = 42');
    });

    it('deserializes markdown cells', async () => {
      const json = JSON.stringify({
        cells: [{ kind: 'markdown', value: '# Hello' }],
      });
      const data = await serializer.deserializeNotebook(new TextEncoder().encode(json));
      expect(data.cells[0].kind).toBe(NotebookCellKind.Markup);
      expect(data.cells[0].languageId).toBe('markdown');
    });

    it('handles invalid JSON as single code cell', async () => {
      const data = await serializer.deserializeNotebook(new TextEncoder().encode('not json'));
      expect(data.cells).toHaveLength(1);
      expect(data.cells[0].value).toBe('not json');
    });

    it('handles cells with stdout outputs', async () => {
      const json = JSON.stringify({
        cells: [{
          kind: 'code',
          value: 'print(1)',
          outputs: [{ type: 'stdout', text: '1\n' }],
        }],
      });
      const data = await serializer.deserializeNotebook(new TextEncoder().encode(json));
      expect(data.cells[0].outputs).toHaveLength(1);
    });

    it('handles cells with error outputs', async () => {
      const json = JSON.stringify({
        cells: [{
          kind: 'code',
          value: 'raise Error',
          outputs: [{ type: 'error', text: 'Error' }],
        }],
      });
      const data = await serializer.deserializeNotebook(new TextEncoder().encode(json));
      expect(data.cells[0].outputs).toHaveLength(1);
    });

    it('handles empty cells array', async () => {
      const json = JSON.stringify({ cells: [] });
      const data = await serializer.deserializeNotebook(new TextEncoder().encode(json));
      expect(data.cells).toHaveLength(1); // Should add an empty code cell
    });
  });

  describe('serializeNotebook', () => {
    it('serializes code cells', async () => {
      const data = {
        cells: [
          { kind: NotebookCellKind.Code, value: 'print(1)', languageId: 'python', outputs: [] },
          { kind: NotebookCellKind.Code, value: 'x = 2', languageId: 'python', outputs: [] },
        ],
      } as any;

      const bytes = await serializer.serializeNotebook(data);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      expect(json.cells).toHaveLength(2);
      expect(json.cells[0].kind).toBe('code');
      expect(json.cells[0].value).toBe('print(1)');
    });

    it('serializes markdown cells', async () => {
      const data = {
        cells: [
          { kind: NotebookCellKind.Markup, value: '# Title', languageId: 'markdown', outputs: [] },
        ],
      } as any;

      const bytes = await serializer.serializeNotebook(data);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      expect(json.cells[0].kind).toBe('markdown');
    });

    it('serializes cells with outputs', async () => {
      const data = {
        cells: [{
          kind: NotebookCellKind.Code,
          value: 'print(1)',
          languageId: 'python',
          outputs: [{
            items: [{
              data: new TextEncoder().encode('1\n'),
              mime: 'application/vnd.code.notebook.stdout',
            }],
          }],
        }],
      } as any;

      const bytes = await serializer.serializeNotebook(data);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      expect(json.cells[0].outputs).toHaveLength(1);
      expect(json.cells[0].outputs[0].text).toBe('1\n');
      expect(json.cells[0].outputs[0].type).toBe('stdout');
    });

    it('serializes stderr outputs as error type', async () => {
      const data = {
        cells: [{
          kind: NotebookCellKind.Code,
          value: 'fail()',
          languageId: 'python',
          outputs: [{
            items: [{
              data: new TextEncoder().encode('Error'),
              mime: 'application/vnd.code.notebook.stderr',
            }],
          }],
        }],
      } as any;

      const bytes = await serializer.serializeNotebook(data);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      expect(json.cells[0].outputs[0].type).toBe('error');
    });

    it('round-trips correctly', async () => {
      const original = {
        cells: [
          { kind: 'code', value: 'print("hello")', outputs: [{ type: 'stdout', text: 'hello\n' }] },
          { kind: 'markdown', value: '## Notes' },
        ],
      };
      const deserialized = await serializer.deserializeNotebook(
        new TextEncoder().encode(JSON.stringify(original)),
      );
      const reserialized = await serializer.serializeNotebook(deserialized);
      const json = JSON.parse(new TextDecoder().decode(reserialized));

      expect(json.cells).toHaveLength(2);
      expect(json.cells[0].value).toBe('print("hello")');
      expect(json.cells[1].value).toBe('## Notes');
      expect(json.cells[1].kind).toBe('markdown');
    });

    it('omits outputs key when no outputs', async () => {
      const data = {
        cells: [{
          kind: NotebookCellKind.Code,
          value: 'x = 1',
          languageId: 'python',
          outputs: [],
        }],
      } as any;

      const bytes = await serializer.serializeNotebook(data);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      expect(json.cells[0].outputs).toBeUndefined();
    });
  });
});
