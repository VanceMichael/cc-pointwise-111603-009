export const entryPath = "/libraries/L1/catalog";

export function parsePage(response) {
  const payload = JSON.parse(response.text);
  if (!Array.isArray(payload.items)) throw new Error('source items missing');
  const items = payload.items;
  const next = payload.next ?? null;
  return { next, records: items.map((item) => ({
    sourceId: String(item["localId"]),
    source: "联合馆藏导入器",
    observedAt: item["modifiedAt"],
    label: String(item["title"]),
    attributes: structuredClone(item),
  })) };
}
