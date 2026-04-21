# 工作区与画布 — 边界情况与异常处理

> 最后更新：2026-04-21

## 1. 已处理的异常场景

| 场景 | 行为 |
| --- | --- |
| 首次进入项目，后端无画布记录 | `GET /canvas` 返回 `null`，前端跳过 updateScene，保持空画布 |
| 画布 JSON 反序列化失败 | `try/catch` 吞掉错误，保持空画布；不向用户报错以免打断 |
| 保存接口 500 | 画布右上角显示 "保存失败"（红色）；下一次变更仍会重试；本地 scene 不丢失 |
| 保存接口网络超时 | 同上，右上角红色提示；用户手动触发任何变更会再次触发防抖保存 |
| 项目在保存途中被删除 | PUT 返回 404，前端显示保存失败；下次用户会被重定向到 Home（由全局 interceptor 处理） |
| 快照创建时 `label` 为空 | 后端默认 `"快照"` |
| 快照列表超过 20 条 | 仅返回最近 20；旧的仍在表中但前端不可见 |
| 进入/退出画布时 Excalidraw 未加载完 | `if (!Excalidraw) return <Loading />`；避免对 null API 调用 |
| React StrictMode 双挂载 | `initialized.current` 防止重复发起 GET；`isRestoring.current` 防止回显期间污染保存 |
| 工具栏选了卡片后在 Excalidraw UI 自身（如工具栏图标）上点击 | 事件目标检测：若 `target.closest('.excalidraw-container [class*="ToolIcon"]')` 命中则忽略 |
| 工具栏选了卡片后用户不点击画布直接切换工具 | `setPendingTool(newTool)` 覆盖，旧 pending 被丢弃 |
| 思维导图模式下删除了根节点 | 递归删除所有子孙；`resetMm()` 清空 store 并关闭模式 |
| 恢复快照后用户反悔 | 恢复操作**只写前端 scene 不写后端**；只要不触发新的变更，`canvases` 表仍是老版本 |

## 2. 前端渲染循环陷阱（已解决）

### 2.1 历史 bug：`Maximum update depth exceeded`

**症状**：打开画布后浏览器抛 `Uncaught Error: Maximum update depth exceeded`，整个应用卡死。

**根因**：
```ts
// ❌ 反例
const store = useCanvasStore()           // 订阅整个 store
...
<Excalidraw
  excalidrawAPI={api => setExcalidrawAPI(api)}   // 每次渲染新函数
  onChange={() => { store.bumpChangeCount(); ... }}
/>
```

循环链：
```
onChange → bumpChangeCount() → store 变更
       → 组件订阅了 store → 重渲染
       → 传新的 excalidrawAPI callback → Excalidraw useEffect 视作变化
       → 触发 onChange (?)/ 内部 setState
       → ...
```

**修复**（见 `components.md §2`）：
1. `ExcalidrawCanvas` 组件**完全不订阅 store**，只在事件处理函数里 `useCanvasStore.getState()`。
2. `excalidrawAPI` 回调用 `useCallback([])` 稳定化。
3. `bumpChangeCount` 加 500ms 节流。
4. `selectedElementId` 写入前先与 `lastSelectedId.current` 比较，避免重复写。

## 3. 样式缺失陷阱（已解决）

### 3.1 历史 bug：画布白屏/布局错乱 + 巨大锁图标

**症状**：Excalidraw 组件加载后，界面显示一个巨大的锁图标，工具栏全部不渲染，字体异常。

**根因**：未导入 Excalidraw 的全局样式 `@excalidraw/excalidraw/index.css`。v0.18 版本起不再自动注入样式，需由使用方显式 import。

**修复**（`frontend/src/main.tsx`）：
```ts
import '@excalidraw/excalidraw/index.css'   // ← 必须在 './index.css' 之前
import './index.css'
```

## 4. 坐标系统陷阱

Excalidraw 的 `scrollX` / `scrollY` 是**负的屏幕偏移**；`zoom.value` 是缩放比例。屏幕坐标 → 场景坐标：

```ts
sceneX = (clientX - containerRect.left - appState.scrollX) / zoom.value
sceneY = (clientY - containerRect.top  - appState.scrollY) / zoom.value
```

常见错误：
- ❌ 忘记减去 `containerRect.left/top` → 多显示器或嵌套滚动时错位
- ❌ 使用 `appState.zoom` 作为数字 → v0.18+ 里 `zoom` 是 `{ value: number }` 对象

## 5. 元素 `isDeleted` 与 groupIds

Excalidraw 不真正从数组中删除元素，而是打 `isDeleted: true` 标记。所有遍历/分析代码必须：
```ts
elements.filter(e => !e.isDeleted)
```

`groupIds` 是数组（支持嵌套分组）；本模块只用到 `groupIds[0]`，嵌套分组能力未启用。若未来要扩展到 Frame 嵌套，需改为全数组匹配。

## 6. files_json 图片引用

Excalidraw 的图片（粘贴、拖拽）不存在元素里，而是元素记录 `fileId`，实际二进制在 `appState.files[fileId]` 下。保存时前端把 `api.getFiles()` 序列化为 `files_json`。

**风险**：大图片粘贴会使 `files_json` 膨胀；SQLite 的 TEXT 字段虽然无硬上限，但单次 PUT 超过数十 MB 会导致：
- 自动保存接口明显变慢
- 浏览器卡顿（JSON.stringify 整个 dataURL）

**缓解（待实现）**：
- 粘贴图片时前端改为上传到 `/api/files`，元素只保存 URL 而不是 dataURL。
- 或对超过阈值的 `files_json` 改为独立表存储。

## 7. 并发保存

当前设计假设**单用户、单 tab** 编辑同一项目画布。多 tab 场景：

- 两个 tab 都会各自防抖保存 → 最后一个 PUT 覆盖。
- 无冲突检测、无乐观锁。
- 若未来支持协作，需要：
  - `canvases.revision` 字段
  - 乐观锁：PUT 时携带 `if_match` 字段，版本不符返 409
  - 或切 CRDT / Yjs 协议

## 8. 思维导图边界

| 场景 | 行为 |
| --- | --- |
| 在非思维导图节点上按 Tab/Enter | 键盘监听检查 `selectedElementId` 对应节点的 customData；非 mm_* 类型直接 ignore |
| 同一父节点孩子 > 12 个 | `relayoutChildren` 仍然均匀分布，但相邻节点重叠。后续可做半径自适应（按 count 扩展） |
| 文本过长 | 椭圆固定大小，文本超出裁剪。后续可改为"文本撑大椭圆" |

## 9. 模板应用后已有内容冲突

模板是**追加**而非替换。极端情况下模板 frame 可能与已有元素重叠 → 用户需手动拖开。未来可在应用模板前 `scrollToContent` + 计算空白区域偏移放置模板。

## 10. 未加载元素时导出

若画布为空点击"导出 PNG"，`exportToBlob` 会返回一张全白 200×200 PNG。不报错，但用户可能困惑。后续可加空场景检测：若 `getSceneElements().filter(!isDeleted).length === 0` 就 toast "画布为空" 并中止。

## 11. 退出页面时未保存

当前自动保存防抖 1.5s，若用户变更后立即关闭 tab，最后一次变更可能丢失。

**缓解方案**：
- 可在 `window.beforeunload` 里同步触发一次保存（需接受警告弹窗）。
- 或把"正在保存"状态纳入 beforeunload 警告，避免用户在 `saving` 状态下关页。

当前**未实现**，作为待处理项。

## 12. 恢复快照后 `files_json` 不同步

当前恢复接口只返回 `elements_json` + `app_state_json`，**不包含** `files_json`。若快照包含图片，恢复后图片元素会显示占位符。

**修复方向**：
- 快照表加 `files_json` 字段，与 elements 一同保存/恢复。
- 当前为节省体积暂未加；预留在 [open-questions.md] 讨论。
