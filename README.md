# 电商详情页工作台

一个由四个生产阶段驱动的 15 屏电商详情页生产系统：

1. `image-research`：多角度产品图与八维视觉研究。
2. `detail-page-planning`：证据优先的 15 屏 9:16 策划。
3. `detail-page-execution`：A / B / D / E 四类执行交付与独立生图。
4. `detail-page-qa`：只读质检、问题定位与报告导出。

流程只有这一条正式路径：参考图先按最多3张一批提取可见事实，全部批次完成后做
零图片汇总；策划固定产出15屏；执行按5屏一批断点续跑；质检只读取当前有效结果。
阶段顺序、完成判定和续跑选择统一由 `lib/skill-suite/workflow.ts` 管理。

策划与执行阶段内部再调用两个专用能力，不增加前台步骤：

- `ecommerce-copy-compiler`：把每屏甲方事实编译成用户结论、事实解释和生活说明。
- `jimeng-prompt-translator`：把锁定文案与视觉规格单次编译成即梦中文生图指令。

旧版策划、模板兜底、主图和提示词全量拼接链路已移除。应用仅沿用两套 API 配置：

- 文案/视觉理解模型：优先使用浏览器已验证配置，否则使用服务端环境变量
- 独立生图模型：浏览器元数据键 `image-provider-config`（不含 API Key）

## 文案模型预设

预设供应商为 OpenAI / 火山方舟 Ark / Google Gemini / Anthropic Claude / 智谱 GLM / 自定义。
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

## Google Gemini

应用按 [Gemini API 官方快速入门](https://ai.google.dev/gemini-api/docs/get-started?hl=zh-cn)
使用 Google 官方稳定的 `generateContent` API，不经过 OpenAI 兼容转译层。
该接入支持文本、产品图片理解与 JSON Schema 结构化输出。

先在 [Google AI Studio](https://aistudio.google.com/app/apikey) 创建 API Key，然后可以
在右上角“文案模型”中选择 Google Gemini 并粘贴 Key，或复制
`.env.example` 为 `.env.local` 后配置服务端默认值：

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-flash-latest
```

浏览器输入的 Gemini API Key 同样只在当前页面内存中使用，不会持久化。

## 15屏执行与生图

- 执行交付按 5 屏一批运行；失败时只标记当前批次，其余未开始屏仍可在本次页面内续跑。
- 已成功屏不会因后续批次失败被覆盖；取消、失败和失效屏可以单独重试。
- 生图必须携带用户当前选择的产品参考图；应用不再要求用户维护产品/细节/场景分类。
- Ark 原生请求 `1440×2560`；OpenAI 与兼容 Images API 使用 `1024×1536`
  竖图源画布，并在中心安全区约束后由服务端裁成严格 `864×1536`。
- 生图结果会经过完整解码、尺寸/像素/多帧门禁和无元数据 WebP 重编码后再展示。
- 同一次生图重试会复用请求号；单进程内最近 16 个完成结果保留 10 分钟，可回放
  已完成响应，降低网络结果不明确时重复扣费的风险。

## 质检边界

当前质检状态 `prompt_complete` 表示“15屏提示词规范质检完成”，不表示真实成图已经
通过 OCR、主体一致性和像素可读性验收。界面与导出报告会把成图/像素未评估项列为
`not_evaluated`，因此在完成真实成图复核前，交付决策最多为 `review_required`。

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

- 浏览器中配置的 API Key 仅保存在当前页面内存，并随本机同源请求发送到
  应用服务端，再由服务端通过 HTTPS 转发给模型供应商；刷新或关闭页面后
  需要重新输入。
- `ai-provider-config` 与 `image-provider-config` 在 localStorage 中只保留
  供应商、模型和 Endpoint 等非敏感元数据。旧版完整 Key 会在首次读取时
  清除持久化副本，并仅供当前页面继续使用。
- 本机 API 已限制 localhost Host、同源 Origin、JSON 类型和请求体大小，但这不等于
  公网用户鉴权。公网部署前仍须增加登录、租户隔离和反向代理访问控制。
- 服务端环境变量中的密钥只在服务端使用，不会下发到浏览器。
- 上传图片不会持久化；发送给模型前会核对真实格式、限制尺寸与像素、移除 EXIF/GPS
  等元数据并重新编码。修改素材选择或分类会使旧成图与质检结果失效。
