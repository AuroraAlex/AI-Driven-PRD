# 导出与交付模块

## 模块目标

负责将 PRD 内容导出为 DOCX、PDF、PPTX，并处理模板套用、格式转换和交付下载链路。

## 当前实现入口

- 后端接口：`backend/app/api/export.py`
- 导出服务：`backend/services/export.py`
- PPT 渲染：`backend/services/ppt_renderer.py`
- 前端入口：`frontend/src/components/prd/TemplateModal.tsx`

## 建议后续补充

- `workflow.md`：三种导出链路的差异化流程
- `api.md`：下载接口、文件命名、错误语义
- `edge-cases.md`：LibreOffice 缺失、模板不存在、导出超时