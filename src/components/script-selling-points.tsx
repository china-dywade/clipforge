"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n";
import type { SellingPointPlan } from "@/lib/script-engine/selling-points";
import type { Shot } from "@/lib/db/schema";

/** Always expanded: every point is visible, including those unused by the selected script. */
export function ScriptSellingPoints({ plan, shots }: { plan?: SellingPointPlan | null; shots: Shot[] }) {
  const zh = useLocale() === "zh";
  return (
    <Card className="glass-card">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">{zh ? "商品卖点整理" : "Product selling points"}{plan ? ` · ${plan.sellingPoints.length}` : ""}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {zh ? "完整列出本次整理的卖点，镜头关联随所选脚本切换；修改台词或画面后，请核对关联是否仍适用。" : "All points from this brief, with shot links for the selected script. Recheck links after editing narration or visuals."}
          </p>
        </div>
        {!plan ? (
          <p className="text-sm text-muted-foreground">{zh ? "这份脚本尚未保存卖点整理。重新生成脚本后，会在这里逐条显示。" : "This script has no saved selling-point brief. Regenerate the script to see its points here."}</p>
        ) : (
          <>
            {(plan.audience || plan.coreMessage) && <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
              {plan.audience && <p><span className="text-muted-foreground">{zh ? "目标用户：" : "Audience: "}</span>{plan.audience}</p>}
              {plan.coreMessage && <p><span className="text-muted-foreground">{zh ? "建议主线：" : "Suggested message: "}</span>{plan.coreMessage}</p>}
            </div>}
            {!plan.sellingPoints.length && <p className="text-sm text-muted-foreground">{zh ? "现有资料不足以提炼具体卖点，请补充下方信息后重新生成。" : "There is not enough information for specific selling points. Add the details below and regenerate."}</p>}
            <ol className="grid gap-3 md:grid-cols-2">
              {plan.sellingPoints.map((point, index) => {
                const linkedShots = shots.filter((shot) => shot.sellingPointIds?.includes(point.id));
                const sourceLabel = point.source === "provided"
                  ? (zh ? "用户资料提供" : "From supplied information")
                  : point.source === "image" ? (zh ? "图片识别 · 请核对" : "Image analysis · check details")
                    : (zh ? "待确认推断" : "Unconfirmed inference");
                return <li key={point.id} className="min-w-0 space-y-3 rounded-xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-sm font-semibold">{index + 1}. {point.feature}</h3>
                    {point.priority === "primary" && <Badge variant="secondary">{zh ? "主卖点" : "Primary"}</Badge>}
                  </div>
                  <dl className="space-y-2 break-words text-sm">
                    <div><dt className="text-xs text-muted-foreground">{zh ? "用户收益" : "Customer benefit"}</dt><dd>{point.benefit}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{zh ? "资料依据" : "Source"} · {sourceLabel}</dt><dd className="whitespace-pre-wrap">{point.evidence || (zh ? "尚无资料支持，暂不作为脚本事实。" : "No supporting source; do not use as a factual claim.")}</dd></div>
                    {point.visualIdea && <div><dt className="text-xs text-muted-foreground">{zh ? "建议展示" : "Suggested visual"}</dt><dd>{point.visualIdea}</dd></div>}
                  </dl>
                  <p className={`text-xs ${linkedShots.length ? "text-primary" : "text-muted-foreground"}`}>
                    {linkedShots.length
                      ? (zh ? `计划关联镜头：${linkedShots.map((shot) => `第 ${shot.shotId} 镜`).join("、")}` : `Planned shots: ${linkedShots.map((shot) => shot.shotId).join(", ")}`)
                      : (zh ? "本方案未安排" : "Not used in this variant")}
                  </p>
                </li>;
              })}
            </ol>
            {plan.missingInfo.length > 0 && <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              <h3 className="text-sm font-medium">{zh ? "待补充 / 待确认" : "Missing details / needs confirmation"}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{plan.missingInfo.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
