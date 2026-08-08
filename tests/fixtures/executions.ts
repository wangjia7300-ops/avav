import type { DetailScreen, ScreenExecution } from "@/lib/types";
import { compileScreenImagePrompt } from "@/lib/skill-suite/jimeng-prompt-translator";
import { facts } from "./facts";

const now = "2026-07-24T08:00:00.000Z";

export function buildExecution(screen: DetailScreen): ScreenExecution {
  const draft: Omit<ScreenExecution, "englishPrompt"> = {
    screenId: screen.id,
    copyFinal: screen.copy,
    visualInstruction:
      "采用真实商业摄影质感和柔和定向光，围绕本屏的单一购买任务组织画面。" +
      "严格保持参考图中的原始产品配色与主体结构，为标题、副标题、正文和要点" +
      "预留清晰层级与安全区，文字不得遮挡产品。",
    visualPrompt:
      "9:16竖版电商详情页，严格保持参考图产品的主体结构、部件位置和原始外观。" +
      "采用本屏既定场景与机位，使用干净商业光线和真实材质，只表达一个画面任务，" +
      "并为中文标题、副标题、正文和要点预留清楚层级。",
    negativePrompt:
      "不改变包体结构、拉链数量、肩带和配色，不新增口袋、认证、额外卖点或水印",
    geo: {
      query: `这款收纳包的${screen.primarySellingPoint}有什么可见特点？`,
      answer: `从图片可确认：${
        screen.evidenceIds
          .map((id) => facts.find((fact) => fact.id === id)?.value)
          .filter(Boolean)
          .join("、") || "本屏暂无可用于商业表达的参数证据"
      }。`,
      entities: ["收纳包", "测试收纳包", screen.primarySellingPoint]
    },
    productionReference: {
      information: `标题 → ${screen.primarySellingPoint} → 证据/说明`,
      wireframe: "顶部标题区 / 中部产品视觉 / 下部证据或要点区",
      typography: "H1 46px/700；H2 24px/600；正文16px/1.6；对比度≥4.5:1",
      sceneDirection: `${screen.scene}；${screen.shot}；产品占画面45%–62%。`,
      palette: ["#FAF7F2", "#C66A36", "#6A2E1A", "#333333"],
      darkMode:
        "深灰底配暖白字，产品边缘增加柔和轮廓光，避免纯黑吞噬细节。",
      designNotes:
        "AI辅助生成完整图文画面；定稿文案原样呈现一次；" +
        "出图后复核中文错字、漏字与重复；禁止加入未验证参数。"
    },
    aiLabel: "AI辅助生成",
    source: "sample",
    generatedAt: now
  };

  return {
    ...draft,
    englishPrompt: compileScreenImagePrompt({
      screen,
      execution: draft,
      facts
    })
  };
}
