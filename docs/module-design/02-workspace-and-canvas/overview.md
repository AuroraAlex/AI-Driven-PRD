# 工作区与画布 — 总体设计

> 最后更新：2026-04-22（增加多 Session 与跨域引用模型）

## 1. 模块目标

工作区是项目进入后的主界面，负责组织四个核心能力区域（画布 / 文件 / PRD / 知识库 + 聊天）的布局与切换。**画布**则是工作区的视觉与思考中心，采用 Miro 风格的"所见即所得"理念：

- **多会话（Multi-Session）**：每个项目下，画布、对话各自可拥有多个独立 Session，PRD 仍以 N 个文档存在；前端通过 `useSessionStore` 持久化每个项目当前活跃的 `(canvasSessionId, chatSessionId, prdId)`。
- **画布即上下文**：所有画布卡片都是结构化数据，可由 `agents/canvas/context.py`（Python）与 `frontend/src/components/canvas/extractCanvasContext.ts`（TS 镜像）渲染为 Markdown，按 `full|summary` 注入 AI 对话或同步入 RAG 知识图谱。
- **AI 卡片是真内容**：画布中的 AI 卡不再是"看图说话"的图片样式，而是带 `markdown / summary / sources / prompt / model / version` 的 v1 schema 富对象（存于 `customData.aiContent`），可双击打开 `AICardEditor` 编辑或一键 `aiCardsApi.generate` 重新生成。
- **跨域引用**：`references` 表把画布卡片、对话消息、PRD 章节、RAG 片段、文件全部抽象为节点，记录 `cites/derived_from/mentions/embedded_in` 等有向边，支撑反向溯源和"🔗 N"角标。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| Canvas Session | 项目下的一个命名画布"线程"，对应 `canvas_sessions` 表的一行 |
| Chat Session | 项目下的一个命名对话"线程"，对应 `chat_sessions` 表的一行 |
| 画布 (Canvas) | 单个 Canvas Session 下的 Excalidraw 平面，1:1 关联 `canvases` 表 |
| 场景 (Scene) | Excalidraw 内部运行时状态 = `elements[]` + `appState` + `files{}` |
| 自定义卡片 | 由多个基础元素 `groupIds` 组合而成的语义节点（便签 / 用户故事 / AI 卡 / PRD 卡 / 文件卡） |
| AICardContent | AI 卡片的 v1 富内容 schema，挂在根矩形 `customData.aiContent` |
| nodeType | 挂在 `customData.nodeType` 上的字符串标识，用于识别自定义卡片 |
| 快照 (Snapshot) | 画布的一次完整历史版本，per-session 存于 `canvas_snapshots` |
| RAG 来源 (Source) | `rag_indexes` 一行；`source_type ∈ {file, canvas, chat, prd}`，`doc_id` 命名为 `<source_type>:<id>` |
| Reference | `references` 表中一条有向边，连接两个跨域节点 |

## 3. 范围界定

### 3.1 本模块负责
- 工作区四栏布局（左侧功能面板 / 中间画布 / 右侧 Chat / 顶部 Knowledge tab）及 Canvas/Files/PRD/Knowledge 标签切换。
- Canvas Session 与 Chat Session 的创建 / 列表 / 重命名 / 归档，以及 `SessionSwitcher` 组件。
- 画布自动保存（防抖 1.5s）、引用 GC、回显与会话切换时的状态隔离。
- 7 种自定义卡片插入、编辑、删除；AI 卡片的双击编辑与重新生成（SSE）。
- 思维导图模式（Tab / Enter / Delete 快捷键建树）。
- 画布模板与小地图。
- 画布版本快照（per-session）的创建、列表、恢复。
- 画布 PNG / SVG 导出。
- 画布 → AI Prompt 渲染（`buildCanvasContext`，含 token 估算与 `summary` 模式回退）。
- 画布 → RAG 同步（`POST /rag/sync`，`source_type=canvas`）。
- 知识库面板（`KnowledgePanel`）：按来源类型筛选、同步、重建、重置。
- 引用浏览（`ReferencesDrawer` + `ReferencesBadge`）。

### 3.2 本模块不负责
- 画布元素背后的持久化抽象（由 `07-platform-and-shared-capabilities` 共享能力提供）。
- 聊天窗口本身（见 `04-ai-chat`）。
- 文件列表与 RAG 状态（见 `03-file-and-rag`）。
- PRD 编辑器（见 `05-prd-generation-and-editor`）。

## 4. 上下游依赖

```
┌─────────────────────────────────────────────┐
│            canvasStore (Zustand)            │
│ ExcalidrawAPI / pendingTool / selection /   │
│ mindMapMode / snapshots / changeCount       │
└─▲──────────────────────────▲────────────────┘
  │                          │
  │ getState()/set()         │ getState()/set()
  │                          │
┌─┴────────────┐ ┌───────────┴─────────┐ ┌──────────────────┐
│ CanvasToolbar│ │ ExcalidrawCanvas    │ │ CanvasInspector  │
│  (left)      │ │  (center)           │ │  (floating right)│
└──────────────┘ └─────────▲───────────┘ └──────────────────┘
                           │
            ┌──────────────┴──────────────┐
            │ @excalidraw/excalidraw      │
            │  v0.18.1 Imperative API     │
            └──────────────┬──────────────┘
                           │ HTTP (axios)
       ┌───────────────────┴──────────────────┐
       ▼                                      ▼
┌──────────────┐                    ┌────────────────────┐
│ /canvas      │                    │ /canvas/snapshots  │
│ PUT / GET    │                    │ POST / GET / RESTORE│
└──────┬───────┘                    └─────────┬──────────┘
       │                                       │
       ▼                                       ▼
┌──────────────────────────────────────────────────┐
│  SQLAlchemy  canvases  /  canvas_snapshots       │
└──────────────────────────────────────────────────┘
```

## 5. 实现入口速查

### 5.1 前端

| 文件 | 职责 |
| --- | --- |
| `frontend/src/pages/Workspace.tsx` | 工作区三栏布局、顶部 Tab、路由入口 |
| `frontend/src/components/canvas/ExcalidrawCanvas.tsx` | Excalidraw 宿主组件；自动保存、选区回调、插入卡片、思维导图快捷键 |
| `frontend/src/components/canvas/CanvasToolbar.tsx` | 左侧工具面板：卡片 / 结构 / 操作三组 |
| `frontend/src/components/canvas/CanvasInspector.tsx` | 右侧浮动属性面板；按 nodeType 显示不同控件 |
| `frontend/src/components/canvas/CanvasMinimap.tsx` | 右下角 160×90 小地图 + 视口指示器 |
| `frontend/src/components/canvas/CanvasTemplateModal.tsx` | 模板选择弹窗 |
| `frontend/src/components/canvas/nodeInsert.ts` | 自定义卡片工厂（7 种） |
| `frontend/src/components/canvas/mindMap.ts` | 思维导图节点的增删与自动布局 |
| `frontend/src/components/canvas/templates/*.ts` | 三套模板的元素生成器 |
| `frontend/src/store/canvasStore.ts` | Zustand 全局状态 |
| `frontend/src/api/client.ts` | `canvasApi` / `canvasSnapshotApi` |

### 5.2 后端

| 文件 | 职责 |
| --- | --- |
| `backend/app/api/canvas.py` | `GET/PUT /projects/{id}/canvas` |
| `backend/app/api/canvas_snapshot.py` | 快照 CRUD 与 restore |
| `backend/infra/models/canvas.py` | `canvases` 表（当前工作画布） |
| `backend/infra/models/canvas_snapshot.py` | `canvas_snapshots` 表（历史版本） |

## 6. 关键设计决策

### 6.1 为什么使用 Excalidraw 作为画布内核
- 成熟的无限画布 + 自由绘图 + 手绘风格，符合"头脑风暴"场景。
- 原生支持 `customData`、`groupIds`、`frame` 等扩展字段，方便叠加语义层。
- Imperative API（`updateScene` / `getSceneElements` / `getAppState`）足以支撑外部工具栏插入卡片、恢复快照。

### 6.2 为什么不复用 Excalidraw 的 Library
Excalidraw Library 是静态贴图式的，一旦拖入画布即成为普通图形。我们需要"可识别、可编辑的语义节点"（便签可以换色、AI 卡可以重生成），因此自建 `customData.nodeType` 体系。

### 6.3 为什么用 Zustand 而不是 Context
- Excalidraw onChange 高频触发；Context 会导致整树 re-render。
- 工具栏 / Inspector / Minimap 只在部分事件中需要读写共享状态，`useCanvasStore.getState()` 允许按需读取而不订阅。
- 见 [edge-cases.md 第 3 节] 避免无限循环的经验。

### 6.4 自定义卡片 = 元素组
所有复合卡片都由多个 Excalidraw 原生元素（矩形、文本、椭圆）通过同一 `groupIds[0]` 组合而成。这样：
- 拖动时整体移动（Excalidraw 原生行为）。
- Inspector 能从任意子元素反查到根元素。
- 删除时按 groupId 批量清除。

## 7. 数据流鸟瞰

```
用户点击工具栏「黄色便签」
  │
  ▼
canvasStore.setPendingTool('sticky_yellow')
  │
  ▼
CanvasToolbar 顶部显示「点击画布放置…」提示条
  │
  ▼
用户点击画布
  │
  ▼
ExcalidrawCanvas.handlePointerDown
  │  - 读取 pendingTool
  │  - toSceneCoords() 转换屏幕 → 场景坐标
  │  - createStickyNote(x, y, 'yellow')
  │  - api.updateScene({ elements: [...旧, ...新] })
  │  - setPendingTool(null)
  ▼
Excalidraw onChange 触发
  │  - 差异检测（JSON.stringify 对比）
  │  - bumpChangeCount 节流 500ms → 驱动 Minimap 重绘
  │  - 1.5s 防抖后 PUT /projects/{id}/canvas
  ▼
后端写入 canvases 表
```

## 8. 关键配置与常量

| 常量 | 位置 | 默认值 | 含义 |
| --- | --- | --- | --- |
| 自动保存防抖 | `ExcalidrawCanvas.tsx` | 1500ms | onChange → PUT /canvas 的延迟 |
| Minimap 刷新节流 | `ExcalidrawCanvas.tsx` | 500ms | bumpChangeCount 的最小间隔 |
| Minimap 尺寸 | `CanvasMinimap.tsx` | 160×90 | 小地图像素大小 |
| 思维导图 L1 半径 | `mindMap.ts` | 240 | 根节点到第一层子节点的距离 |
| 思维导图 L2+ 半径 | `mindMap.ts` | 180 | 第二层及更深的节点半径 |
| 快照数量限制 | `canvas_snapshot.py` 列表接口 | 20 | 仅返回最近 20 条 |
