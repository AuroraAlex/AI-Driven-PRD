# 工作区与画布 — 组件设计

> 最后更新：2026-04-21

本文解释画布子系统在前端的组件树、各组件职责、以及它们如何在画布容器内叠加布局。

## 1. 组件树

```
Workspace.tsx
├─ Header                            项目名 / 三个 Tab 按钮
├─ 左侧 panel (w-64)
│   ├─ CanvasToolbar (当 tab=canvas)
│   ├─ FilePanel     (当 tab=files)
│   └─ TemplateModal (当 tab=prd)
│
├─ 中间 panel (flex-1, relative)
│   └─ 当 openPRD === null:
│       ├─ ExcalidrawCanvas         绝对占满
│       ├─ CanvasInspector          absolute right-3 top-3 z-20
│       ├─ CanvasMinimap            absolute right-4 bottom-4 z-10
│       └─ CanvasTemplateModal      fixed inset-0 z-50 (portal)
│       显示 openPRD 时：PRDEditor 占满
│
└─ 右侧 panel (w-80)
    └─ ChatPanel
```

## 2. ExcalidrawCanvas

### 2.1 职责
- 动态加载 `@excalidraw/excalidraw`（避免 SSR / 减小首屏包体）。
- 初次渲染时 `canvasApi.get()` 回显场景。
- 防抖自动保存 `canvasApi.save()`。
- 把 `ExcalidrawImperativeAPI` 注入到 `canvasStore.api`，供其它组件调用。
- 监听 `pointerDown` 处理卡片插入。
- 监听 `pointerUp` 更新 `canvasStore.selectedElementId`。
- 监听 `window keydown` 处理思维导图快捷键。

### 2.2 关键本地 refs（避免渲染循环）

| Ref | 作用 |
| --- | --- |
| `initialized` | 防止 StrictMode 双调用时重复拉取画布 |
| `isRestoring` | 回显期间屏蔽 onChange，避免覆盖 |
| `lastSavedElementsJson` | 仅当 elements 真的变化时才保存 |
| `lastMinimapBump` | 500ms 节流计时 |
| `lastSelectedId` | 仅当选区真的变化时才写 store |
| `saveTimer` / `savedTimer` | 保存防抖 / "已保存"状态自动清除 |

### 2.3 handleApi（稳定 API 回调）
```ts
const handleApi = useCallback((api) => {
  setExcalidrawAPI(api)
  useCanvasStore.getState().setApi(api)
}, [])
```
必须 `useCallback([])` — 否则每次渲染都传新函数给 Excalidraw 会触发其内部 effect 循环。

## 3. CanvasToolbar（左侧）

### 3.1 三段式布局
```
┌──────────── 卡片 ────────────┐
│ 🟡🟢🔴🔵🟣 便签五色          │   五个色板按钮 setPendingTool('sticky_<color>')
│ 👤 用户故事                   │
│ ✦ AI 卡片                    │
│ 📄 PRD 章节                  │
│ 📎 文件卡                    │
├──────────── 结构 ────────────┤
│ ▢ 分区框 (Frame)             │
│ 🧠 思维导图  [切换/进入]      │
├──────────── 操作 ────────────┤
│ 🗂 选择模板                  │
│ 🎯 适应画布 (scrollToContent)│
│ ⬇ 导出 PNG                   │
│ ⬇ 导出 SVG                   │
│ 💾 保存版本                  │
│ 🕘 版本历史                  │
└───────────────────────────────┘
```

### 3.2 待放置提示条
当 `pendingTool !== null` 时，Toolbar 顶部显示：
```
┌───────────────────────────────────┐
│  点击画布任意位置放置 AI 卡片     │
│                      [取消]       │
└───────────────────────────────────┘
```
按 Esc 或点击取消按钮 → `setPendingTool(null)`。

### 3.3 版本历史面板
点击"版本历史"按钮时展开一个内嵌 dropdown：
- 列表显示 `{ label, created_at 相对时间 }`
- 每一项有"恢复"按钮 → `canvasSnapshotApi.get()` → `api.updateScene()`

## 4. CanvasInspector（右侧浮动）

### 4.1 渲染条件
`if (!api || !selectedElementId) return null`

避免空态也渲染一个空面板。

### 4.2 控件分派
```
nodeType === 'sticky_note'
  ├─ 5 色色板     → updateCustomData + 改矩形背景/描边 + 文本描边
  └─ textarea     → updateText(containerId)

nodeType === 'ai_card' / 'prd_card' / 'user_story'
  └─ textarea     → updateText (body 元素)

nodeType === 'frame'
  └─ input        → api.updateScene({ elements: [...修改 name 字段] })

其它（自由绘图图形）
  └─ 只显示 x/y/w/h 只读

底部
  └─ 🗑 删除   →  按 groupIds 批量移除
```

### 4.3 `getRootNode` 算法
```
input: 选中元素 id
  │
  ├─ 若元素无 groupIds → 直接返回自身
  ├─ 取 groupIds[0] = gid
  ├─ 同组所有元素
  └─ 返回第一个 nodeType ∈ root types 的元素
       否则返回同组第一个元素
```

## 5. CanvasMinimap（右下角）

160×90 `<canvas>`，每次 `changeCount` 变化重绘：

- 根据所有元素的包围盒自动计算缩放比例。
- 每个元素画成一个色块（`backgroundColor` 或默认灰）。
- 画一个蓝色矩形指示当前视口位置（由 `appState.scrollX/Y` 和 `zoom` 推导）。
- 点击任意位置 → 将该点转换为场景坐标 → `api.updateScene({ appState: { scrollX, scrollY } })`。

## 6. CanvasTemplateModal

简单 fixed 全屏遮罩 + 中央卡片：
- 三张大按钮（Emoji + 名称 + 描述）。
- 点击时调用 `<name>Elements()` 获得元素数组 → `updateScene({ elements: [...现有, ...模板] })` → `scrollToContent()`。
- Esc 或点击遮罩关闭。

## 7. nodeInsert.ts（元素工厂）

每个工厂函数都返回 **`CanvasEl[]`**（`Record<string, any>[]` 松类型，避开 Excalidraw 内部类型）并共享一个 `groupId`：

```ts
export function createStickyNote(x, y, color) {
  const gid = uuid()
  return [
    { id: uuid(), type: 'rectangle', ..., groupIds: [gid],
      customData: { nodeType: 'sticky_note', color } },
    { id: uuid(), type: 'text',      ..., groupIds: [gid],
      containerId: '<rectId>',
      customData: { nodeType: 'sticky_note_text', parentId: '<rectId>' } },
  ]
}
```

关键设计细节：
- **文本绑定**：便签/AI 卡/PRD 卡的文字通过 `containerId` 绑定到矩形内，自动随矩形缩放/移动。
- **`text` vs `originalText`**：Excalidraw 要求文本元素同时带 `text` 与 `originalText`（用于编辑回显）。工厂函数两者一起写入。
- **`fontFamily` = 1**：Excalidraw 默认的手绘字体；文字卡片用 `fontFamily = 2`（Normal）更严肃。

## 8. mindMap.ts（思维导图操作）

### 8.1 `addChildNode(api, parentId, text?)`

```
1. 找到 parent 的中心坐标
2. relayoutChildren(parentId) 重新均匀分布已有孩子
3. 计算新节点的角度 = 2π / (childrenIds.length + 1) * index
4. radius = parentId === root ? 240 : 180
5. 创建椭圆 + 绑定文本
6. 创建从 parent → child 的箭头
7. store.upsertMmNode(新节点)
8. api.updateScene({ elements: [...现有, 椭圆, 文本, 箭头] })
```

### 8.2 `deleteNode(api, nodeId)`
- 递归收集所有后代节点 id。
- 收集它们的绑定文本、入边箭头。
- 一次性 `updateScene` 移除所有。
- 从 `canvasStore.mmNodes` 中同步删除。
- 若父节点还在，调用 `relayoutChildren(parentId)` 重新均布剩余孩子。

## 9. 性能要点

| 潜在问题 | 解决 |
| --- | --- |
| onChange 高频触发 (~60 FPS) 导致 setState 爆炸 | 在 ExcalidrawCanvas 中完全不订阅 store；所有写入走 getState() |
| Minimap 每帧重绘 | `bumpChangeCount` 500ms 节流 |
| Inspector 每次选择都卸载重挂 | 条件渲染 + 内部 `forceUpdate` 精细控制 |
| 自动保存风暴 | 1.5s 防抖 + elementsJson 字符串比较跳过空保存 |
| 全场景 JSON.stringify | Excalidraw 元素数量通常 <1000，实测可接受；未来若超出可换 murmur hash 或长度 + 最后修改时间比较 |

## 10. 已知权衡

- **松类型 `CanvasEl = Record<string, any>`**：为避免深度依赖 Excalidraw 内部类型文件（它们在 `node_modules` 内路径经常变动），工厂函数统一使用松类型，写 `updateScene({ elements: ... as never[] })` 强转。代价是 TS 不能校验元素字段；收益是升级 Excalidraw 时无须改类型。
- **Inspector 用 `forceUpdate` 而非 controlled input**：Excalidraw 场景才是唯一事实源，Inspector 只是读取/写入的窗口；用 controlled state 会引入"输入框 vs 场景"的两份真相。
