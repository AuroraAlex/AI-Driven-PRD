# 工作区与画布 — 总体设计

> 最后更新：2026-04-21

## 1. 模块目标

工作区是项目进入后的主界面，负责组织三个核心能力区域（画布 / 文件 / PRD / 聊天）的布局与切换。**画布**则是工作区的视觉与思考中心，采用 Miro 风格的"所见即所得"理念：

- **想法、结构、视觉处于同一空间**：便签、卡片、分区框、思维导图、自由绘图共存于同一张无限画布。
- **内容在画布中持续演进**，而不是一次性生成：每一种卡片都可选中、编辑、复制、移动、删除。
- **从概念到交付的链路在同一工具内闭环**：画布内容可被 AI 读取（通过 `extractText()`）作为上下文，与聊天、PRD、文件形成互通。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 画布 (Canvas) | 基于 Excalidraw 的无限平面绘图区域，存储用户的全部视觉元素 |
| 场景 (Scene) | Excalidraw 内部运行时状态 = `elements[]` + `appState` + `files{}` |
| 元素 (Element) | Excalidraw 的最小单位；矩形、椭圆、箭头、文字、Frame 等 |
| 自定义卡片 | 由多个基础元素 `groupIds` 组合而成的语义节点（便签 / 用户故事 / AI 卡 / PRD 卡 / 文件卡） |
| nodeType | 挂在 `customData.nodeType` 上的字符串标识，用于识别自定义卡片 |
| 快照 (Snapshot) | 画布的一次完整历史版本，持久化到后端 `canvas_snapshots` 表 |
| Pending Tool | 工具栏"点一次插入一次"的插入工具状态，存在 `canvasStore.pendingTool` |

## 3. 范围界定

### 3.1 本模块负责
- 工作区三栏布局（左侧功能面板 / 中间画布 / 右侧 Chat）及标签切换（Canvas / Files / PRD）。
- 画布自动保存（防抖 1.5s）与回显（进入页面时拉取最新画布状态）。
- 7 种自定义卡片插入、编辑、删除。
- 思维导图模式（Tab / Enter / Delete 快捷键建树）。
- 画布模板（用户旅程图 / 功能分解图 / 思维导图起点）。
- 小地图（Minimap）定位与跳转。
- 画布版本快照的创建、列表、恢复。
- 画布 PNG / SVG 导出。
- `extractText()` 提供给 Chat / PRD 模块作为 AI 上下文。

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
