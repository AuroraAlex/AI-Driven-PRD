# 工作区与画布 — 流程设计

> 最后更新：2026-04-21

本文描述工作区与画布的核心用户路径、组件协作时序、自动保存与快照流转。

## 1. 进入工作区

```
用户点击 Home 页项目卡片
  │
  ▼
导航到 /workspace/:projectId
  │
  ▼
Workspace.tsx
  ├─ useQuery(['project', id])           ── 加载项目元信息
  ├─ 默认 leftPanel = 'canvas'
  └─ 渲染：
      ┌─────────────────────────────────────────────────┐
      │ Header: [← 返回] [项目名] [Canvas|Files|PRD]    │
      ├─────────┬─────────────────────────┬─────────────┤
      │ Canvas  │ ExcalidrawCanvas         │ ChatPanel  │
      │ Toolbar │  + Inspector (absolute)  │            │
      │ (左)    │  + Minimap (absolute)    │            │
      │         │  + TemplateModal (portal)│            │
      └─────────┴─────────────────────────┴─────────────┘
```

顶部 Tab 切换只改变左侧面板的内容；中间画布**始终保留**（不会因切到 Files 而卸载），避免 Excalidraw 重新初始化导致的状态丢失。

## 2. 画布初始化与回显

```
ExcalidrawCanvas 挂载
  │
  ▼
useExcalidraw()  ── 动态 import('@excalidraw/excalidraw')
  │
  ▼
Excalidraw 组件首次渲染 → 触发 excalidrawAPI={handleApi}
  │
  ▼
handleApi(api)
  ├─ setExcalidrawAPI(api)                 ── 组件本地 state
  └─ canvasStore.setApi(api)               ── 全局共享
  │
  ▼
useEffect[excalidrawAPI, projectId]
  ├─ initialized.current = true            ── 防止重入
  ├─ isRestoring.current = true
  ├─ canvasApi.get(projectId)
  │     → { elements_json, app_state_json, files_json } | null
  ├─ 解析 JSON → api.updateScene({ elements, appState, files })
  └─ isRestoring.current = false
```

**关键点**：
- `isRestoring` 在恢复期间屏蔽 onChange 回调写入后端，防止回显数据被覆盖。
- `initialized` 防止 React StrictMode 下的重复执行。
- 如果后端返回 `null`（新项目首次进入），直接跳过 updateScene，保留空画布。

## 3. 自动保存流程（防抖）

```
Excalidraw 内部任何变更（拖、画、输入）
  │
  ▼
onChange → handleChange()
  │
  ├─ if isRestoring → 丢弃
  ├─ if stringified elements == lastSaved → 丢弃  ◀── 防止 viewport 变化触发空保存
  │
  ├─ [节流 500ms] bumpChangeCount()  ──→ 驱动 Minimap 重绘
  │
  └─ setSaveStatus('saving')
     clearTimeout(saveTimer)
     saveTimer = setTimeout(saveFn, 1500)
        │
        ▼
     saveFn:
        PUT /api/projects/{id}/canvas {
          elements_json,
          app_state_json: { viewBackgroundColor, zoom, scrollX, scrollY },
          files_json,
        }
        │
        ├─ 成功 → lastSavedElementsJson = 当前 JSON
        │         setSaveStatus('saved')
        │         2s 后自动回到 'idle'
        │
        └─ 失败 → setSaveStatus('error')
```

状态指示器显示在画布右上角：保存中 / 已保存 / 保存失败。

## 4. 插入自定义卡片

### 4.1 两步模型（点击工具 → 点击画布）

选择"点击工具栏 → 再点画布"而不是"拖拽"，原因：
- 符合 Miro 的便签、Figma 的 frame 工具操作习惯。
- 移动端触摸友好。
- 实现简单，不需处理 HTML5 DragEvent 与 Excalidraw 画布坐标转换的复杂度。

```
用户点击 CanvasToolbar 的 "AI 卡片"
  │
  ▼
canvasStore.setPendingTool('ai_card')
  │
  ▼
CanvasToolbar 顶部出现条幅提示：
  「点击画布任意位置放置 AI 卡片，按 Esc 取消」
  │
  ▼
用户在画布上 pointerdown
  │
  ▼
ExcalidrawCanvas.handlePointerDown(e)
  ├─ pendingTool !== null 才执行
  ├─ toSceneCoords(e, api)            ── clientX/Y → scene x/y
  │      (e.clientX - rect.left - appState.scrollX) / zoom
  │
  ├─ switch(pendingTool):
  │     'sticky_yellow'|...|  → createStickyNote(x, y, color)
  │     'user_story'          → createUserStoryCard(x, y)
  │     'ai_card'             → createAICard(x, y)
  │     'prd_card'            → createPRDCard(x, y)
  │     'file_card'           → createFileCard(x, y)
  │     'frame'               → createFrame(x, y)
  │
  ├─ api.updateScene({ elements: [...现有, ...新元素] })
  ├─ setPendingTool(null)
  ├─ e.preventDefault() / stopPropagation()   ── 阻止 Excalidraw 进入绘制模式
```

### 4.2 卡片结构

每种卡片由若干基础元素组成，共享同一 `groupIds[0]`：

| 卡片 | 元素组成 | customData.nodeType |
| --- | --- | --- |
| 便签 | 圆角矩形 + 文本 | `sticky_note` / `sticky_note_text` |
| 用户故事 | 蓝色标题矩形 + "As a / I want / So that" 3 组 (label + field) | `user_story` |
| AI 卡片 | 紫色标题 "✦ AI 生成" + 正文矩形 | `ai_card` |
| PRD 章节 | 绿色标题 "📄 PRD章节" + 正文矩形 | `prd_card` |
| 文件卡 | 灰色缩略图 + 📎 图标 + 标签 | `file_card`（携带 `fileId`） |
| 分区框 | Excalidraw 原生 `frame` 元素 | `frame` |
| 思维导图节点 | 椭圆 + 绑定文本 | `mm_root` / `mm_node` |

## 5. Inspector 选区联动

```
用户点击画布上的元素
  │
  ▼
Excalidraw 内部更新 appState.selectedElementIds
  │
  ▼
ExcalidrawCanvas.handlePointerUp
  ├─ 读取 appState.selectedElementIds
  ├─ nextId = Object.keys(...)[0] ?? null
  ├─ if nextId === lastSelectedId → return   ◀── 去重
  └─ canvasStore.setSelectedElementId(nextId)
  │
  ▼
CanvasInspector re-render（仅订阅了 selectedElementId）
  ├─ getRootNode(els, selectedId)     ◀── 从子元素查 groupIds 回到根
  ├─ 按 nodeType 分派控件：
  │     sticky_note → 5 色色板 + textarea
  │     ai_card / prd_card → 正文 textarea
  │     frame → 标题 input
  │     其它   → 只显示 x/y/w/h
  └─ 底部"删除"按钮：按 groupId 批量移除
```

Inspector 的编辑**直接调用 `api.updateScene({ elements })`**，不经过 React 状态；修改完成后 `forceUpdate` 一次自身以刷新输入框。

## 6. 思维导图模式

```
用户点击 CanvasToolbar 的 "思维导图"
  │
  ▼
canvasStore.setMindMapMode(true)
  │
  ▼
在画布中心插入根节点（addRootNode）
  │
  ▼
键盘监听（ExcalidrawCanvas useEffect）：
  - Tab   → addChildNode(api, selectedId)
  - Enter → addSiblingNode(api, selectedId)
  - Delete/Backspace → deleteNode(api, selectedId)
```

### 6.1 辐射式自动布局
- 根到 L1 子节点距离：240px
- L2+ 子节点距离：180px
- 新增子节点时 `relayoutChildren(parentId)` 把所有孩子重新均匀分布在 2π 上。

### 6.2 节点 ↔ 箭头关系
- 每次 `addChildNode` 创建一个椭圆节点 + 一支箭头。
- 箭头的 `customData.fromId` / `toId` 记录拓扑，便于删除时联动清理。
- `deleteNode` 递归收集子节点 + 文本 + 箭头，批量从 scene 中移除，并从 `canvasStore.mmNodes` 中删除。

## 7. 模板应用

```
CanvasToolbar「选择模板」→ showTemplatePicker = true
  │
  ▼
CanvasTemplateModal 渲染三张卡片：
  🗺️ 用户旅程图     🌳 功能分解图    🧠 思维导图起点
  │
  ▼
用户选择模板
  │
  ├─ 调用 <templateName>Elements()
  │     返回 ExcalidrawElement[]
  │
  ├─ api.updateScene({
  │     elements: [...现有, ...模板元素],
  │     appState: { ...当前, scrollX: 0, scrollY: 0 }
  │   })
  │
  └─ setTimeout(80ms) → api.scrollToContent()  ── 自动对焦新内容
```

模板元素是**增量追加**而非替换；这样与用户已有内容可共存。

## 8. 版本快照

### 8.1 创建
```
CanvasToolbar「保存版本」
  │
  ├─ label = prompt('备注')
  ├─ elementsJson = JSON.stringify(api.getSceneElements())
  ├─ appStateJson = JSON.stringify(api.getAppState())
  │
  ▼
POST /api/projects/{id}/canvas/snapshots
  body: { elements_json, app_state_json, label }
  │
  ▼
后端插入 canvas_snapshots，返回完整 SnapshotOut
  │
  ▼
canvasStore.setSnapshots([new, ...old])
canvasStore.setShowVersionHistory(true)
```

### 8.2 恢复
```
VersionHistory 列表点击一条
  │
  ▼
GET /api/projects/{id}/canvas/snapshots/{snapshotId}
  │
  ├─ 返回 { elements_json, app_state_json, ... }
  │
  ▼
api.updateScene({
  elements: JSON.parse(elements_json),
  appState: { ...api.getAppState(), ...JSON.parse(app_state_json) }
})
```

**恢复只更新前端 scene，不自动写回 `/canvas` 当前画布**；下一次 onChange 才会触发保存，用户有一次"预览后再决定"的机会。

## 9. Minimap 更新

```
ExcalidrawCanvas onChange
  │
  ├─ （500ms 节流）bumpChangeCount → changeCount++
  │
  ▼
CanvasMinimap useEffect[api, changeCount]
  ├─ els = api.getSceneElements().filter(!isDeleted)
  ├─ 计算元素包围盒 (minX, minY, maxX, maxY)
  ├─ scale = min(160/boxW, 90/boxH)
  ├─ 清空 canvas
  ├─ for el in els: fillRect(缩放后坐标)
  └─ strokeRect(viewport 指示器，#339af0)
```

点击 Minimap：
```
mouseX/Y → 反向缩放 → 场景坐标
api.updateScene({ appState: { scrollX, scrollY } })
```

## 10. 画布导出

```
CanvasToolbar「导出 PNG / SVG」
  │
  ▼
动态 import('@excalidraw/excalidraw')
  │
  ├─ PNG: exportToBlob({ elements, appState, files, mimeType: 'image/png' })
  │        → URL.createObjectURL → <a download>
  │
  └─ SVG: exportToSvg({ elements, appState, files })
           → new XMLSerializer + Blob → <a download>
```

导出完全在浏览器侧完成，不走后端。

## 11. 与其它模块的协作钩子

| 被调用方 | 接口 | 用途 |
| --- | --- | --- |
| `canvasStore.extractText()` | 返回画布中所有文本元素 `\n` 拼接 | AI Chat / PRD 生成时作为上下文 |
| `canvasStore.api.getSceneElements()` | 任意组件可拿到 Excalidraw 场景 | 供 AI 分析结构（尚未接入） |
| `nodeInsert.createFileCard(..., fileId)` | 由 FilePanel 拖拽到画布时调用 | 文件模块 → 画布的数据绑定入口 |
| `nodeInsert.createAICard(x, y, content)` | 支持预填 AI 生成内容 | Chat 模块把 AI 回复"钉"到画布 |

---

## 多 Session、AI 卡片、知识库流程（2026-04-22 新增）

### 1. 会话切换

1. 进入项目，`Workspace.tsx` 通过 `useSessionStore.getCanvasSessionId(projectId)` / `getChatSessionId(projectId)` 取上次活跃会话。
2. `SessionSwitcher` 渲染时若 `canvasSessionsApi.list()` 为空则自动 `create()` 一个默认会话；否则自动选第一个非归档项。
3. 切换会话后 `setCurrentCanvasSessionId(sid)` 同步到 `useCanvasStore`，`<ChatPanel>` 默认把当前画布 sid 注入 prompt。
4. `ExcalidrawCanvas` 内 `useEffect([canvasSessionId])` 重置 `initialized.current` 并调用 `canvasApi.get(pid, sid)` 重新载入。

### 2. AI 卡片生成与编辑

1. 在 `ChatPanel` 用 LLM 生成回答，用户点 "📌 钉到画布" → 调用 `createAICard(x, y, content)`，写入 `customData.aiContent`。
2. 双击画布上的 AI 卡 → `ExcalidrawCanvas.handleDoubleClick` 走 `groupIds[0]` → `setOpenAICardId(gid)`。
3. `<AICardEditor>` 弹出，可编辑 `prompt / summary / markdown`，点 **重新生成** → `aiCardsApi.generate()` SSE：`token` 帧实时累计 markdown，`card` 终帧整体覆盖 + 立即 `persist()`。
4. 保存时 `customData.aiContent.version += 1`，并把 `summary || markdown` 截断 200 字回写到 `ai_card_body` 文本，使卡面预览刷新。

### 3. 画布作为 RAG 来源

1. 用户在 `KnowledgePanel` 点 **同步画布** → `knowledgeApi.sync({source_type:'canvas'})`。
2. 后端 `RAGAgent.upsert(pid, render_session(elements), doc_id="canvas:{sid}")` 入图谱。
3. 状态写入 `rag_indexes`：`source_type='canvas'`、`source_session_id=sid`、`doc_id='canvas:{sid}'`。
4. 删除会话时 CASCADE 触发，但 LightRAG 内对应 `doc_id` 由 `delete_by_doc_id` 兜底，失败则建议用户点 **重置**。

### 4. 引用关系维护

1. AI 卡保存时若引用了画布内其它卡 / RAG chunk，前端 / 后端按需 `referencesApi.create()`（幂等 upsert）。
2. 画布 `PUT canvas` 时后端 `_collect_card_ids()` diff，自动删除 source 或 target 不存在的 `references` 行。
3. 任意节点旁的 `<ReferencesBadge>` 显示 `🔗 N`，点击打开 `<ReferencesDrawer>` 双向列表。
