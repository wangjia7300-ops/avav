import { describe, expect, it } from "vitest";
import type { DetailScreen, ScreenCopy } from "@/lib/types";
import {
  buildCopyQualityRepairPrompt,
  checkCopyQuality
} from "@/lib/skill-suite/copy-quality";

function makeScreen(
  id: string,
  index: number,
  copy: Partial<ScreenCopy> = {}
): DetailScreen {
  return {
    id,
    index,
    subjectKey: `test:${id}`,
    userQuestion: "这项信息对用户有什么用？",
    role: "测试屏",
    conversionTask: "测试文案质量",
    primarySellingPoint: "白色浮雕纹理",
    claimScope: "appearance",
    evidenceIds: ["fact-01"],
    proofMethod: "甲方图片可见",
    copy: {
      headline: "一日三餐更有温度",
      subheadline: "白色浮雕，为餐桌添一点温柔",
      body: "日常盛饭盛汤，侧光下的浮雕纹理也看得清。",
      keyPoints: ["白色碗身", "浮雕纹理"],
      ...copy
    },
    scene: "家庭餐桌",
    shot: "中景",
    composition: "9:16竖版",
    transition: "自然过渡"
  };
}

describe("deterministic copy quality", () => {
  it("reports hard copy limits with JSON-style paths", () => {
    const screen = makeScreen("screen-01", 1, {
      headline: "这是一个明显超过十个字的移动端主标题",
      subheadline: "这是一个明显超过二十个字并且信息层级非常混乱的副标题文案",
      body: [
        "第一行把产品事实和使用场景全部说清楚。",
        "第二行继续补充很多说明。",
        "第三行还是继续补充说明。",
        "第四行已经明显超过移动端限制。"
      ].join("\n")
    });
    const report = checkCopyQuality([screen]);

    expect(report.hasErrors).toBe(true);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "headline_too_long",
          path: "screens[0].copy.headline"
        }),
        expect.objectContaining({
          code: "subheadline_too_long",
          path: "screens[0].copy.subheadline"
        }),
        expect.objectContaining({
          code: "body_too_long",
          path: "screens[0].copy.body"
        }),
        expect.objectContaining({
          code: "body_too_many_lines",
          path: "screens[0].copy.body"
        }),
        expect.objectContaining({
          code: "body_too_many_sentences",
          path: "screens[0].copy.body"
        })
      ])
    );
  });

  it("finds advertising, manual and stereotype language without rewriting facts", () => {
    const original = makeScreen("screen-01", 1, {
      headline: "适配多样需求",
      subheadline: "兼顾质感与实用",
      body: "全职主妇使用更省心，本产品采用优质陶土材质打造。",
      keyPoints: ["彰显品质", "独居白领首选"]
    });
    const snapshot = JSON.stringify(original);
    const report = checkCopyQuality([original]);

    expect(report.issues.some((issue) => issue.code === "advertising_tone")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "manual_tone")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "stereotype_label")).toBe(true);
    expect(report.issues.every((issue) => issue.preserveClientFacts)).toBe(true);
    expect(report.repairPrompt).toContain("甲方图片中的事实、参数、材质、功能");
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("rejects internal workflow language from customer-facing copy", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "产品卖点总览",
        subheadline: "甲方图片可见规格",
        body: "本屏引用fact-01，属于可商业使用的候选事实。",
        keyPoints: ["证据已授权"]
      })
    ]);

    expect(
      report.issues.some((issue) => issue.code === "internal_process_tone")
    ).toBe(true);
    expect(
      report.issues.find((issue) => issue.code === "internal_process_tone")
    ).toMatchObject({
      severity: "error"
    });
  });

  it("requires the headline to answer why the user should care", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "高温淬烧陶土",
        subheadline: "优质陶土，高温淬烧",
        body: "碗身使用甲方图片标注的陶土材质。",
        keyPoints: ["陶土材质"]
      })
    ]);

    expect(
      report.issues.find(
        (issue) => issue.code === "headline_not_user_facing"
      )
    ).toMatchObject({
      path: "screens[0].copy.headline",
      severity: "error"
    });
  });

  it("accepts natural purchase and cleaning outcomes outside the old whitelist", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "配齐不用额外买",
        subheadline: "拖把、桶和两块拖布",
        body: "到手先核对清单，日常清洁要用的配件一眼看清。",
        keyPoints: ["拖把×1", "桶×1", "拖布×2"]
      }),
      makeScreen("screen-02", 2, {
        headline: "水渍一擦全吸干",
        subheadline: "加厚纤维布，超强吸水",
        body: "拖地遇到水渍时，纤维拖布能把水分吸走。",
        keyPoints: ["加厚纤维布", "超强吸水"]
      })
    ]);

    expect(
      report.issues.filter(
        (issue) => issue.code === "headline_not_user_facing"
      )
    ).toEqual([]);
  });

  it("keeps explicit technical headlines as errors but treats unknown natural phrasing as a warning", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "分件用材更耐用"
      }),
      makeScreen("screen-02", 2, {
        headline: "甜蜜小豹击"
      })
    ]);
    const headlineIssues = report.issues.filter(
      (issue) => issue.code === "headline_not_user_facing"
    );

    expect(headlineIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          screenId: "screen-01",
          severity: "error"
        }),
        expect.objectContaining({
          screenId: "screen-02",
          severity: "warning"
        })
      ])
    );
  });

  it("separates headline, subheadline and body instead of repeating one sentence", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "饭后好洗不费劲",
        subheadline: "饭后好洗不费劲",
        body: "饭后好洗不费劲，日常清洁更省心。",
        keyPoints: ["釉面光洁易清洗"]
      })
    ]);

    expect(
      report.issues.find((issue) => issue.code === "field_role_overlap")
    ).toMatchObject({
      path: "screens[0].copy",
      severity: "error"
    });
  });

  it("finds visibly incomplete body copy", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "大小先看清",
        subheadline: "直径115mm，高60mm",
        body: "盛饭盛汤前，先把尺寸看清，同时",
        keyPoints: ["直径115mm", "高60mm"]
      })
    ]);

    expect(
      report.issues.find((issue) => issue.code === "sentence_fragment")
    ).toMatchObject({
      path: "screens[0].copy.body",
      severity: "error"
    });
  });

  it("does not mistake 核对 for a dangling connector", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "品牌先核对",
        subheadline: "中英文标识都在正面",
        body: "拿到手时看看正面，中英文品牌也方便核对。",
        keyPoints: ["正面品牌标识"]
      })
    ]);

    expect(
      report.issues.some((issue) => issue.code === "sentence_fragment")
    ).toBe(false);
  });

  it("recognizes a clear selection conclusion as user-facing", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "年级先选对",
        subheadline: "1—3年级可选",
        body: "给低年级孩子选书包时，先对照图片标注的年级。",
        keyPoints: ["1—3年级"]
      })
    ]);

    expect(
      report.issues.some((issue) => issue.code === "headline_not_user_facing")
    ).toBe(false);
  });

  it("checks first-screen and closing-screen warmth", () => {
    const opening = makeScreen("screen-01", 1, {
      headline: "白色浮雕陶瓷碗",
      subheadline: "陶土材质与浮雕结构",
      body: "甲方图片可见白色碗身。",
      keyPoints: ["白色碗身"]
    });
    const closing = makeScreen("screen-02", 2, {
      headline: "核心卖点汇总",
      subheadline: "材质外观规格一览",
      body: "白色碗身，浮雕纹理，直径115毫米。",
      keyPoints: ["白色碗身", "浮雕纹理", "直径115毫米"]
    });
    const report = checkCopyQuality([opening, closing]);

    expect(
      report.issues.some((issue) => issue.code === "first_screen_lacks_warmth")
    ).toBe(true);
    expect(
      report.issues.some((issue) => issue.code === "final_screen_lacks_warmth")
    ).toBe(true);
  });

  it("flags screens that are hard to restate as one sentence", () => {
    const screen = makeScreen("screen-01", 1, {
      headline: "兼顾颜值实用与多样场景",
      subheadline: "一屏说完全部优势",
      body: "既有浮雕纹理，又好打理，还能满足多样需求。",
      keyPoints: ["外观", "清洁", "稳放", "尺寸"]
    });
    const report = checkCopyQuality([screen]);

    expect(
      report.issues.find((issue) => issue.code === "hard_to_restate")
    ).toMatchObject({
      path: "screens[0].copy",
      severity: "warning"
    });
  });

  it("accepts concise, warm and conversational copy", () => {
    const screens = [
      makeScreen("screen-01", 1),
      makeScreen("screen-02", 2, {
        headline: "浮雕纹理看得见",
        subheadline: "白色碗身，细节清楚",
        body: "侧光扫过碗身，浮雕纹理更清楚。",
        keyPoints: ["白色碗身", "浮雕纹理"]
      }),
      makeScreen("screen-03", 3, {
        headline: "好好吃饭",
        subheadline: "让每一餐都多一点温柔",
        body: "盛饭，盛汤，陪你过好一日三餐。",
        keyPoints: ["饭汤场景", "温暖收尾"]
      })
    ];
    const report = checkCopyQuality(screens);

    expect(report.issues).toEqual([]);
    expect(report.hasErrors).toBe(false);
    expect(report.repairPrompt).toContain("未发现需要修复的问题");
  });

  it("accepts distinct user-first title, factual subtitle and natural body", () => {
    const screens = [
      makeScreen("screen-01", 1),
      makeScreen("screen-02", 2, {
        headline: "饭后好洗不费劲",
        subheadline: "光滑釉面，日常好打理",
        body: "吃完饭轻轻清洗，碗里碗外都好打理。",
        keyPoints: ["光滑釉面", "易清洗"]
      }),
      makeScreen("screen-03", 3, {
        headline: "好好吃饭",
        subheadline: "让每一餐都多一点温柔",
        body: "盛饭，盛汤，陪你过好一日三餐。",
        keyPoints: ["饭汤场景", "温暖收尾"]
      })
    ];

    expect(checkCopyQuality(screens).issues).toEqual([]);
  });

  it("builds a model-ready repair prompt with exact issue paths", () => {
    const report = checkCopyQuality([
      makeScreen("screen-01", 1, {
        headline: "这是一个超过十个字的主标题"
      })
    ]);
    const prompt = buildCopyQualityRepairPrompt(report.issues);

    expect(prompt).toContain("screens[0].copy.headline");
    expect(prompt).toContain("不得修改未列出的字段");
    expect(prompt).toContain("不得新增百分比、认证、材质、规格、功效");
  });
});
