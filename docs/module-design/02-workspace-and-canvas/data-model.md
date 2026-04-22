# 工作区与画布 — 数据模型

> 最后更新：2026-04-22（多 Session、AI 卡富内容、跨域引用、全源 RAG）

本文梳理画布相关的四层数据：**数据库 ORM**、**前端全局状态（Zustand）**、**Excalidraw 场景内的自定义扩展字段**、**跨域引用与 RAG 来源元数据**。

> ⚠️ 本次重构破坏性变更（无迁移脚本，需要 drop & recreate `backend/data/prd.db`）：
> - 新增 `canvas_sessions` / `chat_sessions` / `references` 三张表。
> - `canvases.project_id` → `canvases.canvas_session_id (UNIQUE FK CASCADE)`。
> - `canvas_snapshots.project_id` → `canvas_snapshots.canvas_session_id`。
> - `chat_messages.project_id` → `chat_messages.chat_session_id`。
> - `rag_indexes` 增加 `source_type / source_session_id / source_ref / doc_id`，`attachment_id` 改为可空 + UNIQUE，新增 `UNIQUE(project_id, doc_id)` 与状态值 `unindexed`。
> - 画布 AI 卡的根矩形 `customData` 新增 `aiContent` 字段（v1 schema）。

---

## 0. 新增 / 变更表速览

### 0.1 `canvas_sessions`

| 列 | 类型 | 备注 |
| --- | --- | --- |
| `id` | str (uuid) | PK |
| `project_id` | str | FK→`projects(id)` CASCADE |
| `title` | str | 默认 `画布 N+1` |
| `order_index` | int | 列表排序 |
| `archived_at` | datetime? | 归档（不删除） |
| `created_at / updated_at` | datetime | |

关系：`Project.canvas_sessions = relationship(... order_by=order_index, cascade="all, delete-orphan")`，并 `1:1` 拥有 `Canvas`。

### 0.2 `chat_sessions`

镜像 `canvas_sessions`，反向关系为 `messages: list[ChatMessage]`。

### 0.3 `references`

| 列 | 类型 | 备注 |
| --- | --- | --- |
| `id` | str (uuid) | PK |
| `project_id` | str | FK→`projects(id)` CASCADE |
| `source_type / target_type` | str | 取自 `REF_TYPES = {canvas_card, chat_message, prd_section, rag_chunk, file}` |
| `source_id / target_id` | str | 节点业务 ID（卡片 groupId / 消息 id / PRD section id / chunk doc_id / attachment id） |
| `source_session_id / target_session_id` | str? | 跨 session 时记录所属 session |
| `relation` | str | `REF_RELATIONS = {cites, derived_from, mentions, embedded_in}` |
| `metadata_json` | str? | 结构化标签 |
| `created_at` | datetime | |

约束：`UNIQUE(source_type, source_id, target_type, target_id, relation)` + `INDEX(source_type, source_id)`、`INDEX(target_type, target_id)`。

### 0.4 `rag_indexes` 新字段

| 列 | 类型 | 备注 |
| --- | --- | --- |
| `source_type` | str | 默认 `"file"`，可为 `canvas/chat/prd` |
| `source_session_id` | str? | 关联 canvas_session / chat_session |
| `source_ref` | str? | 文件 attachment_id / PRD prd_id / 自由文本 |
| `doc_id` | str | LightRAG 内的文档 id，命名规则 `<source_type>:<id>` |
| `attachment_id` | str? | 现可空且 UNIQUE |

约束：`UNIQUE(project_id, doc_id)`，状态枚举追加 `"unindexed"`（来源被删除但图谱未清理）。

### 0.5 AI 卡片 `customData.aiContent` (v1)

```ts
interface AICardContent {
  schemaVersion: 1
  markdown: string                    // 主体内容
  summary: string                     // 卡面预览（≤200 字）
  sources: AICardSource[]             // [{type:'canvas'|'chat'|'prd'|'file'|'rag', id, label}]
  prompt: string                      // 生成所用的 user prompt
  model: string                       // LLM 模型
  generated_at: number                // ms epoch
  version: number                     // 用户编辑次数 +1
}
```

存储位置：`elements_json` 中 `nodeType === 'ai_card'` 的根矩形 `customData.aiContent`。
卡面文字（`ai_card_body`）保留为 `summary || markdown` 截断 200 字的纯文本预览。

---

## 1. 后端 ORM

### 1.1 `Canvas`（`backend/infra/models/canvas.py`）

```python
class Canvas(Base):
    __tablename__ = "canvases"

    id:             str        = uuid4, PK
    project_id:     str        = FK→projects(id) CASCADE, UNIQUE
    elements_json:  Text       = "[]"     # Excalidraw 元素数组
    app_state_json: Text       = "{}"     # 视口状态
    files_json:     Text       = "{}"     # 内嵌图片/文件
    updated_at:     datetime   = now(UTC), onupdate=now
```

关键约束：`project_id UNIQUE` — 每个项目**只有一个当前画布**。

关联：`Project.canvas = relationship("Canvas", back_populates="project", uselist=False)`

### 1.2 `CanvasSnapshot`（`backend/infra/models/canvas_snapshot.py`）

```python
class CanvasSnapshot(Base):
    __tablename__ = "canvas_snapshots"

    id:             str        = uuid4, PK
    project_id:     str        = FK→projects(id) CASCADE, indexed
    elements_json:  Text       = "[]"
    app_state_json: Text       = "{}"
    label:          String(200)= "快照"
    created_at:     datetime   = now(UTC)
```

关键约束：`project_id` 普通索引，一个项目多条快照；无 UPDATE 路径（append-only）。

### 1.3 级联关系

```
projects
   │  ON DELETE CASCADE
   ├──  canvases             (1:1)
   ├──  canvas_snapshots     (1:N)
   ├──  chat_messages        (1:N)
   ├──  prd_documents        (1:N)
   └──  ...
```

删除项目时，画布与所有快照自动清除。

---

## 2. 前端 Zustand Store

### 2.1 Store shape（`frontend/src/store/canvasStore.ts`）

```ts
interface CanvasState {
  // Excalidraw API 引用（由 ExcalidrawCanvas 首次渲染时注入）
  api: ExcalidrawImperativeAPI | null
  setApi: (api) => void

  // 工具栏「待放置」状态
  pendingTool: CustomTool | null
  setPendingTool: (t) => void

  // Inspector 选中的元素
  selectedElementId: string | null
  setSelectedElementId: (id) => void

  // 思维导图
  mindMapMode: boolean
  setMindMapMode: (on) => void
  mmNodes: Record<string, MindMapNode>
  upsertMmNode(node) / removeMmNode(id) / resetMm()

  // 版本历史
  showVersionHistory: boolean
  snapshots: SnapshotMeta[]
  setSnapshots(list) / setShowVersionHistory(v)

  // 模板选择器
  showTemplatePicker: boolean
  setShowTemplatePicker(v)

  // 变更计数器（Minimap 重绘触发源）
  changeCount: number
  bumpChangeCount()

  // AI 上下文接口
  extractText(): string    // 拼接所有 text 元素
}
```

### 2.2 `MindMapNode`

```ts
interface MindMapNode {
  id: string                // Excalidraw 椭圆元素 id
  text: string
  parentId: string | null   // 根节点为 null
  childrenIds: string[]
  arrowId: string | null    // 连接父节点的箭头元素 id
}
```

这是画布之外的**拓扑索引**，用于 `addChild`/`deleteNode` 等操作能在 O(1) 时间找到父子关系。Excalidraw 场景本身不保存树结构。

### 2.3 订阅原则

| 组件 | 订阅方式 | 原因 |
| --- | --- | --- |
| `CanvasToolbar` | `useCanvasStore(state => ...)` | 需要响应 `pendingTool` / `showVersionHistory` 变化 |
| `CanvasInspector` | `useCanvasStore(state => ({ api, selectedElementId, ... }))` | 切换选区必须重渲染 |
| `CanvasMinimap` | `useCanvasStore(state => ({ api, changeCount }))` | 根据 changeCount 刷新绘制 |
| `CanvasTemplateModal` | `useCanvasStore(state => ({ api, showTemplatePicker }))` | 弹窗开关 |
| `ExcalidrawCanvas` | **不订阅**，只在事件里 `useCanvasStore.getState()` | 避免 onChange 风暴导致的无限 re-render |

---

## 3. Excalidraw 场景扩展字段

### 3.1 `customData.nodeType` 标识表

所有自定义卡片/思维导图节点都往 `element.customData` 里塞一个 `nodeType` 字段，Inspector、删除、序列化逻辑据此识别。

| nodeType | 元素层级 | 出现在哪些卡片 |
| --- | --- | --- |
| `sticky_note` | 矩形（根） | 便签根元素 |
| `sticky_note_text` | 文本 | 便签内部的文字 |
| `user_story` | 矩形（根） | 用户故事卡根部 |
| `ai_card` | 矩形（根） | AI 卡根部 |
| `prd_card` | 矩形（根） | PRD 章节卡根部 |
| `file_card` | 矩形（根） | 文件卡根部（携带 `fileId`） |
| `frame` | Frame（原生） | 分区框 |
| `mm_root` | 椭圆 | 思维导图根节点 |
| `mm_node` | 椭圆 | 思维导图非根节点 |
| `mm_arrow` | 箭头 | 思维导图父→子箭头（`fromId`, `toId`） |

**读取示例**：
```ts
const el = elements.find(e => e.id === selectedId)
const nodeType = (el.customData as any)?.nodeType
```

### 3.2 `groupIds` 约定

复合卡片的所有子元素共享 `groupIds: [gid]`（gid = uuid4）。这样：

- Excalidraw 默认行为：**点任一元素会整体高亮并整组移动**。
- Inspector 的 `getRootNode()`：从子元素反查同组中 `nodeType` 属于 root 类型的那个元素。
- 删除逻辑：`api.updateScene({ elements: allEls.filter(e => !e.groupIds.includes(gid)) })`

### 3.3 便签颜色 `customData.color`

便签除了 `nodeType: 'sticky_note'` 之外，额外写入 `color: 'yellow'|'green'|'pink'|'blue'|'purple'`。Inspector 的换色逻辑：
1. 读取新 color
2. 从 `STICKY_COLORS[color]` 拿到 `{ bg, stroke, text }`
3. 同组的矩形元素更新 `backgroundColor`/`strokeColor`，文本元素更新 `strokeColor`
4. 写回 `customData.color`

### 3.4 思维导图 `customData.mmText`

思维导图节点绑定的文本（Excalidraw 的 text bound to container）在椭圆上同时挂 `mmText`，方便脱离场景快速读取节点文字（例如序列化为 OPML、LLM prompt）。

---

## 4. 画布"文本摘要" — `extractText()`

为方便 AI 模块引用画布作为上下文，Store 提供：

```ts
extractText(): string
  // = api.getSceneElements()
  //     .filter(el => !el.isDeleted && el.type === 'text')
  //     .map(el => el.text)
  //     .join('\n')
```

使用场景：
- Chat 模块在构造 prompt 时调用 `canvasStore.getState().extractText()`。
- PRD 生成 agent 可把它作为 `ctx.canvas_text` 注入。

**局限**：当前只拼接原始 text 元素，不区分卡片类型或层级。后续可扩展为结构化摘要（例如把 `user_story` 卡输出为 "As a ... I want ... So that ..."）。

---

## 5. 示例：一张便签的完整元素序列

```json
[
  {
    "id": "rect-abc",
    "type": "rectangle",
    "x": 400, "y": 300, "width": 180, "height": 180,
    "backgroundColor": "#fff3bf", "strokeColor": "#e0a800",
    "roughness": 1, "roundness": { "type": 3 },
    "groupIds": ["grp-xyz"],
    "customData": { "nodeType": "sticky_note", "color": "yellow" }
  },
  {
    "id": "text-def",
    "type": "text",
    "x": 420, "y": 320, "width": 140, "height": 140,
    "text": "用户反馈登录太慢",
    "fontSize": 16, "fontFamily": 1,
    "strokeColor": "#5c3d00",
    "containerId": "rect-abc",
    "groupIds": ["grp-xyz"],
    "customData": { "nodeType": "sticky_note_text", "parentId": "rect-abc" }
  }
]
```

## 6. 版本迁移（待规划）

| 风险 | 触发条件 | 应对 |
| --- | --- | --- |
| Excalidraw 升级导致 element schema 变化 | 升级 `@excalidraw/excalidraw` | 写迁移脚本读取 `elements_json` → 新版 schema → 回写 |
| 自定义 `nodeType` 增加/改名 | 业务迭代 | 在 `nodeInsert.ts` 中保留旧别名兼容，或批量迁移 |
| `canvas_snapshots` 无限增长 | 长期使用 | 后续增加定期清理任务或列表分页 |
