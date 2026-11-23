// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSellingPointPlan } from "@/lib/script-engine/selling-points";
import { generateScript, generateTopicScript } from "@/lib/script-engine/generator";
import * as llm from "@/lib/llm-error";
import type OpenAI from "openai";

const features = ["可拆洗内胆", "折叠手柄", "附收纳袋", "两种尺寸", "透明刻度"];
const input = {
  productName: "旅行杯", productDescription: features.join("；"), category: "home" as const,
  styleType: "scene" as const, llmConfig: { baseUrl: "https://example.test/v1", apiKey: "test", model: "test" },
};
const rawPlan = {
  audience: "旅行者", coreMessage: "方便随身携带",
  sellingPoints: features.map((feature, index) => ({ feature, benefit: `收益${index + 1}`, evidence: feature, source: "provided", priority: index ? "secondary" : "primary", visualIdea: "展示结构" })),
  missingInfo: [],
};
const scriptResponse = { scripts: [{ title: "旅行杯", shots: [{ shotId: 1, duration: 5, voiceover: "出门带上它，收纳更方便。", sellingPointIds: ["sp2", "sp2", "sp999", 4] }] }] };
const response = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
afterEach(() => vi.restoreAllMocks());

describe("selling-point planning", () => {
  it("keeps every supplied point, with stable IDs, instead of taking only the first three", () => {
    const plan = validateSellingPointPlan(rawPlan, input);
    expect(plan.sellingPoints.map((p) => p.feature)).toEqual(features);
    expect(plan.sellingPoints.map((p) => p.id)).toEqual(["sp1", "sp2", "sp3", "sp4", "sp5"]);
  });

  it("downgrades fabricated evidence and distinguishes image analysis from supplied facts", () => {
    const plan = validateSellingPointPlan({ ...rawPlan, sellingPoints: [
      { feature: "保温24小时", benefit: "全天热水", evidence: "保温24小时", source: "provided", priority: "primary" },
      { feature: "透明杯身", benefit: "能看到余量", evidence: "透明杯身", source: "provided" },
    ] }, { ...input, productAnalysis: "图片可见透明杯身" });
    expect(plan.sellingPoints[0]).toMatchObject({ source: "inferred", evidence: "", priority: "secondary" });
    expect(plan.sellingPoints[1].source).toBe("image");
  });

  it("requires missing-information guidance when no points can be extracted", () => {
    expect(() => validateSellingPointPlan({ sellingPoints: [] }, input)).toThrow("待补资料");
    expect(validateSellingPointPlan({ sellingPoints: [], missingInfo: ["请提供产品特点"] }, input).sellingPoints).toEqual([]);
    expect(() => validateSellingPointPlan({ sellingPoints: [null] }, input)).toThrow("格式错误");
  });

  it("plans once, sends the plan to script generation, and retains unused points in every variant", async () => {
    const create = vi.fn().mockResolvedValueOnce(response(rawPlan)).mockResolvedValueOnce(response({ scripts: [scriptResponse.scripts[0], { ...scriptResponse.scripts[0], title: "方案二" }] }));
    vi.spyOn(llm, "createLLMClient").mockReturnValue({ chat: { completions: { create } } } as unknown as OpenAI);
    const scripts = await generateScript(input);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages[1].content).toContain("透明刻度");
    for (const script of scripts) {
      expect(script.sellingPointPlan?.sellingPoints).toHaveLength(5);
      expect(script.shots[0].sellingPointIds).toEqual(["sp2"]);
    }
  });

  it("repairs a malformed plan before writing the script", async () => {
    const create = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(rawPlan)).mockResolvedValueOnce(response(scriptResponse));
    vi.spyOn(llm, "createLLMClient").mockReturnValue({ chat: { completions: { create } } } as unknown as OpenAI);
    expect((await generateScript(input))[0].sellingPointPlan?.sellingPoints).toHaveLength(5);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("reports the planning stage and passes cancellation through to the model", async () => {
    async function* chunks(value: unknown) { yield { choices: [{ delta: { content: JSON.stringify(value) } }] }; }
    const create = vi.fn().mockResolvedValueOnce(chunks(rawPlan)).mockResolvedValueOnce(chunks(scriptResponse));
    vi.spyOn(llm, "createLLMClient").mockReturnValue({ chat: { completions: { create } } } as unknown as OpenAI);
    const controller = new AbortController();
    const emit = vi.fn();
    await generateScript(input, { signal: controller.signal, emit });
    expect(emit).toHaveBeenCalledWith({ type: "stage", stage: "selling_points", model: "test" });
    expect(create.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    await expect(generateScript(input, { signal: controller.signal, emit })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("leaves topic generation product-free and uses just its existing model call", async () => {
    const create = vi.fn().mockResolvedValue(response(scriptResponse));
    vi.spyOn(llm, "createLLMClient").mockReturnValue({ chat: { completions: { create } } } as unknown as OpenAI);
    const result = await generateTopicScript({ topic: "旅行收纳", llmConfig: input.llmConfig });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result[0].sellingPointPlan).toBeUndefined();
  });
});
