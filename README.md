# AI电商视觉策划助手

一个基于 Next.js App Router 的网页应用 MVP。用户上传一张或多张产品图片后，系统可用 mock 数据跑通完整流程，也可以通过页面配置或服务端环境变量接入真实 AI 模型，完成产品识别、视觉风格体系、市场卖点洞察、主图/详情页策划和 GPT 图像提示词生成。

## 技术栈

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui 风格本地组件
- React
- Zustand
- API Routes
- Mock 数据服务层

## 安装依赖

```bash
npm install
```

## 本地启动

```bash
npm run dev
```

默认访问：

```text
http://localhost:3000
```

## 类型检查

```bash
npm run typecheck
```

## 构建

```bash
npm run build
```

## 页面

- `/`：品牌官网首页。
- `/workspace`：工作台，包含多图上传、手动产品信息、分析进度、结果 Tabs、复制提示词和 Markdown 导出。
- `/brand-guidelines`：品牌视觉识别规范页。
- `/brand-showcase`：品牌应用与设计系统展示页。

## 项目结构

```text
app/
  page.tsx
  workspace/page.tsx
  api/
    analyze-product/route.ts
    research-product/route.ts
    generate-visual-style/route.ts
    generate-design-plan/route.ts
    generate-prompts/route.ts

components/
  AppHeader.tsx
  upload/
    ProductUploader.tsx
  workspace/
    StepSidebar.tsx
    ProductPreview.tsx
    AnalysisProgress.tsx
    ResultTabs.tsx
    ProductAnalysisPanel.tsx
    MarketInsightPanel.tsx
    DesignPlanPanel.tsx
    PromptPanel.tsx
  ui/
    badge.tsx
    button.tsx
    card.tsx
    empty-state.tsx
    progress.tsx

lib/
  mock-data.ts
  types.ts
  markdown-export.ts
  prompt-templates.ts
  store.ts
  utils.ts
  services/
    openai-client.ts
    analyze-product-image.ts
    generate-design-plan.ts
    generate-prompts.ts
    generate-visual-style-system.ts
    product-search.ts
    mock-data.ts
    schemas/
      product-analysis-schema.ts
```

## 第一版已完成功能

- 上传一张或多张产品图，支持 JPG、PNG、WEBP。
- 拖拽上传、图片预览和手动产品信息补充。
- 调用 `/api/analyze-product` 返回结构化产品识别结果。
- 调用 `/api/generate-visual-style` 生成产品专属电商视觉风格体系。
- 调用 `/api/research-product` 返回市场卖点、用户痛点、标题风格、视觉风格和搜索来源说明。
- 调用 `/api/generate-design-plan` 生成 5 张场景化主图方案，以及固定 14 屏详情页方案。
- 调用 `/api/generate-prompts` 为每张图生成 GPT 图像提示词和负面词。
- 支持单条提示词复制和主图/详情页整组提示词复制。
- 支持导出 Markdown 策划方案。
- 包含空状态、loading 状态、error 状态和分析进度条。

## 环境变量预留

复制 `.env.example` 为 `.env.local`：

```bash
OPENAI_API_KEY=
SERPAPI_API_KEY=
FIRECRAWL_API_KEY=
NEXT_PUBLIC_USE_MOCK=true
```

`NEXT_PUBLIC_USE_MOCK=true` 时默认使用 mock 数据；如果页面里配置了 AI 供应商，也会优先调用页面配置的真实模型。设置为 `false` 后，产品识别、视觉风格体系、视觉方案和提示词生成会通过服务端 API Route 调用真实模型。不要创建 `NEXT_PUBLIC_OPENAI_API_KEY`。

市场洞察支持真实联网搜索：

- 服务端方式：在 `.env.local` 填写 `SERPAPI_API_KEY` 或 `FIRECRAWL_API_KEY`，重启 dev server。
- 页面方式：在工作台的「API 接口接入」里填写「联网搜索配置」，保存后直接重新分析。
- 有搜索 Key 时，`/api/research-product` 会先搜索同类产品信息，再结合产品识别结果交给模型生成结构化市场洞察。
- 没有搜索 Key 时，不会假装联网，结果会在 `sourceNote` 中说明未使用真实搜索。

## 真实 API 接入

服务端入口：

```text
app/api/analyze-product/route.ts
app/api/research-product/route.ts
app/api/generate-visual-style/route.ts
app/api/generate-design-plan/route.ts
app/api/generate-prompts/route.ts
```

服务层入口：

```text
lib/services/openai-client.ts
lib/services/analyze-product-image.ts
lib/services/generate-visual-style-system.ts
lib/services/product-search.ts
lib/services/generate-design-plan.ts
lib/services/generate-prompts.ts
lib/services/schemas/product-analysis-schema.ts
```

所有 API Route 统一返回：

```ts
{ success: true, data: ... }
{ success: false, error: "错误说明" }
```

已处理错误：

- 未配置 `OPENAI_API_KEY`
- 图片超过大小限制
- OpenAI / 自定义模型请求失败
- 搜索 API 未配置、搜索无结果或搜索接口失败
- AI 返回空内容、非 JSON 或字段结构不匹配
- 前端 fetch 失败

产品识别固定 JSON：

```json
{
  "category": "string",
  "productNameGuess": "string",
  "appearance": ["string"],
  "visibleFeatures": ["string"],
  "materials": ["string"],
  "colors": ["string"],
  "styleKeywords": ["string"],
  "risks": ["string"]
}
```

## 后续接入更多 OpenAI API

- `analyzeProductImage()`：已接入 OpenAI Responses API，可继续调整模型和识别提示词。
- `generateVisualStyleSystem()`：基于产品识别、用户补充信息和联网摘要反推视觉风格体系。
- `generateDesignPlan()`：把产品识别、视觉风格体系与市场洞察传给大模型，生成主图和详情页策划。
- `generateImagePrompts()`：生成 GPT 图像提示词和负面词。

建议替换步骤：

1. 在 API Route 中接收真实上传文件或对象存储 URL。
2. 在 `analyzeProductImage()` 中调用 OpenAI Vision / multimodal API。
3. 保持返回结构不变，前端无需改动。

## 联网搜索工作流

`researchProductOnline()` 会执行以下步骤：

1. 根据产品识别结果和用户手动信息生成搜索词。
2. 使用 SerpAPI 或 Firecrawl 获取真实搜索标题、摘要和链接。
3. 将搜索摘要、产品识别结果、用户补充信息一起交给模型。
4. 输出固定 `MarketResearch` JSON。

建议保留 mock 作为 fallback，便于开发和演示。
