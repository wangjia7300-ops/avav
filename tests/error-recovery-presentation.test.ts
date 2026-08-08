import { describe, expect, it } from "vitest";
import {
  buildErrorRecoveryPresentation,
  summarizeExecutionRecovery
} from "@/lib/workbench/error-presentation";
import type { WorkErrorInfo } from "@/lib/skill-suite/store";

const timeoutError: WorkErrorInfo = {
  message: "火山方舟 Ark 暂时响应较慢。",
  status: 504,
  code: "AI_PROVIDER_TIMEOUT",
  retryable: true,
  details: [],
  conflictScreenIds: [],
  meta: {
    failureOrigin: "sdk_timeout",
    elapsedMs: 240_000,
    attempt: 1,
    maxAttempts: 2
  }
};

describe("workbench error recovery presentation", () => {
  it("图研超时只承诺保留当前页面的上传资料", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: timeoutError,
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation).toMatchObject({
      title: "图研暂未完成",
      recoveryNote:
        "本次图研结果未写入。已上传的产品图和补充说明仍在当前页面。",
      actionLabel: "重试图研",
      costNote: "再次尝试会重新调用模型，可能产生新的调用费用。"
    });
    expect(presentation.technicalItems).toEqual([
      "AI_PROVIDER_TIMEOUT",
      "HTTP 504",
      "SDK 等待预算耗尽",
      "耗时 240 秒",
      "尝试 1/2"
    ]);
    expect(JSON.stringify(presentation)).not.toContain("retryable");
    expect(presentation.recoveryNote).not.toContain("断点");
    expect(presentation.actionLabel).toBe("重试图研");
    expect(presentation.costNote).toBe(
      "再次尝试会重新调用模型，可能产生新的调用费用。"
    );
  });

  it("图研已有部分批次 checkpoint 时明确只续跑剩余批次与最终汇总", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        meta: {
          ...timeoutError.meta,
          completedBatches: 1,
          totalBatches: 3
        }
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.recoveryNote).toContain("图研断点已保留");
    expect(presentation.recoveryNote).toContain("已完成 1/3 批");
    expect(presentation.recoveryNote).toContain(
      "只续跑剩余 2 批和最终汇总"
    );
    expect(presentation.recoveryNote).toContain("不会重做已完成批次");
    expect(presentation.actionLabel).toBe("从断点续跑图研");
    expect(presentation.costNote).toBe(
      "已完成批次不会重复调用或重复计费；未完成批次和最终汇总仍可能产生新的调用费用。"
    );
  });

  it("策划修复超时且带有草稿时提示继续修复剩余屏", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "planning",
      error: {
        ...timeoutError,
        phase: "planning-repair-provider",
        conflictScreenIds: ["screen-07", "screen-10", "screen-15"],
        meta: {
          ...timeoutError.meta,
          phase: "planning-repair-provider",
          acceptedRepairScreenIds: ["screen-02", "screen-03", "screen-05"]
        },
        partialData: {
          publishable: false,
          plan: {
            screens: Array.from({ length: 15 }, (_, index) => ({
              id: `screen-${String(index + 1).padStart(2, "0")}`
            }))
          }
        }
      },
      hasResearch: true,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.title).toBe("15屏策划续修暂未完成");
    expect(presentation.recoveryNote).toContain("已验证的局部修复草稿已保留");
    expect(presentation.recoveryNote).toContain("继续修复剩余 3 屏");
    expect(presentation.actionLabel).toBe("继续修复剩余屏");
    expect(presentation.costNote).toBe(
      "已通过校验的修复屏不会重复调用；剩余冲突屏仍可能产生新的调用费用。"
    );
  });

  it("策划超时但尚无草稿时提示重试策划生成且不暗示资料丢失", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "planning",
      error: timeoutError,
      hasResearch: true,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.title).toBe("15屏策划暂未完成");
    expect(presentation.actionLabel).toBe("重试策划生成");
    expect(presentation.recoveryNote).toContain(
      "图研和已填写的策划信息仍在当前页面"
    );
    expect(presentation.recoveryNote).toContain("成功前不会覆盖正式结果");
    expect(presentation.recoveryNote).not.toContain(
      "生成一套新的完整策划"
    );
  });

  it("图研全部小批已完成但汇总失败时只重试零图片汇总", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        meta: {
          ...timeoutError.meta,
          completedBatches: 3,
          totalBatches: 3
        }
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.recoveryNote).toContain("图研断点已保留");
    expect(presentation.recoveryNote).toContain("已完成 3/3 批");
    expect(presentation.recoveryNote).toContain("只重试最终汇总");
    expect(presentation.recoveryNote).not.toContain("续跑剩余");
    expect(presentation.actionLabel).toBe("继续图研汇总");
    expect(presentation.costNote).toBe(
      "已完成批次不会重复调用或重复计费；本次只会重新调用最终汇总。"
    );
  });

  it("旧状态中的 retryable 控制字段也不会重新出现在校验明细", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        details: ["retryable：true", "attempt：1", "maxAttempts：2"]
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.validationDetails).toEqual([]);
    expect(JSON.stringify(presentation)).not.toContain("retryable：true");
  });

  it("上游诊断使用中性供应商文案且不展示非法次数", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        meta: {
          failureOrigin: "upstream_http",
          upstreamStatus: 504,
          attempt: 0,
          maxAttempts: 2
        }
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.technicalItems).toContain(
      "模型供应商上游返回 HTTP 504"
    );
    expect(presentation.technicalItems.join("\n")).not.toContain("Ark");
    expect(presentation.technicalItems.join("\n")).not.toContain("尝试 0/2");
  });

  it("等待预算到期前的连接超时显示为供应商连接提前中断", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        meta: {
          failureOrigin: "connection_timeout",
          elapsedMs: 52_000,
          attempt: 1,
          maxAttempts: 1
        }
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.technicalItems).toContain(
      "模型供应商连接在等待预算到期前中断"
    );
    expect(presentation.technicalItems).not.toContain("SDK 等待预算耗尽");
  });

  it("流内错误事件不会伪装成上游 HTTP 502", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        status: 502,
        code: "AI_PROVIDER_STREAM_FAILED",
        meta: {
          failureOrigin: "stream_event",
          attempt: 1,
          maxAttempts: 1
        }
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.technicalItems).toContain(
      "模型供应商在响应流中返回错误事件"
    );
    expect(presentation.technicalItems.join("\n")).not.toContain(
      "上游返回 HTTP 502"
    );
  });

  it("未分类异常与不一致次数不被误导性展示", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "research",
      error: {
        ...timeoutError,
        meta: {
          failureOrigin: "unknown",
          attempt: 3,
          maxAttempts: 2,
          upstreamStatus: 200
        }
      },
      hasResearch: false,
      hasPlan: false,
      hasQA: false,
      completedExecutions: 0,
      totalExecutions: 15
    });

    expect(presentation.technicalItems).toContain(
      "模型供应商异常来源未分类"
    );
    expect(presentation.technicalItems.join("\n")).not.toContain("尝试");
    expect(presentation.technicalItems.join("\n")).not.toContain("HTTP 200");
  });

  it("执行错误只显示当前真正可续跑的页面数", () => {
    const presentation = buildErrorRecoveryPresentation({
      stage: "execution",
      error: timeoutError,
      hasResearch: true,
      hasPlan: true,
      hasQA: false,
      completedExecutions: 5,
      totalExecutions: 15,
      runnableExecutions: 6
    });

    expect(presentation.title).toBe("执行生成在部分页面中断");
    expect(presentation.recoveryNote).toContain("已完成 5/15 屏");
    expect(presentation.recoveryNote).toContain("4 屏正在运行或已阻断");
    expect(presentation.actionLabel).toBe("续跑可恢复 6 屏");
  });

  it("执行批次结束后只有每屏都是当前结果才能判定全部完成", () => {
    const incomplete = summarizeExecutionRecovery({
      screenIds: ["screen-01", "screen-02", "screen-03"],
      currentExecutionIds: ["screen-01"],
      runnableExecutionIds: ["screen-02"]
    });
    expect(incomplete).toEqual({
      total: 3,
      completed: 1,
      runnable: 1,
      unresolved: 1,
      complete: false
    });

    const complete = summarizeExecutionRecovery({
      screenIds: ["screen-01", "screen-02", "screen-03"],
      currentExecutionIds: ["screen-01", "screen-02", "screen-03"],
      runnableExecutionIds: []
    });
    expect(complete.complete).toBe(true);
  });

  it("质检恢复按钮如实表达为规范质检", () => {
    const firstRun = buildErrorRecoveryPresentation({
      stage: "qa",
      error: timeoutError,
      hasResearch: true,
      hasPlan: true,
      hasQA: false,
      completedExecutions: 15,
      totalExecutions: 15
    });
    expect(firstRun.actionLabel).toBe("重试规范质检");

    const rerun = buildErrorRecoveryPresentation({
      stage: "qa",
      error: timeoutError,
      hasResearch: true,
      hasPlan: true,
      hasQA: true,
      completedExecutions: 15,
      totalExecutions: 15
    });
    expect(rerun.actionLabel).toBe("重新运行规范质检");
  });
});
