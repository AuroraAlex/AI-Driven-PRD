# 工作区与画布 — 接口设计

> 最后更新：2026-04-22（多 session、AI 卡、引用、知识库）

所有接口前缀为 `/api`。**画布与对话现在均按 session 维度组织**，URL 形如 `/projects/{pid}/canvas-sessions/{sid}/...`。

## 0. 新增 / 重写路由总览

### Sessions
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET / POST` | `/projects/{pid}/canvas-sessions` | 列表 / 创建（自动建空 canvas） |
| `PATCH / DELETE` | `/projects/{pid}/canvas-sessions/{sid}` | 重命名/排序/归档 / 删除（级联画布与快照） |
| `GET / POST / PATCH / DELETE` | `/projects/{pid}/chat-sessions[/{sid}]` | 同上，不会自动建子表 |

### 画布（per-session）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET / PUT` | `/projects/{pid}/canvas-sessions/{sid}/canvas` | 拉取/保存；PUT 时按卡片 groupId 增删做 `references` GC |
| `GET / POST` | `/projects/{pid}/canvas-sessions/{sid}/snapshots` | 列表/保存版本 |
| `GET / DELETE` | `/projects/{pid}/canvas-sessions/{sid}/snapshots/{id}` | 详情/删除 |
| `POST` | `/projects/{pid}/canvas-sessions/{sid}/snapshots/{id}/restore` | 恢复版本 |

### 对话（per-session）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/projects/{pid}/chat-sessions/{sid}/chat` | SSE；body 含 `canvas_session_ids`、`include_canvas_context`、`canvas_context_mode`；首帧 `meta` 返回 `{canvas_session_ids, estimated_canvas_tokens}` |
| `GET` | `/projects/{pid}/chat-sessions/{sid}/messages` | 历史消息 |

### AI 卡片
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/projects/{pid}/ai-cards/generate` | SSE；中间帧 `{type:'token', data}`，最终帧 `{type:'card', data: AICardContent}` |

### 引用
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/projects/{pid}/references` | 查询参数 `node_type, node_id, direction=outgoing|incoming|both` |
| `POST` | `/projects/{pid}/references` | 幂等 upsert（按 unique 元组） |
| `DELETE` | `/projects/{pid}/references/{ref_id}` | 删除 |

### 知识库 / RAG
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/projects/{pid}/rag/status` | 文件级别状态（兼容旧接口） |
| `GET` | `/projects/{pid}/rag/sources` | 全部 `RAGIndex` 行（含 source_type） |
| `POST` | `/projects/{pid}/rag/sync` | body `{source_type: canvas|chat|prd, session_ids?: []}`；返回 `{indexed: [], failed: [{doc_id, error}]}` |
| `POST` | `/projects/{pid}/rag/rebuild` | 重建文件索引 |
| `POST` | `/projects/{pid}/rag/reset` | rmtree + 删除全部 RAGIndex 行 |
| `POST` | `/projects/{pid}/rag/query` | 查询 |

### 已废弃 / 已迁移
- `GET / PUT  /api/projects/{pid}/canvas` → 改用 session 版本。
- `GET / POST /api/projects/{pid}/snapshots` → 改用 session 版本。
- `POST       /api/projects/{pid}/chat` → 改用 chat-session 版本。

---

## 1. 路由总览（旧版，保留参考）

| 方法 | 路径 | 说明 | 状态码 |
| --- | --- | --- | --- |
| GET | `/api/projects/{project_id}/canvas` | 获取当前画布 | 200 / 404 |
| PUT | `/api/projects/{project_id}/canvas` | 保存当前画布（upsert） | 200 / 404 |
| POST | `/api/projects/{project_id}/canvas/snapshots` | 创建版本快照 | 201 / 404 |
| GET | `/api/projects/{project_id}/canvas/snapshots` | 快照列表（最近 20） | 200 / 404 |
| GET | `/api/projects/{project_id}/canvas/snapshots/{snapshot_id}` | 获取单个快照完整内容 | 200 / 404 |
| POST | `/api/projects/{project_id}/canvas/snapshots/{snapshot_id}/restore` | 获取快照（客户端自行 updateScene） | 200 / 404 |

> 当前实现**未提供 DELETE 快照**；超过 20 条时仅返回最近 20 条，历史数据仍然保留。若需要清理机制属于后续增强项。

---

## 2. 当前画布

### 2.1 `GET /api/projects/{project_id}/canvas`

**请求**：无 body。

**响应 200**（存在时）：
```json
{
  "id": "9f3b2a1c-...",
  "project_id": "b7e4c2f3-...",
  "elements_json": "[ ... Excalidraw elements ... ]",
  "app_state_json": "{ \"viewBackgroundColor\": \"#ffffff\", \"zoom\": { \"value\": 1 }, \"scrollX\": 0, \"scrollY\": 0 }",
  "files_json": "{ \"<fileId>\": { \"mimeType\": \"image/png\", \"dataURL\": \"...\" } }",
  "updated_at": "2026-04-21T12:30:00Z"
}
```

**响应 200**（不存在时）：`null`。前端以此判断首次进入、初始化空画布。

### 2.2 `PUT /api/projects/{project_id}/canvas`

**请求 body**：
```json
{
  "elements_json": "[ ... ]",
  "app_state_json": "{ ... }",
  "files_json": "{ ... }"
}
```

字段均为 string（前端 `JSON.stringify` 之后再发）。后端不解析字段内容，作为 BLOB 存储。

**行为**：
- 项目不存在 → 404
- 记录不存在 → 插入新行（id = uuid4）
- 记录存在 → 整体覆盖，并将 `updated_at` 刷新为 `now(UTC)`

**响应 200**：同 `GET` 响应结构。

### 2.3 `app_state_json` 前端精简写入
前端保存时**不会**写入全部 Excalidraw appState，仅保留 4 个关键字段：
```json
{
  "viewBackgroundColor": "...",
  "zoom": { "value": 1 },
  "scrollX": 0,
  "scrollY": 0
}
```
原因：完整 appState 包含大量运行时字段（collaborators, penMode, theme, exportBackground, ...），持久化会产生噪音且可能引入跨版本兼容问题。

---

## 3. 版本快照

### 3.1 `POST /api/projects/{project_id}/canvas/snapshots`

**请求 body**（所有字段可选，有默认值）：
```json
{
  "elements_json": "[ ... ]",
  "app_state_json": "{ ... }",
  "label": "完成第一版用户旅程"
}
```

默认值：`elements_json="[]"`, `app_state_json="{}"`, `label="快照"`。

**响应 201** (SnapshotOut)：
```json
{
  "id": "e1a2...-b4c5",
  "label": "完成第一版用户旅程",
  "created_at": "2026-04-21T12:34:56Z",
  "elements_json": "[ ... ]",
  "app_state_json": "{ ... }"
}
```

### 3.2 `GET /api/projects/{project_id}/canvas/snapshots`

**响应 200**（SnapshotMeta 列表，按 `created_at` DESC，最多 20 条）：
```json
[
  { "id": "...", "label": "v3 — 竞品对齐", "created_at": "..." },
  { "id": "...", "label": "v2",            "created_at": "..." }
]
```

> 为减少传输体积，列表接口**不返回 `elements_json` / `app_state_json`**，仅在单条 GET 时提供。

### 3.3 `GET /api/projects/{project_id}/canvas/snapshots/{snapshot_id}`

返回完整 SnapshotOut（含 JSON body）。404 若快照不存在或不属于该项目。

### 3.4 `POST /api/projects/{project_id}/canvas/snapshots/{snapshot_id}/restore`

语义上是"我想恢复这个快照"。但**当前实现仅原样返回快照内容**，前端调用 Excalidraw API `updateScene` 完成实际恢复。

```json
POST → 200 SnapshotOut  (同 3.3)
```

这种"不在服务端直接覆盖当前画布"的设计有三点考虑：
1. 用户可能只是预览，不想真的覆盖。
2. 避免冲突：用户在其它 tab 可能正在编辑当前画布。
3. 服务端保持无状态，所有画布变更都走 PUT `/canvas` 的正常通路。

前端恢复后若用户继续编辑，下一次 onChange 自动保存会把最新内容覆盖到 `canvases` 表。

---

## 4. 数据模型（数据库）

### 4.1 `canvases` 表
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | String(36) | PK, uuid | |
| `project_id` | String(36) | FK→projects CASCADE, **UNIQUE** | 项目 1:1 画布 |
| `elements_json` | Text | default `"[]"` | Excalidraw 元素数组 |
| `app_state_json` | Text | default `"{}"` | 视口状态 |
| `files_json` | Text | default `"{}"` | 内嵌图片/文件 |
| `updated_at` | DateTime(tz) | auto | 最近保存时间 |

### 4.2 `canvas_snapshots` 表
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | String(36) | PK, uuid | |
| `project_id` | String(36) | FK→projects CASCADE, **索引** | 项目 1:N 快照 |
| `elements_json` | Text | default `"[]"` | |
| `app_state_json` | Text | default `"{}"` | |
| `label` | String(200) | default `"快照"` | 用户输入的备注 |
| `created_at` | DateTime(tz) | default now | 创建时间，列表排序依据 |

两表都在 `backend/infra/models/__init__.py` 中被导入，`init_db()` 调用 `Base.metadata.create_all(bind=engine)` 时自动建表。

---

## 5. 前端封装

### 5.1 `canvasApi`（`frontend/src/api/client.ts`）
```ts
canvasApi.get(projectId)                         // → CanvasOut | null
canvasApi.save(projectId, { elements_json,       // → CanvasOut
                             app_state_json,
                             files_json })
```

### 5.2 `canvasSnapshotApi`
```ts
canvasSnapshotApi.create(projectId, elements_json, app_state_json, label?)
canvasSnapshotApi.list(projectId)                 // → CanvasSnapshotMeta[]
canvasSnapshotApi.get(projectId, snapshotId)      // → CanvasSnapshotOut
canvasSnapshotApi.restore(projectId, snapshotId)  // → CanvasSnapshotOut
```

所有调用都通过 `http = axios.create({ baseURL: /api })` 实例，错误由全局 interceptor 统一 toast 提示。

---

## 6. 错误与幂等

| 场景 | 行为 |
| --- | --- |
| `project_id` 不存在 | 所有画布接口返回 `404 {"detail":"Project not found"}` |
| `snapshot_id` 不存在或跨项目 | 404 |
| 连续多次 PUT `/canvas` 相同 body | 正常 upsert，`updated_at` 刷新；无副作用（幂等） |
| 快照创建并发 | 各自插入独立行（id 由前端生成 uuid 碰撞概率忽略） |
| 请求体 JSON 非法（如 elements_json 不是合法 JSON 字符串） | 后端**不校验**，原样存储；前端回显时 `JSON.parse` 失败会被 `try/catch` 吞掉并保持空画布 |

## 7. 未来扩展位

- **快照软删除**：加 `deleted_at` 字段 + `DELETE /snapshots/{id}` 端点。
- **快照 diff**：后端给两个 snapshot_id 计算元素差异，前端做红绿对比视图。
- **画布协作锁**：为未来多人实时画布预留 `revision` 乐观锁字段。
- **画布导出到后端**：当前 PNG/SVG 导出走前端，若需要服务端渲染（例如作为 PRD 嵌入图）可加 `POST /canvas/export`。
