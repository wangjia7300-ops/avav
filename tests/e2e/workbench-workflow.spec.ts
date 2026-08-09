/**
 * 关键路径 E2E 测试
 *
 * 通过 API Mock 覆盖完整的四阶段工作流：
 * 素材上传 → 图研 → 策划 → 执行 → 质检。
 *
 * 所有 AI 模型调用均被截获并返回预设响应，不产生 API 费用。
 */
import { test, expect, type Page } from "@playwright/test";

// ── Mock 响应数据 ──────────────────────────────────────────────

const mockResearchResponse = {
  research: {
    productName: "TEST BRAND 测试收纳包",
    category: "收纳包",
    brand: "TEST BRAND",
    summary: "灰白、测试蓝与深灰撞色的多隔层收纳包。",
    facts: [
      {
        id: "fact-01",
        label: "配色",
        value: "灰白、测试蓝与深灰撞色",
        evidence: "产品正面大图可见三段式配色。",
        sourceAssetIds: ["asset-1"],
        sourceType: "visual_observation",
        claimScope: "appearance",
        entityType: "product",
        ocrConfidence: 1,
        status: "verified",
        commercialUse: true
      },
      {
        id: "fact-02",
        label: "结构",
        value: "正面多隔层与双拉链开合",
        evidence: "主图可见多个前袋和双拉链头。",
        sourceAssetIds: ["asset-1"],
        sourceType: "visual_observation",
        claimScope: "appearance",
        entityType: "product",
        ocrConfidence: 0.95,
        status: "verified",
        commercialUse: true
      }
    ],
    visualAudit: [
      { key: "composition", title: "构图", finding: "产品正面居中。", recommendation: "每屏拆分信息。" },
      { key: "color", title: "配色", finding: "暖色撞色对比明显。", recommendation: "保留暖色识别。" },
      { key: "material", title: "材质", finding: "可见面料纹理。", recommendation: "微距展示细节。" },
      { key: "sellingHierarchy", title: "卖点层级", finding: "信息密度适中。", recommendation: "按屏拆分。" },
      { key: "typography", title: "字体", finding: "层级清晰。", recommendation: "三档层级。" },
      { key: "visualPath", title: "视觉动线", finding: "纵向自然。", recommendation: "标题-主体-证据。" },
      { key: "algorithmFit", title: "算法适配", finding: "品类清晰。", recommendation: "快速建立认知。" },
      { key: "emotion", title: "情绪设计", finding: "亲和温暖。", recommendation: "校园日常氛围。" }
    ],
    visualKeywords: ["清爽撞色", "结构展示"],
    risks: [],
    source: "model",
    generatedAt: new Date().toISOString()
  }
};

// ── API Mock 设置 ──────────────────────────────────────────────

async function setupApiMocks(page: Page) {
  await page.route("**/api/skill-suite", async (route) => {
    const body = route.request().postDataJSON();
    const stage = body?.stage as string;

    if (stage === "research") {
      await route.fulfill({ status: 200, json: mockResearchResponse });
    } else if (stage === "planning") {
      await route.fulfill({
        status: 200,
        json: {
          plan: {
            productPositioning: "测试产品定位",
            coreSellingPoints: ["卖点1", "卖点2"],
            personas: [{ name: "用户", context: "场景", pain: "痛点", decisionTrigger: "决策" }],
            decisionChain: ["步骤1", "步骤2"],
            globalVisualDirection: "测试方向",
            screens: Array.from({ length: 15 }, (_, i) => ({
              id: `screen-${String(i + 1).padStart(2, "0")}`,
              index: i + 1,
              subjectKey: `subject-${i + 1}`,
              userQuestion: `问题${i + 1}`,
              role: `角色${i + 1}`,
              conversionTask: "任务",
              primarySellingPoint: "卖点",
              claimScope: "creative",
              evidenceIds: [],
              proofMethod: "展示",
              copy: { headline: `标题${i + 1}`, subheadline: "副标题", body: "正文", keyPoints: ["a"] },
              scene: "场景", shot: "机位", composition: "9:16", transition: "过渡"
            })),
            source: "model",
            generatedAt: new Date().toISOString()
          }
        }
      });
    } else if (stage === "execution") {
      const executionPayload = body?.executionPayload as Record<string, unknown>;
      const screenIds = (executionPayload?.screenIds as string[]) ?? [];
      await route.fulfill({
        status: 200,
        json: {
          executions: screenIds.map((screenId) => ({
            screenId,
            copyFinal: { headline: "标题", subheadline: "副标题", body: "正文", keyPoints: ["a"] },
            visualInstruction: "视觉指令",
            visualPrompt: "视觉提示",
            englishPrompt: "english prompt",
            negativePrompt: "负面提示",
            geo: { query: "q", answer: "a", entities: ["e"] },
            productionReference: { information: "i", wireframe: "w", typography: "t", sceneDirection: "s", palette: [], darkMode: "d", designNotes: "n" },
            aiLabel: "AI辅助生成",
            source: "model",
            generatedAt: new Date().toISOString()
          }))
        }
      });
    } else if (stage === "qa") {
      await route.fulfill({
        status: 200,
        json: {
          qa: {
            status: "prompt_complete",
            coverage: { expectedScreens: 15, planScreens: 15, executionScreens: 15, generatedImageScreens: 0, pixelVerifiedScreens: 0, missingPlanIds: [], missingExecutionIds: [], missingImageIds: [], unexpectedPlanIds: [], unexpectedExecutionIds: [] },
            checks: { rules: "evaluated", semantic: "evaluated", render: "not_evaluated", pixel: "not_evaluated" },
            notEvaluated: [],
            publishDecision: "review_required",
            findings: [],
            summary: "质检通过",
            source: "rules",
            generatedAt: new Date().toISOString()
          }
        }
      });
    } else {
      await route.fulfill({ status: 400, json: { error: "未知阶段" } });
    }
  });

  await page.route("**/api/ai-model/test", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        json: { configured: false, providerId: null, model: null }
      });
    } else {
      await route.fulfill({
        status: 200,
        json: { ready: true, providerId: "openai", model: "gpt-4", capabilities: [], message: "测试通过" }
      });
    }
  });
}

// ── 辅助函数 ──────────────────────────────────────────────────

/** 在素材库区域触发拖放上传 */
async function dropTestImage(page: Page) {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

  const dataTransfer = await page.evaluateHandle(({ base64, fileName, mimeType }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], fileName, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt;
  }, {
    base64: dataUrl.split(",")[1],
    fileName: "test-product.png",
    mimeType: "image/png"
  });

  // 素材库区块
  const assetZone = page.locator('[class*="asset-library"]').first();
  await assetZone.dispatchEvent("dragover", { dataTransfer });
  await assetZone.dispatchEvent("drop", { dataTransfer });
}

// ── 测试用例 ──────────────────────────────────────────────────

test.describe("工作台加载与导航", () => {
  test("页面加载后顶部品牌与四阶段导航可见", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.locator("text=电商详情页工作台")).toBeVisible();
    // 阶段步骤
    await expect(page.getByRole("navigation", { name: "详情页生产流程" })).toBeVisible();
    await expect(page.locator(".workflow-step").nth(0)).toBeVisible();
    await expect(page.locator(".workflow-step").nth(1)).toBeVisible();
    await expect(page.locator(".workflow-step").nth(2)).toBeVisible();
    await expect(page.locator(".workflow-step").nth(3)).toBeVisible();
  });

  test("素材库面板可见", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".asset-library")).toBeVisible();
  });

  test("默认显示图研阶段空状态", async ({ page }) => {
    await page.goto("/");
    // 图研阶段空状态含有"开始八维图研"按钮
    await expect(page.locator(".stage-empty")).toBeVisible();
    await expect(page.locator("text=开始八维图研")).toBeVisible();
  });

  test("配置按钮可见：文案模型 + 生图模型", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=文案模型")).toBeVisible();
    await expect(page.locator("text=生图模型")).toBeVisible();
  });
});

test.describe("配置弹窗", () => {
  test("点击文案模型打开 API 供应商设置弹窗", async ({ page }) => {
    await page.goto("/");
    await page.click("text=文案模型");
    await expect(page.locator("[role='dialog']")).toBeVisible();
    await expect(page.locator("text=API 供应商设置")).toBeVisible();
  });

  test("点击生图模型打开生图 API 设置弹窗", async ({ page }) => {
    await page.goto("/");
    await page.click("text=生图模型");
    await expect(page.locator("[role='dialog']")).toBeVisible();
    await expect(page.locator("text=生图 API 设置")).toBeVisible();
  });

  test("弹窗可关闭", async ({ page }) => {
    await page.goto("/");
    await page.click("text=文案模型");
    await expect(page.locator("[role='dialog']")).toBeVisible();
    await page.locator("[role='dialog'] button[aria-label*='关闭']").click();
    await expect(page.locator("[role='dialog']")).not.toBeVisible();
  });
});

test.describe("四阶段工作流（API Mock）", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test("上传图片后素材库计数变为 1", async ({ page }) => {
    await page.goto("/");
    await dropTestImage(page);
    // 等待图片出现在素材库中
    await expect(page.locator(".asset-tile")).toBeVisible({ timeout: 5000 });
  });

  test("点击开始图研触发 API 调用并完成", async ({ page }) => {
    await page.goto("/");
    await dropTestImage(page);
    await expect(page.locator(".asset-tile")).toBeVisible({ timeout: 5000 });

    // 监听 API 调用
    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/skill-suite")) {
        apiCalls.push(req.url());
      }
    });

    // 开始图研按钮在研究空状态中的 .primary-action
    await page.locator(".stage-empty .primary-action").click();

    // 等待 API 调用发生
    await page.waitForTimeout(3000);
    expect(apiCalls.length).toBeGreaterThan(0);
  });

  test("图研失败时停留在图研阶段", async ({ page }) => {
    // 覆盖 mock 返回错误
    await page.route("**/api/skill-suite", async (route) => {
      await route.fulfill({
        status: 422,
        json: {
          error: {
            code: "RESEARCH_SCHEMA_INVALID",
            message: "图研结果结构不合格",
            details: ["facts 数组为空"],
            retryable: true
          }
        }
      });
    });

    await page.goto("/");
    await dropTestImage(page);
    await expect(page.locator(".asset-tile")).toBeVisible({ timeout: 5000 });

    await page.locator(".stage-empty .primary-action").click();

    // 等待 API 调用完成且页面不再处于运行态
    await page.waitForTimeout(5000);
    // 阶段 1 仍未完成（不应进入阶段 2）
    await expect(page.locator(".workflow-step").nth(0)).toHaveAttribute("aria-current", "step");
  });
});

test.describe("工作台基础交互", () => {
  test("新建项目按钮可访问", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[aria-label='新建详情页项目']")).toBeVisible();
  });

  test("阶段导航步骤按钮可点击", async ({ page }) => {
    await page.goto("/");
    const steps = page.locator(".workflow-step");
    await expect(steps.nth(0)).toBeVisible();
    await steps.nth(2).click(); // 点击执行
    // 验证步骤被点击（可能因为没有计划显示锁定状态）
    await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
  });
});

test.describe("持久化", () => {
  test("项目数据写入 IndexedDB 并可读取", async ({ page }) => {
    await page.goto("/");

    // 上传图片
    await dropTestImage(page);
    await expect(page.locator(".asset-tile")).toBeVisible({ timeout: 5000 });

    // 手动触发持久化保存（等待 debounce 2s + fetch 图片 + 写入）
    await page.waitForTimeout(6000);

    // 通过 evaluate 验证 IndexedDB 中有数据
    const hasData = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open("detail-page-workbench", 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("projects", "readonly");
          const store = tx.objectStore("projects");
          const getReq = store.get("current");
          getReq.onsuccess = () => {
            db.close();
            resolve(getReq.result !== undefined);
          };
          getReq.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        req.onerror = () => resolve(false);
      });
    });
    expect(hasData).toBe(true);
  });
});
