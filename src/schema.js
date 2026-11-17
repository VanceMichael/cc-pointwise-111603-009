export const schema = Object.freeze({
  "product": "联合馆藏导入器",
  "entity": "书目记录",
  "identity": "sourceId",
  "required": [
    "sourceId",
    "source",
    "observedAt",
    "label"
  ],
  "description": "图书馆目录的来源身份与联合目录身份分离，人工确认合并或拆分"
});
