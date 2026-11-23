"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LuCheck, LuClock, LuLoaderCircle, LuTriangleAlert, LuFileText } from "react-icons/lu";
import { useLocale } from "@/lib/i18n";
import type { ScriptGenerationProgress } from "@/lib/use-script-generation";
import type { ScriptStage } from "@/lib/script-progress";

const stages: Record<ScriptStage, { zh: [string, string]; en: [string, string] }> = {
  selling_points: { zh: ["整理全部商品卖点", "正在逐条整理产品特点、用户收益和资料依据，随后生成分镜。"], en: ["Organizing selling points", "Listing product features, benefits and sources before writing the storyboard."] },
  preparing: { zh: ["整理项目信息", "正在检查主题、素材和模型配置。"], en: ["Preparing your brief", "Checking the topic, materials and model settings."] },
  analyzing: { zh: ["分析商品图片", "正在让视觉模型提取商品特征。"], en: ["Analyzing product images", "The vision model is identifying product details."] },
  connecting: { zh: ["等待模型返回内容", "请求已开始，正在等待模型的首段脚本。"], en: ["Waiting for the model", "The request has started. Waiting for the first script text."] },
  writing: { zh: ["正在生成分镜", "下方会逐段显示已收到的标题、画面描述和旁白。"], en: ["Writing the storyboard", "Titles, scene descriptions and narration appear below as they arrive."] },
  buffering: { zh: ["等待完整脚本", "此接口不支持逐段返回，完成后会一次性显示脚本。"], en: ["Waiting for the full script", "This endpoint returns the complete script instead of streaming it."] },
  validating: { zh: ["校验脚本结构", "正在检查分镜、时长和内容格式。"], en: ["Checking the script", "Checking shots, duration and content structure."] },
  repairing: { zh: ["重新整理脚本格式", "上一份内容格式不完整，正在请求模型重新输出。"], en: ["Repairing script format", "The previous response was incomplete. Asking the model to rewrite it."] },
  saving: { zh: ["保存脚本", "脚本已通过校验，正在保存到项目。"], en: ["Saving the script", "Validation passed. Saving the script to your project."] },
};

export function ScriptGenerationProgressPanel({ progress }: { progress: ScriptGenerationProgress | null }) {
  const locale = useLocale();
  const [now, setNow] = useState(0);
  const preview = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (progress?.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [progress?.status, progress?.startedAt]);
  useEffect(() => {
    if (follow.current && preview.current) preview.current.scrollTop = preview.current.scrollHeight;
  }, [progress?.lines]);
  if (!progress) return null;
  const zh = locale === "zh";
  const running = progress.status === "running";
  const failed = progress.status === "error";
  const elapsed = Math.max(0, Math.floor(((progress.finishedAt ?? Math.max(now, progress.startedAt)) - progress.startedAt) / 1000));
  const elapsedText = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const [label, description] = stages[progress.stage][locale];
  const stale = running && now - progress.updatedAt > 20000;
  const lineLabels = zh ? { title: "标题", description: "画面", voiceover: "旁白" } : { title: "Title", description: "Scene", voiceover: "Narration" };
  return (
    <section aria-label={zh ? "脚本生成进度" : "Script generation progress"} className="w-full min-w-0 overflow-hidden rounded-2xl border border-violet-400/20 bg-violet-500/[0.04] text-left shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-400/15 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {failed ? <LuTriangleAlert className="size-4 text-amber-400" /> : running ? <LuLoaderCircle className="size-4 animate-spin text-violet-400" /> : <LuCheck className="size-4 text-emerald-400" />}
          <span role="status">{failed ? (zh ? "生成未完成" : "Generation incomplete") : running ? label : (zh ? "脚本已完成" : "Script complete")}</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"><LuClock className="size-3.5" />{zh ? "用时" : "Elapsed"} {elapsedText}</span>
      </div>
      <div className="space-y-4 px-5 py-4">
        {progress.model && <p className="break-all text-xs text-muted-foreground">{zh ? "当前模型" : "Current model"} · <span className="text-foreground">{progress.model}</span></p>}
        <ol aria-label={zh ? "执行记录" : "Execution log"} className="space-y-2 text-xs">
          {progress.history.map((step, index) => {
            const last = index === progress.history.length - 1;
            return <li key={`${step.stage}-${index}`} className="flex items-center gap-2">
              <span className={`size-1.5 shrink-0 rounded-full ${last && running ? "animate-pulse bg-violet-400" : failed && last ? "bg-amber-400" : "bg-emerald-400"}`} />
              <span className={last ? "text-foreground" : "text-muted-foreground"}>{stages[step.stage][locale][0]}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{Math.max(0, Math.floor((step.at - progress.startedAt) / 1000))}s</span>
            </li>;
          })}
        </ol>
        <p className="text-xs leading-relaxed text-muted-foreground">{failed ? (zh ? "已保留本次执行记录。检查下方错误后可重试。" : "This run's steps are kept here. Check the error below before retrying.") : running ? description : (zh ? "脚本已保存，可以继续查看和编辑。" : "The script is saved and ready to review.")}</p>
        {running && elapsed >= 20 && !progress.lines.length && <p className="text-xs text-amber-400">{stale ? (zh ? "暂未收到服务端更新，请检查连接，避免重复提交。" : "No recent server update. Check the connection before submitting again.") : (zh ? "服务连接正常，模型尚未返回脚本内容，请继续等待。" : "The server is connected; the model has not returned script text yet.")}</p>}
        <div className="rounded-xl border border-border/60 bg-background/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground"><LuFileText className="size-3.5" />{zh ? "脚本预览" : "Script preview"}<span className="ml-auto">{zh ? "生成中内容可能调整" : "Draft may change"}</span></div>
          <div ref={preview} onScroll={() => { const el = preview.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }} className="max-h-72 space-y-3 overflow-y-auto p-3 text-sm leading-relaxed">
            {progress.lines.length ? progress.lines.map((line, index) => <div key={index} className="break-words"><span className="mr-2 text-xs text-violet-400">{lineLabels[line.field]}</span>{line.text}</div>) : <p className="py-3 text-xs text-muted-foreground">{zh ? "收到脚本内容后，会在这里逐段显示。" : "Script text will appear here as it arrives."}</p>}
          </div>
        </div>
        {failed && progress.error && <p role="alert" className="break-words text-xs leading-relaxed text-destructive">{progress.error}</p>}
        {failed && progress.projectId && <Link href={`/project/${progress.projectId}/script`} className="inline-block text-xs text-violet-400 underline underline-offset-4">{zh ? "打开已创建的项目继续重试" : "Open the saved project to retry"}</Link>}
        {failed && <Link href="/settings?tab=llm" className="ml-3 inline-block text-xs text-muted-foreground underline underline-offset-4">{zh ? "检查模型设置" : "Check model settings"}</Link>}
      </div>
    </section>
  );
}
