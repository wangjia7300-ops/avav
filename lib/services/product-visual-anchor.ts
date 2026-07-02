import type { ProductAnalysis, ProductVisualAnchor } from "@/lib/types";

function compact(items: Array<string | undefined>, limit: number) {
  return Array.from(
    new Set(
      items
        .map((item) => (item ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  ).slice(0, limit);
}

function findProportionSignal(items: string[]) {
  return items.find((item) =>
    /比例|轮廓|高度|宽度|长|短|圆|方|柱|瓶|盒|袋|落地|台式|手持|壁挂|扁平|厚度|大小/.test(item)
  );
}

export function buildProductVisualAnchor(product: ProductAnalysis): ProductVisualAnchor {
  const keyParts = compact(
    [
      ...product.visibleFeatures,
      ...product.appearance,
      ...(product.productDetails ?? [])
    ],
    8
  );
  const mainColor = product.colors[0] || "以参考图主色为准";
  const secondaryColor = product.colors[1];
  const materialLook = compact(product.materials, 3).join("、") || "以参考图材质质感为准";
  const categoryShape = compact(
    [
      product.category,
      product.productNameGuess,
      product.appearance[0],
      product.appearance[1]
    ],
    3
  ).join("，") || "保持参考图产品主体轮廓";
  const proportions = findProportionSignal([...product.appearance, ...(product.productDetails ?? [])]);
  const anchorWeak = !product.colors.length || keyParts.length < 3 || /待识别|参考图|补充/.test(categoryShape);

  return {
    categoryShape,
    mainColor,
    secondaryColor,
    materialLook,
    keyParts,
    proportions,
    mustKeep: compact(
      [
        `品类与主体轮廓：${categoryShape}`,
        `主色：${mainColor}`,
        secondaryColor ? `辅色：${secondaryColor}` : "",
        `材质观感：${materialLook}`,
        ...keyParts.slice(0, 5)
      ],
      9
    ),
    mustAvoid: compact(
      [
        "不要改变产品主体轮廓、比例和品类",
        "不要改变主色、辅色和关键部件位置",
        "不要虚构品牌 logo、型号文字、认证标识或参数文字",
        "不要把产品变成其他品类或其他材质",
        anchorWeak ? "外观锚点不足时降低复杂场景，建议补充正面、侧面、细节图" : ""
      ],
      6
    )
  };
}

export function formatProductVisualAnchor(anchor: ProductVisualAnchor) {
  return [
    `产品外观锚点：${anchor.categoryShape}`,
    `主色${anchor.mainColor}${anchor.secondaryColor ? `，辅色${anchor.secondaryColor}` : ""}`,
    anchor.materialLook ? `材质观感${anchor.materialLook}` : "",
    anchor.proportions ? `比例关系${anchor.proportions}` : "",
    anchor.keyParts.length ? `关键部件${anchor.keyParts.slice(0, 6).join("、")}` : "",
    anchor.mustKeep.length ? `必须保持${anchor.mustKeep.join("；")}` : "",
    anchor.mustAvoid.length ? `必须避免${anchor.mustAvoid.join("；")}` : ""
  ]
    .filter(Boolean)
    .join("；");
}

export function formatCompactProductVisualAnchor(anchor: ProductVisualAnchor) {
  const categoryShape = anchor.categoryShape
    .replace(/^产品外观锚点[:：]\s*/, "")
    .replace(/；.*$/, "")
    .trim();
  const colors = [anchor.mainColor, anchor.secondaryColor].filter(Boolean).join("、");
  const keyParts = compact(anchor.keyParts, 4)
    .map((item) => item.replace(/[，,。；;].*$/, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("、");
  const material = (anchor.materialLook ?? "")
    .replace(/[，,。；;].*$/, "")
    .trim();

  return [
    categoryShape || "保持参考图产品主体轮廓",
    colors ? `产品色为${colors}` : "",
    material ? `${material}` : "",
    keyParts ? `保留${keyParts}` : ""
  ]
    .filter(Boolean)
    .join("，")
    .replace(/，+/g, "，")
    .slice(0, 120);
}

export function hasWeakVisualAnchor(anchor: ProductVisualAnchor) {
  return anchor.keyParts.length < 3 || anchor.mainColor === "以参考图主色为准";
}
