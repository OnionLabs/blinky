import * as fs from 'fs';
import * as path from 'path';

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;
}

interface TemplateMeta {
  id: string;
  label: string;
  description: string;
}

/** Resolved once on first access. */
let _cached: ProjectTemplate[] | undefined;

/**
 * Load templates from the `templates/` directory bundled with the extension.
 * Each template is a subdirectory containing source files stored as .txt
 * (to avoid IDE linting). The .txt suffix is stripped to recover the
 * original filename (e.g. main.py.txt → main.py).
 */
export function loadTemplates(extensionPath: string): ProjectTemplate[] {
  if (_cached) return _cached;

  const templatesDir = path.join(extensionPath, 'templates');
  const metaPath = path.join(templatesDir, 'templates.json');
  const metaRaw = fs.readFileSync(metaPath, 'utf-8');
  const metas: TemplateMeta[] = JSON.parse(metaRaw);

  _cached = metas.map((meta) => {
    const dir = path.join(templatesDir, meta.id);
    const files: Record<string, string> = {};

    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isFile()) {
        const name = entry.endsWith('.txt') ? entry.slice(0, -4) : entry;
        files[name] = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    return { ...meta, files };
  });

  return _cached;
}

export function getTemplate(extensionPath: string, id: string): ProjectTemplate | undefined {
  return loadTemplates(extensionPath).find((t) => t.id === id);
}

/** Reset cached templates (for testing). */
export function _resetTemplateCache(): void {
  _cached = undefined;
}
