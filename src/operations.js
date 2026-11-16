const fields = ["localId", "library", "title", "isbn", "edition", "holdings", "modifiedAt"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "联合馆藏导入器", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}
