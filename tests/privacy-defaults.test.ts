import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  EMPTY_BRIEF
} from "@/lib/skill-suite/defaults";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";

describe("privacy-safe project defaults", () => {
  it("starts without customer assets or generated business data", () => {
    const project = createEmptyProject();

    expect(project.assets).toEqual([]);
    expect(project.research).toBeNull();
    expect(project.plan).toBeNull();
    expect(project.executions).toEqual({});
    expect(project.qa).toBeNull();
    expect(project.brief).toEqual(EMPTY_BRIEF);
  });

  it("does not embed sample or customer identifiers in the initial project", () => {
    const serialized = JSON.stringify(createEmptyProject()).toLowerCase();

    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("student");
    expect(serialized).not.toContain("backpack");
    expect(serialized).not.toContain("学生书包");
  });

  it("creates a fresh brief object for every project", () => {
    const first = createEmptyProject();
    const second = createEmptyProject();

    first.brief.notes = "仅属于第一个会话";

    expect(second.brief.notes).toBe("");
  });

  it("initializes and resets the real workbench store to an empty research session", () => {
    useSkillSuiteStore.getState().resetProject();
    let state = useSkillSuiteStore.getState();

    expect(state.stage).toBe("research");
    expect(state.project.assets).toEqual([]);
    expect(state.project.research).toBeNull();
    expect(state.project.plan).toBeNull();
    expect(state.project.executions).toEqual({});
    expect(state.project.qa).toBeNull();

    state.setAssets([
      {
        id: "private-asset",
        name: "private-customer-file.jpg",
        dataUrl: "data:image/jpeg;base64,cHJpdmF0ZQ==",
        size: 7
      }
    ]);
    state.updateBrief({ notes: "private customer notes" });
    useSkillSuiteStore.getState().resetProject();
    state = useSkillSuiteStore.getState();

    expect(state.stage).toBe("research");
    expect(state.project.assets).toEqual([]);
    expect(state.project.brief).toEqual(EMPTY_BRIEF);
    expect(JSON.stringify(state.project)).not.toContain("private");
  });
});
