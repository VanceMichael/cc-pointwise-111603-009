# 来源与消费契约

## 来源

入口 `/libraries/L1/catalog`，JSON items 为本页项目，next 是后续相对路径或 null。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

localId 仅在馆内稳定，isbn 可能晚到或录错；title 相同不证明同一版次。holdings 是来源馆该条目的册数，不能因合并重抓再加一次。fixtures/decisions.json 保存人工合并/拆分决策及修订号；跨馆引用需可回到来源记录。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
