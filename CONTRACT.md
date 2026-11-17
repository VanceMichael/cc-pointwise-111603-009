# 来源与消费契约

## 来源

入口 `/libraries/L1/catalog`，JSON items 为本页项目，next 是后续相对路径或 null。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

localId 仅在馆内稳定，isbn 可能晚到或录错；title 相同不证明同一版次。holdings 是来源馆该条目的册数，不能因合并重抓再加一次。fixtures/decisions.json 保存人工合并/拆分决策及修订号；跨馆引用需可回到来源记录。

## 业务消费

`readOperations(repository)` 在原有 product 和 rows（每行带 sourceId/source/observedAt/attributes）之外返回 `catalog` 联合视图：`entries` 是人工确认的联合条目，成员可回溯到每个馆的来源条目与册数；`proposals` 是仅用于运营核对的待确认建议（status 恒为 pending）；`unlinked` 列出尚无确定联合身份的来源记录，人工拆分的记录带 `separate` 与决策修订号。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。

## 身份与决策约束

- 来源身份键为 `library:localId`，仅在馆内稳定；联合条目 canonical 只由人工 merge 决策建立，自动匹配（相同 ISBN，或同题名且同版次）只能生成 pending 建议。
- 同名不同版次不得合并，也不生成建议；资料不足的对应关系保持待确认/未链接，不靠题名凑出确定的联合条目。
- 决策含 `action`（merge/split）、`records`（来源身份键数组）、`decisionRevision`（正整数）与可选 `canonical`；相同或更旧修订号必须以 stale-decision 跳过，晚到 ISBN 与重抓均不能自动推翻较新的人工决定。
- holdings 是来源馆该条目的最新册数，同一来源键反复抓取只替换观察，不能因合并或重抓再加一次；来源 ETag/304 命中时不产生入库记录。
