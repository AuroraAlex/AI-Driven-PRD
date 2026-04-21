# 平台与共享能力模块

## 模块目标

负责承接跨业务模块复用的底层能力，包括配置、数据库、ORM、存储、LLM 封装、依赖注入和公共调用约束。

## 当前实现入口

- 配置：`backend/config.py`
- 基础设施：`backend/infra/`
- 依赖注入：`backend/app/deps.py`
- 前端 API 客户端：`frontend/src/api/client.ts`

## 建议后续补充

- `overview.md`：共享能力边界与使用约束
- `data-model.md`：数据库和公共对象模型
- `edge-cases.md`：配置缺失、第三方依赖失败、环境差异、启动失败