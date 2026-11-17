import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeRecord } from '../src/records.js';
import {
  applyCatalogDecisions,
  buildCatalogView,
  catalogKey,
  emptyCatalogState,
  mergeCatalogRecords,
  refreshProposals,
  validateHoldings,
} from '../src/catalog.js';
import { RecordRepository } from '../src/repository.js';
import { CatalogRepository } from '../src/catalog-repository.js';
import { CollectionService } from '../src/service.js';

function sourceRecord({ library, localId, title = 'Local Atlas', isbn = null, edition = '2', holdings = 1, observedAt = '2026-11-16T08:00:00Z' }) {
  return normalizeRecord({
    sourceId: localId,
    source: 'sample-source',
    observedAt,
    label: title,
    attributes: { library, localId, title, isbn, edition, holdings, modifiedAt: observedAt },
  });
}

const l1 = sourceRecord({ library: 'L1', localId: 'L1-20', isbn: '9780000000002', holdings: 2 });
const l2 = sourceRecord({ library: 'L2', localId: 'L2-44', isbn: '9780000000002', holdings: 3 });

test('catalog key separates source identity from business identity', () => {
  assert.equal(catalogKey(l1), 'L1:L1-20');
  assert.equal(catalogKey(l2), 'L2:L2-44');
  assert.equal(catalogKey({ sourceId: 'legacy-1', attributes: {} }), 'legacy-1');
});

test('recrawling the same source record replaces it instead of accumulating holdings', () => {
  const again = sourceRecord({ library: 'L1', localId: 'L1-20', holdings: 4, observedAt: '2026-11-16T09:00:00Z' });
  const merged = mergeCatalogRecords([l1], [again, l1]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].attributes.holdings, 4);
});

test('holdings must be a non-negative integer', () => {
  assert.throws(() => validateHoldings(sourceRecord({ library: 'L1', localId: 'x', holdings: -1 })), /invalid holdings/);
  assert.throws(() => validateHoldings(sourceRecord({ library: 'L1', localId: 'x', holdings: 1.5 })), /invalid holdings/);
  assert.doesNotThrow(() => validateHoldings(sourceRecord({ library: 'L1', localId: 'x', holdings: 0 })));
});

test('automatic matches are only pending proposals, never confirmed entries', () => {
  const proposals = refreshProposals([l1, l2], []);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'pending');
  assert.equal(proposals[0].basis, 'isbn');
  assert.deepEqual(proposals[0].recordKeys, ['L1:L1-20', 'L2:L2-44']);
  assert.equal(buildCatalogView([l1, l2], { ...emptyCatalogState(), proposals }).entries.length, 0);
});

test('same title with different editions is neither merged nor proposed', () => {
  const otherEdition = sourceRecord({ library: 'L2', localId: 'L2-99', edition: '3', observedAt: '2026-11-16T10:00:00Z' });
  assert.deepEqual(refreshProposals([l1, otherEdition], []), []);
});

test('title-only evidence still stays pending and traceable per library', () => {
  const noIsbnA = sourceRecord({ library: 'L1', localId: 'a' });
  const noIsbnB = sourceRecord({ library: 'L2', localId: 'b' });
  const [proposal] = refreshProposals([noIsbnA, noIsbnB], []);
  assert.equal(proposal.basis, 'title');
  const view = buildCatalogView([noIsbnA, noIsbnB], { ...emptyCatalogState(), proposals: [proposal] });
  assert.equal(view.entries.length, 0);
  assert.deepEqual(view.proposals[0].members.map((m) => m.library), ['L1', 'L2']);
});

test('manual merge creates a confirmed entry summing each library holding once', () => {
  const result = applyCatalogDecisions(emptyCatalogState(), [
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'book-20' },
  ], [l1, l2]);
  assert.equal(result.skipped.length, 0);
  const view = buildCatalogView([l1, l2], result.state);
  assert.equal(view.entries.length, 1);
  assert.equal(view.entries[0].canonical, 'book-20');
  assert.equal(view.entries[0].holdings, 5);
  assert.deepEqual(view.entries[0].libraries, ['L1', 'L2']);
  assert.equal(result.state.proposals.length, 0, 'confirmed records leave the pending queue');
});

test('late ISBN recrawl cannot overturn a newer manual merge decision', () => {
  const merged = applyCatalogDecisions(emptyCatalogState(), [
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'book-20' },
  ], [l1, l2]);
  const lateIsbn = sourceRecord({ library: 'L1', localId: 'L1-20', isbn: '9780000000002', holdings: 2, observedAt: '2026-11-16T11:00:00Z' });
  const regenerated = refreshProposals([lateIsbn, l2], merged.state.links);
  assert.deepEqual(regenerated, [], 'manual links suppress automatic re-pairing after recrawl');
  const view = buildCatalogView([lateIsbn, l2], { ...merged.state, proposals: regenerated });
  assert.equal(view.entries[0].holdings, 5, 'recrawl does not add holdings again');
  assert.equal(view.entries[0].decisionRevision, 1);
});

test('stale decision revisions are skipped, then a newer split separates the records', () => {
  const merged = applyCatalogDecisions(emptyCatalogState(), [
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'book-20' },
  ], [l1, l2]);
  const stale = applyCatalogDecisions(merged.state, [
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'other' },
  ], [l1, l2]);
  assert.deepEqual(stale.skipped[0].reason, 'stale-decision');
  assert.equal(buildCatalogView([l1, l2], stale.state).entries[0].canonical, 'book-20');
  const split = applyCatalogDecisions(merged.state, [
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'split', decisionRevision: 2 },
  ], [l1, l2]);
  const view = buildCatalogView([l1, l2], split.state);
  assert.equal(view.entries.length, 0);
  assert.ok(view.unlinked.every((row) => row.separate && row.decisionRevision === 2));
  assert.equal(refreshProposals([l1, l2], split.state.links).length, 0, 'manual split blocks automatic re-pairing');
});

test('invalid decisions are rejected before touching state', () => {
  assert.throws(() => applyCatalogDecisions(emptyCatalogState(), [{ records: ['L1:L1-20'], action: 'guess', decisionRevision: 1 }], [l1]), /merge or split/);
  assert.throws(() => applyCatalogDecisions(emptyCatalogState(), [{ records: [], action: 'merge', decisionRevision: 1 }], [l1]), /non-empty records/);
  assert.throws(() => applyCatalogDecisions(emptyCatalogState(), [{ records: ['L1:L1-20'], action: 'merge', decisionRevision: 0 }], [l1]), /positive integer/);
});

test('service keeps source records and union identity in separate stores and survives restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'union-catalog-'));
  try {
    const service = new CollectionService(
      new RecordRepository(join(directory, 'records.json')),
      new CatalogRepository(join(directory, 'catalog.json')),
    );
    await service.ingest([l1, l2]);
    const decided = await service.applyDecisions([
      { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'book-20' },
    ]);
    assert.deepEqual(decided.applied[0].records, ['L1:L1-20', 'L2:L2-44']);
    const restarted = new CollectionService(
      new RecordRepository(join(directory, 'records.json')),
      new CatalogRepository(join(directory, 'catalog.json')),
    );
    const view = await restarted.catalogView();
    assert.equal(view.revision, 1);
    assert.equal(view.entries[0].canonical, 'book-20');
    const persisted = JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8'));
    assert.ok(persisted.links.every((link) => link.status === 'confirmed'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
