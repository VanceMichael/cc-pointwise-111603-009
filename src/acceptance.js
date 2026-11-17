import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const client = new SourceClient(source.url);
  const path = join(directory, 'records.json');
  const catalogPath = join(directory, 'catalog.json');
  const repository = new RecordRepository(path);
  const catalogRepository = new CatalogRepository(catalogPath);
  const service = new CollectionService(repository, catalogRepository);

  // 1. 两馆首批采集，自动匹配只能产生待确认建议，且必须能回溯到各馆来源记录。
  const first = await collectLibraries(client);
  const ingestOne = await service.ingest(first.records);
  assert.equal(ingestOne.accepted, first.records.length);
  let view = await service.catalogView();
  assert.equal(view.entries.length, 0, '没有人工确认前不得出现确定的联合条目');
  assert.equal(view.proposals.length, 1);
  assert.deepEqual(view.proposals[0].recordKeys, ['L1:L1-20', 'L2:L2-44']);
  assert.equal(view.proposals[0].status, 'pending');
  assert.equal(view.proposals[0].members.find((m) => m.recordKey === 'L1:L1-20').holdings, 2);
  assert.equal(view.proposals[0].members.find((m) => m.recordKey === 'L2:L2-44').holdings, 3);

  // 2. 旧有来源级导入、重启回读与重放能力保持不变。
  const stored = await repository.read();
  const reopened = new CollectionService(new RecordRepository(path), new CatalogRepository(catalogPath));
  assert.deepEqual(await reopened.query({}), stored, '重新打开后读取同一份业务记录');
  const replay = await reopened.ingest(first.records);
  assert.equal(replay.stored, stored.length, '重放首批记录不重复保存');
  assert.equal(replay.proposals, 1, '重抓同一馆记录不新增建议或册数');

  // 3. 运营确认合并；晚到 ISBN 之前的人工决定在后续重抓后仍然成立。
  const merge = await service.applyDecisions([
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'book-20' },
  ]);
  assert.deepEqual(merge.applied.map((d) => d.canonical), ['book-20']);
  view = await service.catalogView();
  assert.equal(view.entries.length, 1);
  assert.deepEqual(view.entries[0].libraries, ['L1', 'L2']);
  assert.equal(view.entries[0].holdings, 5, '联合条目册数来自两个馆各自来源记录，各计一次');

  // 4. 来源发布新版：L1 晚到 ISBN。重抓只替换来源观察，人工条目不被推翻、册数不累计。
  source.publish('updated');
  const refreshed = await collectLibraries(client);
  await service.ingest(refreshed.records);
  view = await service.catalogView();
  assert.equal(view.entries.length, 1);
  assert.equal(view.entries[0].holdings, 5, '反复抓取同一馆记录不能累加馆藏');
  assert.equal(view.entries[0].decisionRevision, 1, '晚到 ISBN 不能自动推翻较新的人工决定');
  assert.equal(view.entries[0].members.find((m) => m.recordKey === 'L1:L1-20').isbn, '9780000000002');
  assert.equal(view.proposals.length, 0, '已确认的记录不再回到待确认队列');

  // 5. ETag 命中时来源返回 304，采集结果为空且状态不变。
  const etags = Object.fromEntries(refreshed.perPath.filter((p) => p.etag).map((p) => [p.path, p.etag]));
  const conditional = await collectLibraries(client, undefined, etags);
  assert.equal(conditional.records.length, 0, '304 观察不产生入库记录');
  assert.ok(conditional.perPath.every((p) => p.notModified));

  // 6. 旧修订号的决策不能覆盖较新的人工决定；运营拆分（修订号 2）生效并保留为人工决定。
  const stale = await service.applyDecisions([
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'merge', decisionRevision: 1, canonical: 'other-book' },
  ]);
  assert.deepEqual(stale.skipped.map((d) => d.reason), ['stale-decision']);
  const split = await service.applyDecisions([
    { records: ['L1:L1-20', 'L2:L2-44'], action: 'split', decisionRevision: 2 },
  ]);
  assert.equal(split.applied.length, 1);
  view = await service.catalogView();
  assert.equal(view.entries.length, 0, '拆分后不再存在确定的联合条目');
  assert.equal(view.proposals.length, 0, '人工拆分后同题名/同 ISBN 不能重新自动配对');
  assert.ok(view.unlinked.every((row) => row.separate && row.decisionRevision === 2));

  // 7. 同名不同版次：即使 ISBN 缺失，也只保留待确认或不配对，绝不靠标题凑出确定条目。
  source.publish('editions');
  const editionPage = await collectLibraries(client);
  const editionService = new CollectionService(
    new RecordRepository(join(directory, 'editions-records.json')),
    new CatalogRepository(join(directory, 'editions-catalog.json')),
  );
  await editionService.ingest(editionPage.records);
  const editionView = await editionService.catalogView();
  assert.equal(editionView.entries.length, 0);
  assert.equal(editionView.proposals.length, 0, '题名相同但版次不同不得合并，也不生成建议');
  assert.equal(editionView.unlinked.length, 2);

  // 8. 业务读取入口仍包含原有来源行，并附可回溯各馆条目的联合视图。
  const currentRecords = await repository.read();
  const operations = await readOperations(repository, catalogRepository);
  assert.equal(operations.rows.length, currentRecords.length);
  for (const row of operations.rows) {
    const original = currentRecords.find((record) => record.sourceId === row.sourceId);
    assert.equal(row.source, original.source);
    assert.equal(row.observedAt, original.observedAt);
    for (const [field, value] of Object.entries(row.attributes)) {
      assert.deepEqual(value, original.attributes[field] ?? null);
    }
  }
  assert.deepEqual(operations.catalog.unlinked.map((row) => row.recordKey), ['L1:L1-20', 'L2:L2-44']);
  console.log(JSON.stringify({
    accepted: ingestOne.accepted, persisted: stored.length, replayStored: replay.stored,
    operationRows: operations.rows.length, proposals: view.proposals.length, status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
