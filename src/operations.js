import { dirname, join } from 'node:path';
import { buildCatalogView, emptyCatalogState } from './catalog.js';
import { CatalogRepository } from './catalog-repository.js';

const fields = ['localId', 'library', 'title', 'isbn', 'edition', 'holdings', 'modifiedAt'];

// 业务消费入口：原有来源行保持不变，另附联合目录视图（确认条目/待确认建议/未链接记录），
// 每个联合条目都能回溯到各馆来源条目与册数。
export async function readOperations(repository, catalogRepository) {
  const records = await repository.read();
  const catalogStore = catalogRepository
    ?? (repository?.path ? new CatalogRepository(join(dirname(repository.path), 'catalog.json')) : null);
  const state = catalogStore ? await catalogStore.read() : emptyCatalogState();
  const rows = records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  }));
  return { product: '联合馆藏导入器', rows, catalog: buildCatalogView(records, state) };
}
