# 电商详情页工作台

一个由四个技能驱动的 15 屏电商详情页生产系统：

1. `image-research`：多角度产品图与八维视觉研究。
2. `detail-page-planning`：证据优先的 15 屏 9:16 策划。
3. `detail-page-execution`：A / B / D / E 四类执行交付与独立生图。
4. `detail-page-qa`：只读质检、问题定位与报告导出。

旧版策划、模板兜底、主图和提示词全量拼接链路已移除。应用仅沿用两套 API 配置：

- 文案/视觉理解模型：优先使用浏览器已验证配置，否则使用服务端环境变量
- 独立生图模型：浏览器持久化键 `image-provider-config`

## 火山方舟 Ark

应用使用现有 OpenAI 兼容 Node SDK，不需要安装 Python SDK。复制 `.env.example`
为 `.env.local`，配置：

```bash
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-1-8-251228
```

火山方舟模型名称和 `ep-...` 推理接入点统一使用 Responses API。服务端配置不会
发送到浏览器；右上角“文案模型”中的已验证浏览器配置仍可独立覆盖服务端默认值。

## 启动

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm test
npm run build
```

应用直接从 `/` 进入工作台，`/workspace` 会重定向到根路径。
