import { beforeEach, describe, expect, it } from 'vitest';
import { ReplParser } from '../src/repl/ReplParser';

describe('ReplParser', () => {
  let parser: ReplParser;

  beforeEach(() => {
    parser = new ReplParser();
  });

  describe('normal prompt detection', () => {
    it('detects ">>> " prompt', () => {
      const result = parser.feed('>>> ');
      expect(result.prompt).toBe('normal');
      expect(result.output).toBe('');
    });

    it('extracts output before normal prompt', () => {
      const result = parser.feed('Hello World!\r\n>>> ');
      expect(result.prompt).toBe('normal');
      expect(result.output).toBe('Hello World!\r\n');
    });

    it('handles multi-line output before prompt', () => {
      const result = parser.feed('line1\r\nline2\r\n>>> ');
      expect(result.prompt).toBe('normal');
      expect(result.output).toBe('line1\r\nline2\r\n');
    });
  });

  describe('continuation prompt detection', () => {
    it('detects "... " prompt', () => {
      const result = parser.feed('... ');
      expect(result.prompt).toBe('continuation');
      expect(result.output).toBe('');
    });

    it('extracts output before continuation prompt', () => {
      const result = parser.feed('some text\r\n... ');
      expect(result.prompt).toBe('continuation');
      expect(result.output).toBe('some text\r\n');
    });
  });

  describe('raw REPL prompt detection', () => {
    it('detects raw REPL prompt', () => {
      const result = parser.feed('raw REPL; CTRL-B to exit\r\n>');
      expect(result.prompt).toBe('raw');
    });

    it('extracts output before raw prompt', () => {
      const result = parser.feed('some stuff\r\nraw REPL; CTRL-B to exit\r\n>');
      expect(result.prompt).toBe('raw');
      expect(result.output).toBe('some stuff\r\n');
    });
  });

  describe('paste mode prompt detection', () => {
    it('detects paste mode prompt', () => {
      const result = parser.feed('paste mode; Ctrl-C to cancel, Ctrl-D to finish\r\n=== ');
      expect(result.prompt).toBe('paste');
    });
  });

  describe('chunked input', () => {
    it('accumulates partial data until prompt arrives', () => {
      const r1 = parser.feed('Hello');
      expect(r1.prompt).toBe('none');

      const r2 = parser.feed(' World!\r\n>>> ');
      expect(r2.prompt).toBe('normal');
      // Combined output should include everything before the prompt
      expect((r1.output + r2.output)).toContain('Hello');
      expect((r1.output + r2.output)).toContain('World!');
    });

    it('handles prompt split across chunks', () => {
      const r1 = parser.feed('output\r\n>>');
      expect(r1.prompt).toBe('none');

      const r2 = parser.feed('> ');
      expect(r2.prompt).toBe('normal');
    });

    it('handles data arriving byte-by-byte', () => {
      const text = 'hi\r\n>>> ';
      const results = [];
      for (const ch of text) {
        results.push(parser.feed(ch));
      }
      const lastResult = results[results.length - 1];
      expect(lastResult.prompt).toBe('normal');
    });
  });

  describe('flush', () => {
    it('returns buffered data', () => {
      parser.feed('partial data');
      const flushed = parser.flush();
      expect(flushed).toContain('partial data');
    });

    it('returns empty after prompt', () => {
      parser.feed('>>> ');
      const flushed = parser.flush();
      expect(flushed).toBe('');
    });
  });

  describe('reset', () => {
    it('clears buffer', () => {
      parser.feed('some data');
      parser.reset();
      const flushed = parser.flush();
      expect(flushed).toBe('');
    });
  });

  describe('no false positives', () => {
    it('does not detect ">>>" without trailing space as prompt', () => {
      const result = parser.feed('>>>');
      expect(result.prompt).toBe('none');
    });

    it('does not detect "... " inside regular output as prompt', () => {
      // "... " at start of a line in output (not at end of buffer)
      const result = parser.feed('some text... more text\r\n>>> ');
      expect(result.prompt).toBe('normal');
      expect(result.output).toContain('some text... more text');
    });
  });
});
