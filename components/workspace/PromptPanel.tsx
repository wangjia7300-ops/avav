"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, FileText, Image as ImageIcon, Loader2, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buildPromptDeliverySections, formatPromptForDelivery } from "@/lib/prompt-delivery-format";
import { sanitizePromptText } from "@/lib/prompt-templates";
import { useProviderStore } from "@/lib/provider-store";
import type { GeneratedImageAsset, GeneratedPrompt, GenerationMeta } from "@/lib/types";

type PromptPanelProps = {
  prompts: GeneratedPrompt[];
};

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

type ImageJob = {
  status: "idle" | "loading" | "success" | "error";
  image?: GeneratedImageAsset;
  error?: string;
};

function formatSinglePrompt(prompt: GeneratedPrompt) {
  return formatPromptForDelivery(prompt);
}

function formatPrompt(prompt: GeneratedPrompt) {
  return formatSinglePrompt(prompt);
}

function formatPromptGroup(title: string, prompts: GeneratedPrompt[]) {
  return [
    `# ${title}`,
    "",
    ...prompts.flatMap((prompt) => [
      `## ${prompt.index}. ${prompt.title}`,
      formatPrompt(prompt),
      ""
    ])
  ]
    .join("\n")
    .trim();
}

function generationBadge(meta?: GenerationMeta) {
  if (!meta) return null;
  if (meta.usedMock || meta.sourceType === "mock") return <Badge variant="secondary">模拟数据</Badge>;
  if (meta.usedFallback || meta.sourceType === "template_fallback") return <Badge variant="outline">模板兜底</Badge>;
  if (meta.usedAI || meta.sourceType === "real_ai") return <Badge variant="success">真实 AI</Badge>;
  if (meta.sourceType === "ai_inference") return <Badge variant="outline">AI 推断</Badge>;
  return null;
}

export function PromptPanel({ prompts }: PromptPanelProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [imageJobs, setImageJobs] = useState<Record<string, ImageJob>>({});
  const getActiveConfig = useProviderStore((state) => state.getActiveConfig);
  const grouped = useMemo(
    () => ({
      main: prompts.filter((prompt) => prompt.imageType === "main_image"),
      detail: prompts.filter((prompt) => prompt.imageType === "detail_page")
    }),
    [prompts]
  );

  async function copyText(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  }

  async function generateImage(prompt: GeneratedPrompt) {
    const key = `${prompt.imageType}-${prompt.index}`;
    const sections = buildPromptDeliverySections(prompt);
    setImageJobs((current) => ({
      ...current,
      [key]: { status: "loading" }
    }));

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: sections.chinesePrompt,
          negativePrompt: sections.negativePrompt,
          imageType: prompt.imageType,
          providerConfig: getActiveConfig()
        })
      });
      const payload = (await response.json()) as ApiResponse<GeneratedImageAsset>;

      if (!response.ok || !payload.success) {
        throw new Error("error" in payload ? payload.error : "图片生成失败。");
      }

      setImageJobs((current) => ({
        ...current,
        [key]: {
          status: "success",
          image: payload.data
        }
      }));
    } catch (error) {
      setImageJobs((current) => ({
        ...current,
        [key]: {
          status: "error",
          error: error instanceof Error ? error.message : "图片生成失败。"
        }
      }));
    }
  }

  if (!prompts.length) {
    return (
      <EmptyState
        title="等待提示词生成"
        description="视觉策划完成后，这里会为每张主图和详情页输出可直接生成完整电商画面的提示词、结构化文字层与负面词。"
        icon={<FileText className="h-5 w-5" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      {[
        { id: "main", title: "主图提示词", data: grouped.main },
        { id: "detail", title: "详情页提示词", data: grouped.detail }
      ].filter((group) => group.data.length > 0).map((group) => {
        const groupCopyKey = `${group.id}-all-prompts`;
        const groupCopied = copiedKey === groupCopyKey;

        return (
          <section key={group.title} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-950">{group.title}</h3>
                <Badge variant="secondary">{group.data.length} 条</Badge>
                {generationBadge(group.data[0]?.generationMeta)}
              </div>
              {group.data.length ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(groupCopyKey, formatPromptGroup(group.title, group.data))}
                >
                  {groupCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {groupCopied ? "已复制" : "复制全部"}
                </Button>
              ) : null}
            </div>
            <div className="space-y-4">
              {group.data.map((prompt) => (
                <Card key={`${prompt.imageType}-${prompt.index}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle>
                        {prompt.index}. {prompt.title}
                      </CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void generateImage(prompt)}
                        disabled={imageJobs[`${prompt.imageType}-${prompt.index}`]?.status === "loading"}
                      >
                        {imageJobs[`${prompt.imageType}-${prompt.index}`]?.status === "loading" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <WandSparkles className="h-4 w-4" />
                        )}
                        {imageJobs[`${prompt.imageType}-${prompt.index}`]?.status === "loading"
                          ? "生成中"
                          : "生成图片"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(() => {
                      const sections = buildPromptDeliverySections(prompt);

                      return (
                        <>
                          <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3">
                            <p className="text-xs font-semibold text-blue-700">统一设定</p>
                            <div className="mt-2 space-y-1 text-xs leading-5 text-slate-700">
                              <p><span className="font-medium">产品：</span>{sections.productSetting}</p>
                              <p><span className="font-medium">风格：</span>{sections.visualStyle}</p>
                              <p><span className="font-medium">质感：</span>{sections.imageTexture}</p>
                              <p><span className="font-medium">布光：</span>{sections.lightingLogic}</p>
                            </div>
                          </div>
                          <div className="rounded-md border bg-white p-3">
                            <p className="text-xs font-semibold text-slate-700">文字与排版</p>
                            <div className="mt-2 space-y-1 text-xs leading-5 text-slate-700">
                              <p><span className="font-medium">主标题：</span>{sections.headline}</p>
                              <p><span className="font-medium">副标题：</span>{sections.subheadline}</p>
                              <p><span className="font-medium">信息布局：</span>{sections.infoLayout}</p>
                              <p><span className="font-medium">排版形式：</span>{sections.layoutForm}</p>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    <div className="rounded-md border bg-slate-50/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-slate-700">中文提示词</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyText(`${prompt.imageType}-${prompt.index}-all`, formatSinglePrompt(prompt))}
                        >
                          {copiedKey === `${prompt.imageType}-${prompt.index}-all` ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          {copiedKey === `${prompt.imageType}-${prompt.index}-all` ? "已复制" : "复制"}
                        </Button>
                      </div>
                      <p className="max-h-32 overflow-y-auto text-xs leading-5 text-slate-700">
                        {buildPromptDeliverySections(prompt).chinesePrompt}
                      </p>
                    </div>
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                      <p className="text-xs font-semibold text-destructive">负面提示词</p>
                      <p className="mt-2 text-xs leading-5 text-slate-700">
                        {sanitizePromptText(buildPromptDeliverySections(prompt).negativePrompt)}
                      </p>
                    </div>
                    {(() => {
                      const job = imageJobs[`${prompt.imageType}-${prompt.index}`];

                      if (!job || job.status === "idle") return null;

                      if (job.status === "loading") {
                        return (
                          <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-700">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            正在根据当前提示词生成图片，通常需要几十秒到数分钟。
                          </div>
                        );
                      }

                      if (job.status === "error") {
                        return (
                          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
                            {job.error}
                          </div>
                        );
                      }

                      if (!job.image) return null;

                      return (
                        <div className="rounded-md border bg-white p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <ImageIcon className="h-4 w-4 text-primary" />
                              <p className="text-xs font-semibold text-slate-700">
                                生图结果
                              </p>
                              <Badge variant="secondary">{job.image.size}</Badge>
                            </div>
                            <a
                              href={job.image.imageUrl}
                              download={`${prompt.imageType}-${prompt.index}.png`}
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"
                            >
                              <Download className="h-4 w-4" />
                              下载
                            </a>
                          </div>
                          <img
                            src={job.image.imageUrl}
                            alt={`${prompt.title} 生图结果`}
                            className="max-h-[520px] w-full rounded-md border object-contain"
                          />
                          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                            模型：{job.image.model}；生成时间：{new Date(job.image.createdAt).toLocaleString()}
                          </p>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
