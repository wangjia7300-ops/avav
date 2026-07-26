import type {
  DetailPageProject,
  SupplementalBrief
} from "@/lib/types";

export const EMPTY_BRIEF: SupplementalBrief = {
  priceRange: "",
  platform: "",
  promotionMoment: "",
  competitorDifference: "",
  geoGoal: "",
  brandAssets: "",
  productProofs: "",
  targetAudience: "",
  tone: "",
  notes: ""
};

export function createEmptyProject(): DetailPageProject {
  const timestamp = new Date().toISOString();

  return {
    id: `project-${Date.now()}`,
    name: "未命名详情页项目",
    assets: [],
    brief: { ...EMPTY_BRIEF },
    research: null,
    plan: null,
    executions: {},
    qa: null,
    updatedAt: timestamp
  };
}
