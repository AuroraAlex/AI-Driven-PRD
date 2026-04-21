# 文件管理与知识库模块

## 模块目标

负责文件上传、删除、文本提取、索引状态管理和基于项目知识库的查询能力。

## 当前实现入口

- 后端文件接口：`backend/app/api/files.py`
- 后端 RAG 接口：`backend/app/api/rag.py`
- Agent：`backend/agents/rag/agent.py`
- 前端：`frontend/src/components/files/FilePanel.tsx`

## 建议后续补充

- `workflow.md`：上传到索引完成的完整链路
- `api.md`：文件与 RAG 相关接口
- `edge-cases.md`：不支持文件、空文本、删除后残留、重建失败