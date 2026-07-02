"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Eye, EyeOff, Key, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSearchProviderStore } from "@/lib/search-provider-store";
import type { SearchProviderId } from "@/lib/types";

const SEARCH_PROVIDERS: Array<{
  id: SearchProviderId;
  name: string;
  description: string;
}> = [
  {
    id: "serpapi",
    name: "SerpAPI",
    description: "适合用 Google 搜索摘要做竞品卖点、标题风格、用户痛点和视觉风格研究。"
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "适合搜索并抓取网页摘要，用于补充全网内容研究。"
  }
];

export function SearchProviderConfig() {
  const { config, isConfigured, selectProvider, setApiKey, resetConfig } = useSearchProviderStore();
  const [showKey, setShowKey] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="h-4 w-4 text-primary" />
            真实搜索配置（已关闭）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">加载中...</p>
        </CardContent>
      </Card>
    );
  }

  const selectedProviderId = config?.providerId ?? "serpapi";
  const selectedProvider = SEARCH_PROVIDERS.find((provider) => provider.id === selectedProviderId);

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Search className="h-4 w-4 text-primary" />
              真实搜索配置（已关闭）
            </CardTitle>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              本版本不调用外部搜索 API，也不启用模型联网插件；该面板保留为后续版本预留。
            </p>
          </div>
          {isConfigured ? (
            <Badge variant="success" className="h-fit gap-1">
              <CheckCircle2 className="h-3 w-3" />
              已配置
            </Badge>
          ) : (
            <Badge variant="secondary" className="h-fit">
              未配置
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-950">搜索服务</label>
          <div className="relative">
            <select
              value={selectedProviderId}
              onChange={(event) => selectProvider(event.target.value as SearchProviderId)}
              className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SEARCH_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {selectedProvider ? (
            <p className="text-xs leading-5 text-muted-foreground">{selectedProvider.description}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-950">
            <Key className="h-3.5 w-3.5" />
            搜索 API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={config?.apiKey ?? ""}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={selectedProviderId === "serpapi" ? "输入 SerpAPI Key" : "输入 Firecrawl API Key"}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
              tabIndex={-1}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            搜索 Key 只在点击分析时通过 HTTPS 发送到服务端，不写入代码。浏览器本地会保存配置，请勿在公共电脑上使用。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetConfig} disabled={!config}>
            重置为服务端配置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
