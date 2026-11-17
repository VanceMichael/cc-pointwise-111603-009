import { dirname, join } from 'node:path';
import { findRecords, mergeRecords, normalizeRecord } from './records.js';
import {
  applyCatalogDecisions,
  buildCatalogView,
  catalogKey,
  mergeCatalogRecords,
  refreshProposals,
  validateHoldings,
} from './catalog.js';
import { CatalogRepository } from './catalog-repository.js';

export class CollectionService {
  constructor(repository, catalogRepository) {
    this.repository = repository;
    this.catalogRepository = catalogRepository
      ?? new CatalogRepository(join(dirname(repository.path), 'catalog.json'));
  }

  async ingest(inputs) {
    if (!Array.isArray(inputs)) throw new TypeError('ingest input must be an array');
    const accepted = inputs.map(normalizeRecord);
    accepted.forEach(validateHoldings);
    const current = await this.repository.read();
    const merged = mergeRecords(current, accepted);
    await this.repository.replace(merged);

    // 同步联合身份侧的来源记录视图并重建待确认建议；人工 link 不受重抓影响。
    const catalogState = await this.catalogRepository.read();
    const catalogRecords = mergeCatalogRecords(
      merged.map((record) => ({ ...record, sourceId: catalogKey(record) })),
      [],
    );
    catalogState.proposals = refreshProposals(catalogRecords, catalogState.links);
    await this.catalogRepository.replace(catalogState);
    return { accepted: accepted.length, stored: merged.length, proposals: catalogState.proposals.length };
  }

  async query(filters) { return findRecords(await this.repository.read(), filters); }

  async catalogView() {
    const records = await this.repository.read();
    return buildCatalogView(records, await this.catalogRepository.read());
  }

  async applyDecisions(decisions) {
    const state = await this.catalogRepository.read();
    const records = await this.repository.read();
    const result = applyCatalogDecisions(state, decisions, records);
    await this.catalogRepository.replace(result.state);
    return { applied: result.applied, skipped: result.skipped, revision: result.state.revision };
  }
}
