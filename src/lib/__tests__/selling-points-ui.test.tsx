import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScriptSellingPoints } from "@/components/script-selling-points";
import type { SellingPointPlan } from "@/lib/script-engine/selling-points";
import type { Shot } from "@/lib/db/schema";

vi.mock("@/lib/i18n", () => ({ useLocale: () => "zh" }));

describe("selling-point display", () => {
  it("lists every point, including unused points, and changes links with the selected variant", () => {
    const plan: SellingPointPlan = { audience: "旅行者", coreMessage: "方便收纳", missingInfo: ["容量待确认"], sellingPoints: Array.from({ length: 5 }, (_, i) => ({ id: `sp${i + 1}`, feature: `特点${i + 1}`, benefit: `收益${i + 1}`, evidence: `依据${i + 1}`, source: "provided", priority: i ? "secondary" : "primary", visualIdea: "展示结构" })) };
    const shots = [{ shotId: 2, sellingPointIds: ["sp1"] }] as Shot[];
    const html = renderToStaticMarkup(<ScriptSellingPoints plan={plan} shots={shots} />);
    const view = document.createElement("div");
    view.innerHTML = html;
    expect(view.querySelectorAll("ol > li")).toHaveLength(5);
    expect(view.textContent).toContain("特点5");
    expect(view.textContent).toContain("第 2 镜");
    expect(view.textContent?.match(/本方案未安排/g)).toHaveLength(4);
    expect(view.textContent).toContain("容量待确认");
    const alternate = renderToStaticMarkup(<ScriptSellingPoints plan={plan} shots={[{ shotId: 4, sellingPointIds: ["sp5"] }] as Shot[]} />);
    expect(alternate).toContain("第 4 镜");
    expect(alternate).not.toContain("第 2 镜");
  });

  it("explains how to populate older scripts without fabricating a brief", () => {
    const html = renderToStaticMarkup(<ScriptSellingPoints shots={[]} />);
    expect(html).toContain("重新生成脚本");
    expect(html).not.toContain("用户资料提供");
  });
});
