# PRD 生成与编辑模块

## 模块目标

负责模板选择、AI 生成 PRD、文档列表维护、编辑与自动保存，构成产品文档的核心生产链路。

## 当前实现入口

- 后端接口：`backend/app/api/prd.py`
- Agent：`backend/agents/prd/agent.py`
- 模板：`backend/agents/prd/templates/`
- 前端：`frontend/src/components/prd/TemplateModal.tsx`
- 编辑器：`frontend/src/pages/PRDEditor.tsx`

## 建议后续补充

- `overview.md`：模板体系与文档生命周期
- `workflow.md`：生成、打开、编辑、保存的完整流程
- `edge-cases.md`：模板非法、生成失败、接口契约偏差、内容覆盖冲突