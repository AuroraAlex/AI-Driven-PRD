# 项目管理模块

## 模块目标

负责项目的创建、列表展示、详情查看、更新和删除，并确保项目生命周期与其下属资源保持一致。

## 当前实现入口

- 后端：`backend/app/api/projects.py`
- 数据模型：`backend/infra/models/project.py`
- 前端：`frontend/src/pages/Home.tsx`

## 建议后续补充

- `overview.md`：项目生命周期与资源边界
- `api.md`：项目 CRUD 接口契约
- `edge-cases.md`：删除级联、空状态、重复名称策略