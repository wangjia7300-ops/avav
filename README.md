# 电商详情页工作台

一个由四个技能驱动的 15 屏电商详情页生产系统：

1. `image-research`：多角度产品图与八维视觉研究。
2. `detail-page-planning`：证据优先的 15 屏 9:16 策划。
3. `detail-page-execution`：A / B / D / E 四类执行交付与独立生图。
4. `detail-page-qa`：只读质检、问题定位与报告导出。

旧版策划、模板兜底、主图和提示词全量拼接链路已移除。应用仅沿用两套 API 配置：

- 文案/视觉理解模型：优先使用浏览器已验证配置，否则使用服务端环境变量
- 独立生图模型：浏览器持久化键 `image-provider-config`

## 文案模型预设

预设供应商为 OpenAI / 火山方舟 Ark / Anthropic Claude / 智谱 GLM / 自定义。
DeepSeek、Moonshot 已下架：图研阶段强制要求图片理解能力，这两家不满足。

自定义 Endpoint 安全策略：文本与生图模型的自定义 Endpoint 均要求可公开访问的
HTTPS 地址，私网地址和 localhost 会被服务端拒绝（防 SSRF）。

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

## 图研修复机制

图研结果结构不合格时不写入兜底数据，而是走定点修复：

- 字段级问题反馈：按 `[错误码] 字段路径：说明` 列出全部命中问题回传模型；
- 纯文本定点修复：问题均为字段级语义问题时，修复轮不再重传图片；
- 两轮不收敛提前终止：连续两轮停留在同一组问题上立即失败
  （`RESEARCH_REPAIR_NOT_CONVERGING`），避免重复计费。

## 启动

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

应用直接从 `/` 进入工作台，`/workspace` 会重定向到根路径。

## 安全注意事项

- 浏览器中配置的 API Key 保存在 localStorage（`ai-provider-config`、
  `image-provider-config`），并随请求体经 HTTPS 转发到本应用服务端。
- API 路由本身没有鉴权。公网部署前必须自行加访问控制（如反向代理鉴权），
  否则任何人都可能消耗服务端配置的模型额度。
- 服务端环境变量中的密钥只在服务端使用，不会下发到浏览器。
