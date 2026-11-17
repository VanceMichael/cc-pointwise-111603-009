import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from '../src/source-client.js';
import { parsePage, entryPath } from '../src/adapter.js';
import { collectLibraries } from '../src/collector.js';
import { RecordRepository } from '../src/repository.js';
import { CatalogRepository } from '../src/catalog-repository.js';
import { CollectionService } from '../src/service.js';
import { readOperations } from '../src/operations.js';

const scenarioPath = new URL('../fixtures/source.json', import.meta.url);

test('source adapter, persistence and operations consumer agree on a first import', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'source-integration-'));
  try {
    const client = new SourceClient(source.url);
    const page = parsePage(await client.read(entryPath));
    assert.ok(page.records.length > 0);
    const repository = new RecordRepository(join(directory, 'records.json'));
    const service = new CollectionService(repository);
    await service.ingest(page.records);
    const view = await readOperations(repository);
    assert.equal(view.rows.length, page.records.length);
    assert.ok(view.rows.every((row) => row.sourceId && row.attributes));
    assert.ok(source.requests.some((request) => request.path === entryPath));
  } finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
});

test('local origin restriction and transient source failures are observable', async () => {
  assert.throws(() => new SourceClient('https://example.com'), /local source/);
  const source = await startSource(scenarioPath);
  try {
    const client = new SourceClient(source.url);
    source.failNext(entryPath, 503);
    await assert.rejects(client.read(entryPath), /503/);
    assert.ok(parsePage(await client.read(entryPath)).records.length);
    await assert.rejects(client.read('http://127.0.0.1:1/foreign'), /origin changed/);
  } finally { await source.close(); }
});

test('collector reads every library and a conditional 304 adds no records', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'collector-'));
  try {
    const client = new SourceClient(source.url);
    const first = await collectLibraries(client);
    assert.equal(first.perPath.length, 2);
    assert.deepEqual(first.records.map((record) => record.attributes.library), ['L1', 'L2']);
    const etags = Object.fromEntries(first.perPath.map((entry) => [entry.path, entry.etag]));
    const conditional = await collectLibraries(client, undefined, etags);
    assert.ok(conditional.perPath.every((entry) => entry.notModified));
    assert.equal(conditional.records.length, 0);
  } finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
});

test('operations expose confirmed union entries with per-library traceability and holdings', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'union-ops-'));
  try {
    const client = new SourceClient(source.url);
    const repository = new RecordRepository(join(directory, 'records.json'));
    const catalogRepository = new CatalogRepository(join(directory, 'catalog.json'));
    const service = new CollectionService(repository, catalogRepository);
    await service.ingest((await collectLibraries(client)).records);
    const before = await readOperations(repository, catalogRepository);
    assert.equal(before.catalog.entries.length, 0);
    assert.equal(before.catalog.proposals[0].recordKeys.join(','), 'L1:L1-20,L2:L2-44');
    await service.applyDecisions([
      { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'book-20' },
    ]);
    source.publish('updated');
    await service.ingest((await collectLibraries(client)).records);
    const after = await readOperations(repository, catalogRepository);
    assert.equal(after.rows.length, 2, '来源行始终保留各馆条目');
    const entry = after.catalog.entries[0];
    assert.equal(entry.holdings, 5);
    assert.deepEqual(entry.members.map((member) => member.recordKey), ['L1:L1-20', 'L2:L2-44']);
    assert.equal(entry.members.find((member) => member.recordKey === 'L1:L1-20').isbn, '9780000000002');
  } finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
});
