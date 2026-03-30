import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetTemplateCache, getTemplate, loadTemplates } from '../src/project/Templates';

const EXT_PATH = path.resolve(__dirname, '..');

describe('ProjectTemplates', () => {
  afterEach(() => {
    _resetTemplateCache();
  });

  const templates = loadTemplates(EXT_PATH);

  it('has exactly 4 templates', () => {
    expect(templates).toHaveLength(4);
  });

  it('every template has a unique id', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has main.py', () => {
    for (const t of templates) {
      expect(t.files['main.py'], `${t.id} should have main.py`).toBeDefined();
      expect(t.files['main.py'].length).toBeGreaterThan(0);
    }
  });

  it('every template has boot.py', () => {
    for (const t of templates) {
      expect(t.files['boot.py'], `${t.id} should have boot.py`).toBeDefined();
    }
  });

  it('every template has non-empty files', () => {
    for (const t of templates) {
      for (const [name, content] of Object.entries(t.files)) {
        expect(content.trim().length, `${t.id}/${name} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it('every template has label and description', () => {
    for (const t of templates) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('getTemplate returns template by id', () => {
    expect(getTemplate(EXT_PATH, 'blink')?.id).toBe('blink');
    expect(getTemplate(EXT_PATH, 'wifi')?.id).toBe('wifi');
    expect(getTemplate(EXT_PATH, 'webserver')?.id).toBe('webserver');
    expect(getTemplate(EXT_PATH, 'sensor')?.id).toBe('sensor');
  });

  it('getTemplate returns undefined for unknown id', () => {
    expect(getTemplate(EXT_PATH, 'nonexistent')).toBeUndefined();
  });
});
