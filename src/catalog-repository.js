import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyCatalogState } from './catalog.js';

// 联合目录身份状态独立持久化：links 是人工决定，proposals 是可重建的待确认建议。
export class CatalogRepository {
  constructor(path) { this.path = path; }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (!value || typeof value !== 'object' || !Array.isArray(value.links) || !Array.isArray(value.proposals)) {
        throw new Error('catalog file has no links/proposals arrays');
      }
      return { revision: Number.isInteger(value.revision) ? value.revision : 0,
        links: structuredClone(value.links), proposals: structuredClone(value.proposals) };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyCatalogState();
      throw error;
    }
  }

  async replace(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
  }
}
