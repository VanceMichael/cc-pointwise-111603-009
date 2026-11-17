import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CatalogRepository } from './catalog-repository.js';
import { CollectionService } from './service.js';
import { SourceClient } from './source-client.js';
import { collectLibraries } from './collector.js';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = resolve(here, '../var');
const service = new CollectionService(
  new RecordRepository(resolve(stateDir, 'records.json')),
  new CatalogRepository(resolve(stateDir, 'catalog.json')),
);
const action = process.argv[2] ?? '--help';
if (action === '--help' || action === '-h') {
  console.log(JSON.stringify({
    usage: 'npm start -- ingest [文件] | collect <来源URL> | query [来源] | catalog | decide <决策文件>',
    commands: ['ingest', 'collect', 'query', 'catalog', 'decide'],
  }));
  process.exit(0);
}
if (action === 'ingest') {
  const records = JSON.parse(await readFile(process.argv[3] ?? resolve(here, '../fixtures/records.json'), 'utf8'));
  console.log(JSON.stringify(await service.ingest(records), null, 2));
} else if (action === 'collect') {
  const baseUrl = process.argv[3];
  if (!baseUrl) throw new Error('collect requires a local source URL');
  const collected = await collectLibraries(new SourceClient(baseUrl));
  const summary = await service.ingest(collected.records);
  console.log(JSON.stringify({ paths: collected.perPath, ...summary }, null, 2));
} else if (action === 'query') {
  console.log(JSON.stringify(await service.query({ source: process.argv[3] }), null, 2));
} else if (action === 'catalog') {
  console.log(JSON.stringify(await service.catalogView(), null, 2));
} else if (action === 'decide') {
  const decisionPath = process.argv[3];
  if (!decisionPath) throw new Error('decide requires a decisions file');
  const decisions = JSON.parse(await readFile(resolve(decisionPath), 'utf8'));
  console.log(JSON.stringify(await service.applyDecisions(decisions), null, 2));
} else {
  throw new Error('action must be ingest, collect, query, catalog or decide');
}
