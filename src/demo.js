import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { collectLibraries } from './collector.js';
import { RecordRepository } from './repository.js';
import { CatalogRepository } from './catalog-repository.js';
import { CollectionService } from './service.js';
import { readOperations } from './operations.js';

const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const client = new SourceClient(source.url);
  const repository = new RecordRepository(join(directory, 'records.json'));
  const catalogRepository = new CatalogRepository(join(directory, 'catalog.json'));
  const service = new CollectionService(repository, catalogRepository);

  // 1. 首批采集：L1 无 ISBN、L2 有 ISBN，自动匹配只给出待确认建议。
  const opening = await collectLibraries(client);
  await service.ingest(opening.records);
  let view = await service.catalogView();
  console.log(JSON.stringify({ step: 'opening', collected: opening.perPath,
    proposals: view.proposals.map(({ id, basis, recordKeys }) => ({ id, basis, recordKeys })),
    entries: view.entries.length }, null, 2));

  // 2. 运营依据建议确认合并。
  const decision = JSON.parse(await readFile(new URL('../fixtures/decisions.json', import.meta.url)));
  const decided = await service.applyDecisions(decision);
  view = await service.catalogView();
  console.log(JSON.stringify({ step: 'manual-merge', applied: decided.applied,
    entry: view.entries.map(({ canonical, libraries, holdings, members }) =>
      ({ canonical, libraries, holdings, members: members.map((m) => m.recordKey) })) }, null, 2));

  // 3. 来源发布新版（L1 晚到 ISBN），重抓只更新观察，不推翻人工条目、不累计册数。
  source.publish('updated');
  const refreshed = await collectLibraries(client);
  await service.ingest(refreshed.records);
  view = await service.catalogView();
  const operations = await readOperations(repository, catalogRepository);
  console.log(JSON.stringify({ step: 'late-isbn-recrawl', collected: refreshed.perPath,
    entries: view.entries.map(({ canonical, holdings, members }) =>
      ({ canonical, holdings, members: members.map((m) => ({ key: m.recordKey, isbn: m.isbn, holdings: m.holdings })) })),
    proposals: view.proposals.length,
    sourceRows: operations.rows.map((row) => ({ sourceId: row.sourceId, isbn: row.attributes.isbn, holdings: row.attributes.holdings })) }, null, 2));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
