import { beforeEach, describe, expect, it } from "vitest";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";
import type { ProjectAsset } from "@/lib/types";

// 模块加载时（任何 beforeEach 执行之前）记录初始代际号。
const epochAtImport = useSkillSuiteStore.getState().runEpoch;

function makeAssets(): ProjectAsset[] {
  return [
    {
      id: "asset-1",
      name: "test-front.png",
      dataUrl: "data:image/png;base64,dGVzdDE=",
      size: 5
    },
    {
      id: "asset-2",
      name: "test-detail.png",
      dataUrl: "data:image/png;base64,dGVzdDI=",
      size: 5
    }
  ];
}

/** 用测试夹具依次填充 research / plan / executions / qa（这些操作不应改变 runEpoch）。 */
function populateDownstream() {
  const sample = createSampleProject();

  useSkillSuiteStore.getState().setResearch(sample.research!);
  useSkillSuiteStore.getState().setPlan(sample.plan!);
  useSkillSuiteStore.getState().mergeExecutions(Object.values(sample.executions));
  useSkillSuiteStore.getState().setQA(sample.qa);
}

describe("skill-suite store 竞态防护（runEpoch）", () => {
  let baseEpoch: number;

  beforeEach(() => {
    useSkillSuiteStore.getState().resetProject();
    baseEpoch = useSkillSuiteStore.getState().runEpoch;
  });

  it("模块首次加载时初始 runEpoch 为 0", () => {
    expect(epochAtImport).toBe(0);
  });

  it("setAssets 换素材使 runEpoch 递增 1", () => {
    useSkillSuiteStore.getState().setAssets(makeAssets());

    expect(useSkillSuiteStore.getState().runEpoch).toBe(baseEpoch + 1);
  });

  it("updateBrief 改简报使 runEpoch 递增 1", () => {
    useSkillSuiteStore.getState().updateBrief({ notes: "补充测试说明" });

    expect(useSkillSuiteStore.getState().runEpoch).toBe(baseEpoch + 1);
  });

  it("resetProject 新建项目使 runEpoch 递增 1", () => {
    useSkillSuiteStore.getState().resetProject();

    expect(useSkillSuiteStore.getState().runEpoch).toBe(baseEpoch + 1);
  });

  it("连续输入变更逐次累加 runEpoch，在途旧请求可据此被识破", () => {
    useSkillSuiteStore.getState().setAssets(makeAssets());
    useSkillSuiteStore.getState().updateBrief({ tone: "清爽" });
    useSkillSuiteStore.getState().resetProject();

    expect(useSkillSuiteStore.getState().runEpoch).toBe(baseEpoch + 3);
  });

  it("setResearch / setPlan / mergeExecutions / setQA 写入结果不改变 runEpoch", () => {
    populateDownstream();

    const state = useSkillSuiteStore.getState();
    expect(state.runEpoch).toBe(baseEpoch);
    expect(state.project.research).not.toBeNull();
    expect(state.project.plan).not.toBeNull();
    expect(Object.keys(state.project.executions).length).toBeGreaterThan(0);
    expect(state.project.qa).not.toBeNull();
  });

  it("setQA(null) 清除质检结果同样不改变 runEpoch", () => {
    useSkillSuiteStore.getState().setQA(null);

    expect(useSkillSuiteStore.getState().runEpoch).toBe(baseEpoch);
    expect(useSkillSuiteStore.getState().project.qa).toBeNull();
  });

  it("切换参与生图的素材选择只使视觉输入失效，不删除15屏文案结果", () => {
    useSkillSuiteStore.getState().setAssets(makeAssets());
    populateDownstream();
    const epochBefore = useSkillSuiteStore.getState().runEpoch;

    useSkillSuiteStore.getState().invalidateVisualInputs();

    const state = useSkillSuiteStore.getState();
    expect(state.project.research).not.toBeNull();
    expect(state.project.plan).not.toBeNull();
    expect(Object.keys(state.project.executions)).toHaveLength(15);
    expect(state.project.qa).toBeNull();
    expect(state.runEpoch).toBe(epochBefore + 1);
  });

  it("对照：setAssets 才会级联清空下游结果并推进 runEpoch", () => {
    useSkillSuiteStore.getState().setAssets(makeAssets());
    populateDownstream();
    const epochBefore = useSkillSuiteStore.getState().runEpoch;

    useSkillSuiteStore.getState().setAssets(makeAssets());

    const state = useSkillSuiteStore.getState();
    expect(state.project.research).toBeNull();
    expect(state.project.plan).toBeNull();
    expect(state.project.executions).toEqual({});
    expect(state.project.qa).toBeNull();
    expect(state.runEpoch).toBe(epochBefore + 1);
  });
});
