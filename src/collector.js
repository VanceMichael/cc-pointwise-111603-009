import { libraryPaths, parsePage } from './adapter.js';

// 从本地来源逐馆采集当前页；ETag 命中的馆返回 notModified，由调用方跳过入库。
// 反复抓取同一馆同一观察不会产生新的来源记录，册数也不会被再加一次。
export async function collectLibraries(client, paths = libraryPaths, etags = {}) {
  const records = [];
  const perPath = [];
  for (const path of paths) {
    const headers = etags[path] ? { 'if-none-match': etags[path] } : {};
    const response = await client.read(path, headers);
    const page = parsePage(response);
    if (page.notModified) {
      perPath.push({ path, notModified: true, accepted: 0, etag: etags[path] ?? null });
      continue;
    }
    records.push(...page.records);
    perPath.push({ path, notModified: false, accepted: page.records.length, etag: response.etag });
  }
  return { records, perPath };
}
