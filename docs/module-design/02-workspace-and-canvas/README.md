# 工作区与画布模块

> 最后更新：2026-04-21

本模块承载"所有想法、结构、图形都发生在同一张画布上"的产品核心理念，是 PRD 工坊里信息的主容器。下游的 AI Chat / 文件管理 / PRD 生成都以这张画布为"事实来源"。

## 模块目标

- 提供一个 Miro 风格的无限画布作为唯一工作区。
- 在画布上原地承载：便签、用户故事、AI 生成卡片、PRD 章节卡、文件卡、Frame 分区、思维导图等多种节点类型。
- 负责画布的载入、自动保存、版本快照与恢复。
- 为 AI Chat / PRD 生成提供结构化的"上下文抽取"。

## 文档索引

| 文件 | 内容 |
| --- | --- |
| [overview.md](overview.md) | 模块目标 / 设计原则 / 术语 / 关键设计决策 / 常量 |
| [workflow.md](workflow.md) | 进入工作区、画布回显、自动保存、卡片插入、Inspector、思维导图、模板、快照恢复、导出等全量流程 |
| [api.md](api.md) | REST 接口签名、请求/响应字段、错误码、幂等性、DB 表、前端 SDK |
| [data-model.md](data-model.md) | 后端 ORM、前端 Zustand store、`customData.nodeType` 分类、元素示例 JSON |
| [components.md](components.md) | 组件树、ExcalidrawCanvas 内部 refs、Toolbar/Inspector/Minimap/Template/nodeInsert/mindMap 设计 |
| [edge-cases.md](edge-cases.md) | 已知边界情况、历史 bug 复盘（渲染循环、CSS 缺失）、坐标陷阱、并发保存 |
| [open-questions.md](open-questions.md) | 待决策项、下一步优化清单、预留的跨模块联动 hook |

## 当前实现入口

### 后端

| 文件 | 职责 |
| --- | --- |
| `backend/app/api/canvas.py` | `GET/PUT /api/projects/{id}/canvas` |
| `backend/app/api/canvas_snapshot.py` | 快照的 CRUD / 恢复接口 |
| `backend/infra/models/canvas.py` | `Canvas` / `CanvasSnapshot` ORM |
| `backend/infra/models/__init__.py` | 表注册 |

### 前端

| 文件 | 职责 |
| --- | --- |
| `frontend/src/pages/Workspace.tsx` | 三栏布局、Tab 切换、面板组合 |
| `frontend/src/components/canvas/ExcalidrawCanvas.tsx` | 画布主容器、动态加载、自动保存 |
| `frontend/src/components/canvas/CanvasToolbar.tsx` | 左侧工具栏（卡片 / 结构 / 操作） |
| `frontend/src/components/canvas/CanvasInspector.tsx` | 选中元素的属性面板 |
| `frontend/src/components/canvas/CanvasMinimap.tsx` | 右下小地图 |
| `frontend/src/components/canvas/CanvasTemplateModal.tsx` | 模板选择弹窗 |
| `frontend/src/components/canvas/nodeInsert.ts` | 各类卡片元素的工厂函数 |
| `frontend/src/components/canvas/mindMap.ts` | 思维导图节点增删与布局 |
| `frontend/src/store/canvasStore.ts` | Zustand：API 引用、选中状态、pending tool、思维导图元数据 |
| `frontend/src/api/client.ts` | `canvasApi` / `canvasSnapshotApi` SDK |
| `frontend/src/main.tsx` | 引入 `@excalidraw/excalidraw/index.css` |

## 与其它模块的关系

```
┌──────────── 01 项目管理 ────────────┐
│  项目创建 → 跳转到 Workspace        │
└───────────────────┬──────────────────┘
                    │ projectId
                    ▼
┌─────────── 02 工作区与画布（本模块）───────────┐
│                                               │
│  画布 = 所有内容的物理容器                    │
│                                               │
│  ├─ extractText() ─────────────► 04 AI Chat   │
│  │                              （作为上下文） │
│  │                                             │
│  ├─ prd_card 节点 ─────────────► 05 PRD 生成  │
│  │                              （章节信号源） │
│  │                                             │
│  └─ file_card 节点 ◄───────────► 03 文件管理  │
│                                （拖拽/引用）   │
└────────────────────────────────────────────────┘
```

详细联动请参阅 [workflow.md](workflow.md) 与 [open-questions.md](open-questions.md)。