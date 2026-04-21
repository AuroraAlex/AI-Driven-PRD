# AI-Driven PRD 需求讨论工具 — 完整实施计划

> 最后更新：2026-04-21

---

## 一、项目概述

一个基于浏览器的 AI 驱动 PRD 工具，核心能力：
- **无限画布**（Excalidraw）— 头脑风暴、绘图、便利贴
- **文件导入 & RAG**（LightRAG Agentic GraphRAG）— 上传资料，AI 自动构建知识图谱
- **AI 对话**（多模型）— 结合画布内容 + 知识图谱完善需求逻辑
- **模板化 PRD 生成**（ASPICE / IEEE SRS / Agile / Custom）— TipTap 编辑器
- **导出**（Word + PPT + PDF）— PPT 由 AI 生成内容后套模板渲染

---

## 二、技术栈

| 层 | 技术选型 | 说明 |
|---|---|---|
| 前端框架 | React 18 + TypeScript + Vite | |
| UI 风格 | Apple/Codex 极简毛玻璃 | -apple-system 字体, backdrop-blur |
| 组件库 | Tailwind v4 + shadcn/ui | |
| 画布 | @excalidraw/excalidraw v0.18.1 | |
| PRD 编辑器 | TipTap v3 | |
| 状态管理 | Zustand + React Query | |
| 后端框架 | FastAPI + Python 3.11 | |
| AI 路由 | LiteLLM | OpenAI/Anthropic，预留 Ollama |
| RAG | LightRAG (lightrag-hku) | Agentic GraphRAG, per-project |
| 数据库 | SQLite via SQLAlchemy | 可升级 PostgreSQL |
| PPT 生成 | AI JSON → python-pptx + 模板 | |
| PDF 导出 | LibreOffice headless | |

---

## 三、架构设计

### 3.1 分层模型

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────┐
│              app/ (HTTP 层 — 极薄，无业务逻辑)            │
│  main.py  deps.py  api/{projects,canvas,chat,rag,...}   │
└────────────────────────┬────────────────────────────────┘
                         │ 调用
┌────────────────────────▼────────────────────────────────┐
│              agents/ (业务逻辑核心，完全独立)             │
│  base.py  chat/  rag/  prd/  registry.py               │
└──────┬──────────────────────────────────────────────────┘
       │ 依赖
┌──────▼──────────────────────────────────────────────────┐
│              infra/ (基础设施，无业务逻辑)               │
│  llm.py  db.py  storage.py  models/                    │
└─────────────────────────────────────────────────────────┘
       │ 工具函数（无状态）
┌──────▼──────────────────────────────────────────────────┐
│              services/ (纯工具函数)                      │
│  text_extractor.py  ppt_renderer.py  export.py         │
└─────────────────────────────────────────────────────────┘
```

**依赖规则（强制约束）：**
- `agents/` → 可依赖 `infra/`，**禁止**依赖 `app/`
- `app/` → 可依赖 `agents/` + `infra/`
- `services/` → 无状态纯函数，不依赖项目内其他模块
- `infra/` → 只依赖外部库

### 3.2 Agent 独立可调试设计

所有 Agent 均可：
1. **pytest 独立测试** — 无需启动 HTTP Server，通过 Mock 注入依赖
2. **CLI 直接运行** — `python -m agents.chat --project-id ... --query ...`
3. **dry_run 模式** — 只返回构建好的 Prompt，不调用 LLM
4. **统一 trace_id** — 每次 `run()` 生成唯一 ID，全链路日志关联

### 3.3 统一事件流模型

所有 Agent 输出 `AsyncGenerator[AgentEvent, None]`：

```
EventType: token | tool_call | tool_result | rag_hit | done | error
```

HTTP 层直接将 AgentEvent 序列化为 SSE `data:` 帧。

---

## 四、目录结构

```
ai-prd-tool/
│
├── docs/                           # 文档
│   ├── PLAN.md                     # 本文件
│   └── API.md                      # 接口文档（待生成）
│
├── backend/
│   │
│   ├── agents/                     # ★ 核心业务逻辑层（完全独立）
│   │   ├── base.py                 # AgentContext, AgentEvent, BaseAgent 协议
│   │   ├── registry.py             # Agent 注册表
│   │   ├── chat/
│   │   │   ├── agent.py            # ChatAgent
│   │   │   ├── prompts.py          # System prompt 模板
│   │   │   ├── context_builder.py  # 组装上下文
│   │   │   └── tests/
│   │   ├── rag/
│   │   │   ├── agent.py            # RAGAgent: index() + query()
│   │   │   ├── graph_store.py      # LightRAG per-project LRU 实例管理
│   │   │   ├── chunker.py          # 文本分块策略
│   │   │   └── tests/
│   │   └── prd/
│   │       ├── agent.py            # PRDAgent: generate() + refine()
│   │       ├── prompts.py
│   │       ├── templates/          # JSON Schema
│   │       │   ├── aspice.json
│   │       │   ├── ieee_srs.json
│   │       │   ├── agile.json
│   │       │   └── custom.json
│   │       └── tests/
│   │
│   ├── app/                        # HTTP 层（薄层）
│   │   ├── main.py                 # FastAPI app + router 注册 + CORS
│   │   ├── deps.py                 # 依赖注入容器 (AppDeps)
│   │   └── api/
│   │       ├── projects.py
│   │       ├── canvas.py
│   │       ├── files.py
│   │       ├── chat.py             # SSE 流式端点
│   │       ├── rag.py              # RAG 状态查询、手动重建索引
│   │       ├── prd.py
│   │       └── export.py
│   │
│   ├── infra/                      # 基础设施层
│   │   ├── llm.py                  # LiteLLM 统一客户端 (LLMClient)
│   │   ├── db.py                   # SQLAlchemy engine + session factory
│   │   ├── storage.py              # 文件 I/O 抽象
│   │   └── models/                 # ORM 模型
│   │       ├── __init__.py
│   │       ├── project.py
│   │       ├── canvas.py
│   │       ├── attachment.py
│   │       ├── chat_message.py
│   │       ├── prd_document.py
│   │       ├── rag_index.py
│   │       └── ppt_template.py
│   │
│   ├── services/                   # 纯工具函数（无状态）
│   │   ├── text_extractor.py       # PDF/DOCX/图片文本提取
│   │   ├── ppt_renderer.py         # AI JSON → python-pptx
│   │   └── export.py               # DOCX/PDF 导出
│   │
│   ├── ppt_templates/              # 内置 .pptx 模板
│   ├── uploads/                    # 上传文件（按 project_id 分目录）
│   ├── rag_data/                   # LightRAG per-project 存储
│   │   └── {project_id}/           # 自动创建
│   ├── config.py                   # 统一配置（Pydantic Settings）
│   ├── requirements.txt
│   └── tests/
│       └── api/                    # 集成测试
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Home.tsx            # 项目列表首页
    │   │   ├── Workspace.tsx       # 主工作区（三栏布局）
    │   │   └── PRDEditor.tsx       # TipTap PRD 编辑页
    │   ├── components/
    │   │   ├── canvas/             # ExcalidrawCanvas
    │   │   ├── chat/               # ChatPanel, MessageBubble, ModelSelector
    │   │   ├── files/              # FilePanel, FileCard, UploadZone
    │   │   ├── prd/                # TemplateModal, PRDToolbar
    │   │   ├── export/             # ExportMenu, PPTTemplateSelector
    │   │   └── ui/                 # Apple 风格基础组件 (GlassCard, etc.)
    │   ├── store/                  # Zustand stores
    │   ├── api/                    # axios client + React Query hooks
    │   └── styles/
    │       └── tokens.css          # CSS 设计 Token
    └── package.json
```

---

## 五、数据模型

### ORM 表结构

| 表名 | 关键字段 |
|---|---|
| `projects` | id (uuid), name, description, created_at, updated_at |
| `canvases` | id, project_id (fk), elements_json (text), app_state_json (text), updated_at |
| `attachments` | id, project_id (fk), filename, original_name, file_type, file_size, extracted_text, rag_status, uploaded_at |
| `chat_messages` | id, project_id (fk), role, content, model_used, trace_id, created_at |
| `prd_documents` | id, project_id (fk), template_type, title, content_html, created_at, updated_at |
| `rag_indexes` | id, project_id (fk), attachment_id (fk), status (pending/indexed/failed), indexed_at, error_msg |
| `ppt_templates` | id, name, file_path, thumbnail_path, is_builtin, created_at |

---

## 六、核心接口 (API)

### Projects
- `GET    /api/projects`              — 项目列表
- `POST   /api/projects`              — 创建项目
- `GET    /api/projects/{id}`         — 项目详情
- `PATCH  /api/projects/{id}`         — 更新项目名/描述
- `DELETE /api/projects/{id}`         — 删除项目（级联删除所有关联数据）

### Canvas
- `GET    /api/projects/{id}/canvas`  — 获取画布状态
- `PUT    /api/projects/{id}/canvas`  — 保存画布状态（防抖后调用）

### Files
- `POST   /api/projects/{id}/files`   — 上传文件（multipart，≤100MB）
- `GET    /api/projects/{id}/files`   — 文件列表（含 rag_status）
- `DELETE /api/projects/{id}/files/{file_id}` — 删除文件

### Chat (SSE)
- `POST   /api/projects/{id}/chat`    — 流式对话
  ```json
  { "message": "...", "model": "openai/gpt-4o", "rag_mode": "hybrid" }
  ```
  响应：`text/event-stream`，每帧为序列化的 `AgentEvent`

### RAG
- `GET    /api/projects/{id}/rag/status`           — 各文件索引状态
- `POST   /api/projects/{id}/rag/rebuild`          — 手动重建整个项目知识图谱
- `POST   /api/projects/{id}/rag/query`            — 直接查询 RAG（调试用）

### PRD
- `POST   /api/projects/{id}/prd/generate`         — AI 生成 PRD
  ```json
  { "template_type": "agile", "model": "openai/gpt-4o" }
  ```
- `GET    /api/projects/{id}/prd`                  — 获取最新 PRD
- `PUT    /api/projects/{id}/prd/{prd_id}`         — 保存编辑内容

### Export
- `GET    /api/prd/{prd_id}/export/docx`           — 下载 Word
- `GET    /api/prd/{prd_id}/export/pdf`            — 下载 PDF
- `POST   /api/prd/{prd_id}/export/pptx`           — 生成并下载 PPT
  ```json
  { "template_id": "builtin_minimal", "model": "openai/gpt-4o" }
  ```

---

## 七、关键 Agent 接口

```python
# agents/base.py

@dataclass
class AgentContext:
    project_id: str
    user_query: str
    canvas_text: str = ""
    attached_files: list[FileContext] = field(default_factory=list)
    chat_history: list[Message] = field(default_factory=list)
    rag_mode: str = "hybrid"           # naive/local/global/hybrid
    model: str = "openai/gpt-4o"
    metadata: dict = field(default_factory=dict)

@dataclass
class AgentEvent:
    type: EventType                    # token|tool_call|tool_result|rag_hit|done|error
    agent: str                         # "chat" / "rag" / "prd"
    data: Any
    trace_id: str
    timestamp: float

class BaseAgent(Protocol):
    agent_name: str
    async def run(self, ctx: AgentContext, *, dry_run: bool = False
                  ) -> AsyncGenerator[AgentEvent, None]: ...
```

---

## 八、PPT 生成流程

```
PRD HTML 内容
  ↓ POST /api/prd/{id}/export/pptx
PRDAgent.to_slide_json()
  → LiteLLM 输出结构化 JSON:
    {
      "slides": [
        { "layout": "title|content|two-col|quote",
          "title": "...",
          "bullets": ["...", "..."],
          "speaker_notes": "..." }
      ]
    }
  ↓
ppt_renderer.render(slide_json, template_path)
  → python-pptx 套用用户选择的 .pptx 模板
  ↓
FileResponse(.pptx)
```

---

## 九、LightRAG 集成

```
文件上传 → 文本提取
  ↓ BackgroundTask
RAGAgent.index(project_id, text, doc_id)
  → rag_data/{project_id}/ 下构建知识图谱
  → 更新 rag_indexes.status = "indexed"

用户提问 → ChatAgent.run()
  → RAGAgent.query(ctx, trace_id)
    → LightRAG.aquery(question, mode=ctx.rag_mode)
    → yield AgentEvent(type="rag_hit", data={"context": "..."})
  → 将 rag_context 注入 system prompt
```

**RAG 查询模式：**
| 模式 | 适用场景 |
|---|---|
| `naive` | 快速纯向量检索 |
| `local` | 实体为中心，查具体功能点 |
| `global` | 社区摘要，查宏观架构 |
| `hybrid` | 默认，两者合并，最全面 |

---

## 十、UI 风格规范

```css
/* Design Tokens */
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
--font-mono: "SF Mono", "Fira Code", Menlo, monospace;

/* Light */
--bg-primary: #ffffff;
--bg-secondary: #f5f5f7;
--bg-glass: rgba(255, 255, 255, 0.72);
--backdrop: blur(20px) saturate(180%);
--accent: #5B5BD6;
--border: rgba(0, 0, 0, 0.08);
--text-primary: #1d1d1f;
--text-secondary: #6e6e73;

/* Shadow */
--shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
--shadow-glass: 0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6);
--radius-lg: 16px;
--radius-md: 10px;
```

**Workspace 布局：**
```
┌──────────────────────────────────────────────────────────────┐
│  [≡ 项目名]  [模型: GPT-4o ▼]  [RAG: hybrid ▼]  [生成PRD]  [导出▼] │
├─────────────┬────────────────────────────────┬───────────────┤
│  AI 对话    │                                │  文件 & 附件  │
│  (毛玻璃)   │    Excalidraw 无限画布          │  (毛玻璃)     │
│             │                                │  [拖拽上传]   │
│  消息流     │  形状/文字/便利贴/图片/导入      │               │
│             │                                │  file.pdf     │
│  [输入框]   │                                │  ● 已索引     │
└─────────────┴────────────────────────────────┴───────────────┘
```

---

## 十一、分阶段实施计划

### Phase 1 — 基础框架 *(目标：可启动的骨架)*
- [x] 输出本 PLAN.md
- [ ] 后端：`config.py` + `infra/db.py` + `infra/models/` (7张表)
- [ ] 后端：`agents/base.py` 协议定义
- [ ] 后端：`infra/llm.py` LiteLLM 封装
- [ ] 后端：`app/main.py` + `app/deps.py` + `app/api/projects.py`
- [ ] 前端：Vite+React+TS 初始化，design tokens，首页项目列表

### Phase 2 — 画布 & 文件管理
- [ ] 后端：`app/api/canvas.py` + `app/api/files.py`
- [ ] 后端：`services/text_extractor.py`
- [ ] 前端：Workspace 三栏布局，ExcalidrawCanvas，FilePanel

### Phase 3 — RAG 集成
- [ ] 后端：`agents/rag/agent.py` + `agents/rag/graph_store.py`
- [ ] 后端：`app/api/rag.py`
- [ ] 文件上传后触发 BackgroundTask 索引
- [ ] 前端：文件 RAG 状态 badge

### Phase 4 — AI Chat
- [ ] 后端：`agents/chat/agent.py` + `context_builder.py` + `prompts.py`
- [ ] 后端：`app/api/chat.py` (SSE)
- [ ] 前端：ChatPanel 流式显示，RAG 模式切换

### Phase 5 — PRD 生成 & 编辑
- [ ] 后端：`agents/prd/agent.py` + 4套模板 JSON
- [ ] 后端：`app/api/prd.py`
- [ ] 前端：TemplateModal + PRDEditor (TipTap)

### Phase 6 — 导出
- [ ] 后端：`services/ppt_renderer.py` + `services/export.py`
- [ ] 后端：`app/api/export.py`
- [ ] 前端：ExportMenu + PPTTemplateSelector

---

## 十二、关键风险与缓解

| 风险 | 缓解方案 |
|---|---|
| LightRAG 大文件索引耗时 | BackgroundTask 异步，UI badge 显示状态，完成后 SSE 推送 |
| LightRAG per-project 实例内存 | dict + LRU 淘汰（最多保留 N 个活跃实例） |
| PPT AI JSON 输出不稳定 | `response_format={"type":"json_object"}` + Pydantic 验证 + fallback |
| LibreOffice 未安装 | 启动时检测，PDF 功能 graceful degradation |
| LightRAG 实体提取 LLM 费用 | 可配置 embedding-only 轻量模式 |

---

## 十三、本地开发启动

```bash
# 后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev   # http://localhost:5173

# Agent 独立调试
cd backend
python -m agents.chat --project-id test --query "帮我整理需求"
python -m agents.rag query --project-id test --mode hybrid --query "认证模块"
```
