# 联合馆藏导入器

Node.js 本地数据接入项目。来源书目身份与联合目录身份分开维护：来源记录按 `馆号:localId` 保存每个馆条目的最新观察与册数，联合目录条目只由运营人工决策建立，自动匹配仅产生待确认建议。来源服务和业务存储独立，来源变化不会自动刷新本地集合或推翻人工决定。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源、读取首批并展示业务查询，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm start -- ingest` 从 `fixtures/records.json` 导入，`npm start -- query` 读取本地 `var/records.json`，`npm start -- catalog` 查看联合目录视图，`npm start -- decide <决策文件>` 应用人工合并/拆分，`npm start -- collect <来源URL>` 逐馆采集本地来源。演示数据不访问生产站点。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源并透传 ETag；`src/adapter.js` 解析来源页面并保留原始来源属性；`src/collector.js` 的 `collectLibraries()` 逐馆采集两个 `/libraries/*/catalog` 入口，304 命中的馆不产生记录。`src/service.js` 与 `src/repository.js` 维护来源记录持久集合（`var/records.json`，键为 `library:localId`，重抓只替换最新观察，册数不累计）；`src/catalog.js`、`src/catalog-repository.js` 与 `var/catalog.json` 单独维护联合身份：`links` 保存带修订号的人工 merge/split 决定，`proposals` 保存可重建的待确认建议。`src/operations.js` 是读取该集合的业务消费入口，来源协议见 [CONTRACT.md](CONTRACT.md)。

### 身份与决策规则

- 自动匹配只生成 `pending` 建议：双方都有相同 ISBN 时按 ISBN 建议，否则同题名且同版次才按题名建议；题名相同但版次不同不会配对，资料不足的记录保留为未链接的待确认状态，不靠标题凑确定条目。
- 只有人工 merge 能建立 `confirmed` 联合条目（canonical），条目成员可回溯到每个馆的来源条目，各馆册数各计一次；split 把记录标记为 `separate` 并阻止重新自动配对。
- 决策带 `decisionRevision`：相同或更旧修订号的决策整体以 `stale-decision` 跳过。晚到的 ISBN 只更新来源观察与待核对信息，不会自动推翻较新的人工决定。
- 反复抓取同一馆记录按来源键 upsert，不新增来源行、不重复累加馆藏；来源 ETag 命中返回 304 时不入库。
- 决策可引用尚未采集到的来源键，应用结果以 `unresolved` 标出，跨馆引用仍可凭 `馆号:localId` 回到来源记录。

状态目录属于运行产物。扩展导入时应保留现有 CLI 和现有集合查询能力；新增状态可以另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。运行录制可用 test 和 demo，无需安装浏览器或外部数据库。

`npm start` 或 `npm start -- --help` 查看命令；原导入和查询使用显式的 ingest、query 动作，联合目录使用 collect、catalog、decide 动作。`npm run acceptance` 在临时目录中验证本地来源读取、两馆首批导入、重启回读、重放、304 重抓、人工合并/拆分、晚到 ISBN 不推翻决策、同名不同版次不合并与业务查询，完成后清理临时状态。
