export const RESEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "productName",
    "category",
    "brand",
    "summary",
    "facts",
    "visualAudit",
    "visualKeywords",
    "risks",
    "source",
    "generatedAt"
  ],
  properties: {
    productName: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    brand: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    facts: {
      type: "array",
      minItems: 6,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "value",
          "evidence",
          "sourceAssetIds",
          "sourceType",
          "claimScope",
          "entityType",
          "ocrConfidence",
          "status",
          "commercialUse"
        ],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          value: { type: "string", minLength: 1 },
          evidence: { type: "string", minLength: 1 },
          sourceAssetIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 }
          },
          sourceType: {
            type: "string",
            enum: [
              "visual_observation",
              "image_text",
              "user_input",
              "model_inference"
            ]
          },
          claimScope: {
            type: "string",
            enum: [
              "appearance",
              "visible_text",
              "specification",
              "material",
              "performance",
              "mechanism",
              "service",
              "promotion"
            ],
            description:
              "单条原子事实的唯一声明范围。材质、性能、机制等不同语义必须拆成不同事实，不得把“超细纤维、吸水、省力、双驱旋转”等跨范围内容合并在一条事实中。"
          },
          entityType: {
            type: "string",
            enum: [
              "product",
              "brand",
              "decorative_badge",
              "specification",
              "feature",
              "material",
              "other"
            ]
          },
          ocrConfidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "图片文字或数值的识别置信度。低于0.85的 image_text 事实必须标为 blocked 且 commercialUse=false，等待人工复核。"
          },
          status: {
            type: "string",
            enum: ["verified", "candidate", "blocked"],
            description:
              "当前兼容状态只有 verified、candidate、blocked；需要人工复核的低置信度或数值冲突事实使用 blocked 表达。"
          },
          commercialUse: {
            type: "boolean",
            description:
              "仅有直接图片文字、可见事实或用户原文支撑且无冲突时才可为 true。model_inference、低OCR置信度及数值冲突事实必须为 false。"
          }
        }
      }
    },
    visualAudit: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "finding", "recommendation"],
        properties: {
          key: {
            type: "string",
            enum: [
              "composition",
              "sellingHierarchy",
              "color",
              "typography",
              "visualPath",
              "material",
              "algorithmFit",
              "emotion"
            ]
          },
          title: { type: "string", minLength: 1 },
          finding: { type: "string", minLength: 1 },
          recommendation: { type: "string", minLength: 1 }
        }
      }
    },
    visualKeywords: {
      type: "array",
      minItems: 3,
      items: { type: "string", minLength: 1 }
    },
    risks: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    source: { type: "string", enum: ["model"] },
    generatedAt: { type: "string", minLength: 1 }
  }
};
