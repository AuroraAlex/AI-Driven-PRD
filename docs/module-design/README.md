# 功能模块设计文档索引

> 最后更新：2026-04-21

## 1. 目的

本目录用于承接 AI PRD 工具后续的功能模块详细设计文档。

相比 [PLAN.md](/Users/lihl/WorkSpace/AI_PRD/docs/PLAN.md) 的实施计划，这里更关注模块边界、交互流程、数据模型、接口契约、异常处理和待决策项，便于后续逐模块展开设计、评审和迭代。

## 2. 模块划分原则

本次文档拆分遵循以下原则：

1. 按用户可感知的业务能力划分，而不是按代码目录机械拆分。
2. 前后端共同完成一个业务闭环的能力，归入同一模块目录。
3. 共享基础能力单独成模块，避免重复描述数据库、LLM、存储、鉴权、配置等共性设计。
4. 每个模块目录只承载一个相对完整的问题域，避免单个目录过大或职责交叉。

## 3. 模块清单

| 编号 | 模块目录 | 模块名称 | 负责范围 | 对应实现入口 |
| --- | --- | --- | --- | --- |
| 00 | `00-template` | 文档模板 | 统一详细设计写法、章节模板、评审检查项 | 文档规范 |
| 01 | `01-project-management` | 项目管理 | 项目创建、列表、详情、更新、删除，以及项目级资源生命周期 | `backend/app/api/projects.py`, `frontend/src/pages/Home.tsx` |
| 02 | `02-workspace-and-canvas` | 工作区与画布 | 工作区主布局、画布加载/保存、页面切换、画布状态回显 | `backend/app/api/canvas.py`, `frontend/src/pages/Workspace.tsx`, `frontend/src/components/canvas/ExcalidrawCanvas.tsx` |
| 03 | `03-file-and-rag` | 文件管理与知识库 | 文件上传/删除、文本提取、索引状态、RAG 生命周期、知识查询入口 | `backend/app/api/files.py`, `backend/app/api/rag.py`, `frontend/src/components/files/FilePanel.tsx` |
| 04 | `04-ai-chat` | AI 对话 | 聊天历史、模型切换、RAG 模式切换、SSE 事件流、消息落库 | `backend/app/api/chat.py`, `backend/agents/chat/agent.py`, `frontend/src/components/chat/ChatPanel.tsx` |
| 05 | `05-prd-generation-and-editor` | PRD 生成与编辑 | 模板选择、PRD 生成、文档列表、编辑、自动保存 | `backend/app/api/prd.py`, `backend/agents/prd/agent.py`, `frontend/src/components/prd/TemplateModal.tsx`, `frontend/src/pages/PRDEditor.tsx` |
| 06 | `06-export-and-delivery` | 导出与交付 | DOCX/PDF/PPTX 导出、模板套用、下载交付链路 | `backend/app/api/export.py`, `backend/services/export.py`, `backend/services/ppt_renderer.py` |
| 07 | `07-platform-and-shared-capabilities` | 平台与共享能力 | 配置、数据库、ORM、存储、LLM 封装、公共依赖注入、日志与追踪 | `backend/config.py`, `backend/infra/`, `backend/app/deps.py`, `frontend/src/api/client.ts` |

## 4. 目录结构

```text
docs/
└── module-design/
    ├── README.md
    ├── 00-template/
    ├── 01-project-management/
    ├── 02-workspace-and-canvas/
    ├── 03-file-and-rag/
    ├── 04-ai-chat/
    ├── 05-prd-generation-and-editor/
    ├── 06-export-and-delivery/
    └── 07-platform-and-shared-capabilities/
```

## 5. 每个模块建议包含的详细设计文件

后续补充详细设计时，建议按需新增以下文件：

- `overview.md`：模块目标、范围、术语、上下游依赖。
- `workflow.md`：主流程、时序图、状态流转、用户操作路径。
- `api.md`：接口定义、请求响应示例、状态码、幂等性、错误语义。
- `data-model.md`：数据库表、对象结构、前端状态模型、缓存策略。
- `edge-cases.md`：异常路径、降级策略、边界条件、已知风险。
- `open-questions.md`：待确认决策、风险项、跨模块依赖问题。

不是所有模块都必须具备以上文件，但建议优先保证 `overview.md`、`workflow.md` 和 `api.md`。

## 6. 建议编写顺序

建议先补以下模块：

1. `07-platform-and-shared-capabilities`，先定公共约束和共享依赖。
2. `01-project-management` 与 `02-workspace-and-canvas`，先稳定基础交互骨架。
3. `03-file-and-rag` 与 `04-ai-chat`，明确知识链路与对话链路。
4. `05-prd-generation-and-editor`，补齐核心产出模块。
5. `06-export-and-delivery`，最后完善交付链路。

## 7. 文档维护约定

1. 每个模块目录至少保留一个 `README.md` 作为索引页。
2. 模块新增子文档后，应在模块 `README.md` 中补充链接和状态。
3. 若某项设计同时影响多个模块，应优先写入共享能力模块，再在业务模块中引用。
4. 已实现现状与目标设计存在偏差时，应在模块文档中明确区分“当前实现”和“目标方案”。