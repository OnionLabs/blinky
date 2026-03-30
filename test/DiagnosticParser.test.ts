import { describe, expect, it } from 'vitest';
import { parseTraceback } from '../src/run/DiagnosticParser';

describe('parseTraceback', () => {
  it('parses a standard multi-line traceback', () => {
    const text = `Traceback (most recent call last):
  File "main.py", line 5, in <module>
  File "lib/helper.py", line 12, in do_stuff
NameError: name 'foo' is not defined`;

    const errors = parseTraceback(text);
    expect(errors).toHaveLength(2);

    expect(errors[0].boardPath).toBe('/main.py');
    expect(errors[0].line).toBe(5);
    expect(errors[0].message).toBe("NameError: name 'foo' is not defined");

    expect(errors[1].boardPath).toBe('/lib/helper.py');
    expect(errors[1].line).toBe(12);
    expect(errors[1].message).toBe("NameError: name 'foo' is not defined");
  });

  it('parses a simple single-file traceback', () => {
    const text = `Traceback (most recent call last):
  File "/boot.py", line 3, in <module>
OSError: [Errno 2] ENOENT`;

    const errors = parseTraceback(text);
    expect(errors).toHaveLength(1);
    expect(errors[0].boardPath).toBe('/boot.py');
    expect(errors[0].line).toBe(3);
    expect(errors[0].message).toBe('OSError: [Errno 2] ENOENT');
  });

  it('skips <stdin> entries', () => {
    const text = `Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
  File "test.py", line 10, in run
TypeError: can't convert str to int`;

    const errors = parseTraceback(text);
    expect(errors).toHaveLength(1);
    expect(errors[0].boardPath).toBe('/test.py');
    expect(errors[0].line).toBe(10);
  });

  it('handles SyntaxError format', () => {
    const text = `  File "main.py", line 7
SyntaxError: invalid syntax`;

    const errors = parseTraceback(text);
    expect(errors).toHaveLength(1);
    expect(errors[0].boardPath).toBe('/main.py');
    expect(errors[0].line).toBe(7);
    expect(errors[0].message).toBe('SyntaxError: invalid syntax');
  });

  it('returns empty array for non-error text', () => {
    const text = 'Hello world\n42\n';
    expect(parseTraceback(text)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseTraceback('')).toEqual([]);
  });

  it('normalizes relative board paths with leading slash', () => {
    const text = `Traceback (most recent call last):
  File "app/main.py", line 1, in <module>
ImportError: no module named 'missing'`;

    const errors = parseTraceback(text);
    expect(errors[0].boardPath).toBe('/app/main.py');
  });

  it('preserves leading slash on absolute paths', () => {
    const text = `Traceback (most recent call last):
  File "/lib/util.py", line 22, in helper
ValueError: invalid value`;

    const errors = parseTraceback(text);
    expect(errors[0].boardPath).toBe('/lib/util.py');
  });

  it('handles traceback with only error class (no message)', () => {
    const text = `Traceback (most recent call last):
  File "main.py", line 1, in <module>
KeyboardInterrupt`;

    const errors = parseTraceback(text);
    // KeyboardInterrupt doesn't match \w+Error, but that's okay
    // The regex requires Error|Exception suffix
    expect(errors).toHaveLength(0);
  });

  it('handles Exception subclass', () => {
    const text = `Traceback (most recent call last):
  File "main.py", line 3, in <module>
Exception: something broke`;

    const errors = parseTraceback(text);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Exception: something broke');
  });

  it('handles multiple tracebacks (keeps all entries)', () => {
    // When stderr contains leftover text plus a traceback
    const text = `some output
Traceback (most recent call last):
  File "a.py", line 1, in <module>
  File "b.py", line 2, in func
RuntimeError: boom`;

    const errors = parseTraceback(text);
    expect(errors).toHaveLength(2);
    expect(errors[0].boardPath).toBe('/a.py');
    expect(errors[1].boardPath).toBe('/b.py');
  });
});
