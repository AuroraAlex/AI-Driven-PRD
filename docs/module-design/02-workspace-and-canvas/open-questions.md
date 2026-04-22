# 工作区与画布 — 待决策与待补强项

> 最后更新：2026-04-21

本文记录当前实现中已知的、需要产品/技术进一步决策的问题，以及短期内计划但未落地的优化点。

## 1. 快照机制

| 议题 | 当前实现 | 待决策 |
| --- | --- | --- |
| 快照上限 | 列表接口固定 `limit 20`；旧数据保留不清理 | 是否需要软删除 + 定期清理？保留几天？ |
| 快照是否带 `files_json` | 否（只存 elements + appState） | 带图片的快照恢复后会出现占位符，是否值得牺牲存储换完整性？ |
| 快照恢复语义 | 纯前端 updateScene，不写回 `canvases` | 是否提供"恢复并覆盖当前画布"的一键选项？ |
| 恢复后是否自动创建"恢复前"的快照 | 否 | 避免用户误操作丢失当前内容？ |
| 快照命名 | `prompt()` 手动输入，默认 `"快照"` | 是否需要系统自动命名（带时间戳）？是否允许事后修改 label？ |

## 2. 画布保存性能

| 议题 | 现状 | 待决策 |
| --- | --- | --- |
| 元素 diff 方式 | `JSON.stringify` 全量字符串比较 | 元素上千时的 CPU 开销；可换元素 id + 元素 `updated` 时间戳的哈希 |
| 视口变化是否触发保存 | 不触发（仅元素变化触发） | 但元素变化时会把最新 viewport 一并写入；关闭/重开 tab viewport 可能"跳动" |
| `files_json` 大小 | 无上限 | 大图片 dataURL 会让单次 PUT 数十 MB；需引入 `/api/files` 托管 |
| 并发保存 | 后写覆盖 | 多 tab 编辑会有丢失；需乐观锁或 CRDT |

## 3. AI 上下文接入

当前 `canvasStore.extractText()` 仅返回所有 text 元素的拼接，未携带结构。真正接入 Chat/PRD 时需要决策：

- 是否要按卡片类型分组输出？
  - 例如 "用户故事列表:\n- As a X, I want Y..."
  - AI 卡片单独列为 "AI 已生成内容:\n..."
- Frame 的区块划分是否要作为"章节"语义？
- 思维导图是否导出为 OPML / Markdown 大纲？
- 长度裁剪策略：超过 token 预算时如何采样？

建议：在 `04-ai-chat` 与 `05-prd-generation-and-editor` 模块中具体化，这里只保留 hook。

## 4. 画布 ↔ 文件联动

已在 `nodeInsert.ts` 预留 `createFileCard(x, y)` 并在 `customData.fileId` 字段留位，但**尚未完成拖拽链路**：
- [ ] `FilePanel` 行上启用 HTML5 drag source
- [ ] `ExcalidrawCanvas` 包裹层接收 `dragover` / `drop` 事件
- [ ] 落点 → `createFileCard(sceneX, sceneY)` 并写入 `fileId`
- [ ] 文件卡点击 → 打开预览/下载

需决定：
- 文件卡是否展示缩略图（PDF 首页、图片原图）？
- 删除文件后，画布上的文件卡如何处理？占位、标灰、还是自动移除？

## 5. 画布 ↔ PRD 联动

PRD 卡 (`prd_card`) 目前只是"一张写字卡"。目标：双向绑定到某个 PRD 章节。

- [ ] `customData.prdId` / `customData.sectionId` 字段
- [ ] Inspector 提供"同步到 PRD 章节"按钮
- [ ] PRD 编辑器修改后反向同步回画布

技术难点：PRD 内容是 TipTap HTML，画布只是纯文本；需确定"同步粒度"（一段还是整章）。

## 6. 画布 ↔ AI Chat 联动

Chat 预留"把回复钉到画布"入口，对应 `createAICard(x, y, content)`。需决定：

- Chat 每条 AI 回复是否默认带"钉到画布"按钮？
- 钉到画布的位置：当前视口中心 / 固定右侧栏区？
- 从画布 AI 卡反向触发"重新让 AI 修改这段"的入口？

## 7. 思维导图增强

| 功能 | 是否待做 | 优先级 |
| --- | --- | --- |
| 节点半径按子节点数量自适应 | 待做 | 中 |
| 孩子数超 12 时切为双列布局 | 待做 | 低 |
| 节点折叠/展开 | 待做 | 中 |
| 导入/导出 Markdown 大纲 | 待做 | 中 |
| 节点拖动后自动吸附到网格 | 待做 | 低 |
| 跨思维导图复制节点 | 待做 | 低 |

## 8. 模板体系

- 当前硬编码 3 个模板（用户旅程图 / 功能分解 / 思维导图起点）。
- 是否要：
  - 用户可自定义并保存模板？
  - 从社区/内置库导入模板？
  - 模板可带 AI 填充引导（例：选定"用户旅程图"后 AI 自动问 3 个问题帮助填内容）？

## 9. 实时协作

目前单用户单 tab 假设。若未来启用：
- 协议：Yjs + y-websocket / Excalidraw 官方 collab / 自研 OT？
- 权限：只读 / 可编辑 / 逐元素锁？
- 服务器：新增协作网关还是在现 FastAPI 里挂 WebSocket？
- 画布保存与协作 doc 的关系：快照是否仍然每用户独立？

此部分属于大改动，建议先不承诺。

## 10. 可访问性与国际化

| 议题 | 现状 |
| --- | --- |
| 键盘导航 | 仅思维导图支持 Tab/Enter/Delete；其它卡片插入需鼠标 |
| ARIA | 工具栏按钮无 aria-label |
| 国际化 | 工具栏和 Inspector 文案中英混排，后续统一 i18n |
| 色板对色盲友好度 | 未验证 |

## 11. 测试覆盖

目前画布模块无单元测试。建议补：
- `nodeInsert` 工厂函数：给定输入坐标/颜色，断言输出元素的形状与 customData。
- `mindMap.addChildNode` / `deleteNode`：mock ExcalidrawAPI，断言 scene 元素数量与 `mmNodes` 同步。
- Canvas API 后端 pytest：创建 → 保存 → 回显 → 快照 → 恢复端到端。

## 12. 开放问题清单（建议后续跟进）

- **Q1**：`files_json` 膨胀后是否迁移到 `/api/files` 外挂存储？
- **Q2**：是否引入元素级撤销/重做与全局快照的关系澄清？
- **Q3**：PRD 生成时，画布是"主数据"还是"辅助参考"？若是主数据，需要结构化导出。
- **Q4**：Excalidraw 未来升级到 v1.0 时，元素 schema 可能有变更；何时预留迁移脚本？
- **Q5**：画布是否需要"只读分享链接"（导出为 web 可访问快照）？

---

## 已闭合（2026-04-22）

- **Q1（旧）画布是否要支持多版本/多视图？** → 已落地为 `canvas_sessions` 多会话；快照仍按 session 维度存。
- **Q2（旧）画布如何被 AI 直接读取？** → 已落地 `agents/canvas/context.py` + `extractCanvasContext.ts` 镜像，`ChatAgent` 与 `AICardAgent` 都可注入。
- **Q3（旧）PRD vs 画布主从关系？** → 现统一为 `references` 双向边；任一方都可作为 source/target。

## 新增

- **Q6**：画布同步入 RAG 后，是否对单卡片做 chunk 级别索引（而非整 session 一个 doc）？目前为 1 session = 1 doc，召回粒度较粗。
- **Q7**：多用户协作（同一 session 多人编辑）何时引入？当前 session 模型已具备扩展位（`updated_at` / `version`）。
- **Q8**：是否提供 session 间复制 / 模板化（fork canvas as template）？
- **Q9**：AI 卡 `sources` 是否应同时写入 `references` 表，做强一致而非冗余？
