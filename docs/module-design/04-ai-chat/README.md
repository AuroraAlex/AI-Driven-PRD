# AI 对话模块

## 模块目标

负责聊天历史、模型选择、RAG 模式切换、流式返回和消息持久化，形成可追踪的 AI 对话闭环。

## 当前实现入口

- 后端接口：`backend/app/api/chat.py`
- Agent：`backend/agents/chat/agent.py`
- Prompt：`backend/agents/chat/prompts.py`
- 前端：`frontend/src/components/chat/ChatPanel.tsx`

## 建议后续补充

- `workflow.md`：用户提问到 SSE 回流的时序
- `api.md`：聊天历史与流式接口契约
- `edge-cases.md`：中断重连、空上下文、模型失败、RAG 未命中