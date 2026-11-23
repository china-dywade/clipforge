// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type OpenAI from "openai";
import { initializeSqlite } from "@/lib/db/initialize";
import * as schema from "@/lib/db/schema";
import * as llm from "@/lib/llm-error";
import { POST } from "@/app/api/llm/script/route";
import { GET } from "@/app/api/project/[id]/scripts/route";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
afterEach(() => vi.restoreAllMocks());

it("saves all points and shot links, reads them back, and rolls back failed replacement", async () => {
  const sqlite = new Database(":memory:");
  try {
    initializeSqlite(sqlite, resolve("drizzle"));
    const db = drizzle(sqlite, { schema });
    state.db = db;
    db.insert(schema.projects).values({ id: "selling-test", name: "旅行杯", contentType: "product" }).run();
    db.insert(schema.scripts).values({ id: "legacy", projectId: "selling-test", styleType: "scene", title: "旧脚本" }).run();
    expect(db.select().from(schema.scripts).get()?.sellingPointPlan).toBeNull();
    const points = ["可拆洗内胆", "折叠手柄", "附收纳袋", "两种尺寸", "透明刻度"];
    const plan = { audience: "旅行者", coreMessage: "轻松收纳", sellingPoints: points.map((feature) => ({ feature, benefit: "使用方便", source: "provided", evidence: feature })), missingInfo: [] };
    const draft = { scripts: [{ title: "旅行杯介绍", shots: [{ shotId: 1, duration: 5, voiceover: "折叠手柄收起来，放进包里更方便。", sellingPointIds: ["sp2"] }] }] };
    const response = (data: unknown) => ({ choices: [{ message: { content: JSON.stringify(data) } }] });
    const create = vi.fn().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response(draft));
    vi.spyOn(llm, "createLLMClient").mockReturnValue({ chat: { completions: { create } } } as unknown as OpenAI);
    const request = () => new NextRequest("http://localhost/api/llm/script", { method: "POST", body: JSON.stringify({ projectId: "selling-test", productName: "旅行杯", productDescription: points.join("；"), insightMode: false, llmConfig: { baseUrl: "https://example.test/v1", apiKey: "test", model: "test" } }) });
    const generated = await POST(request());
    expect(generated.status).toBe(200);
    expect((await generated.json()).scripts[0].sellingPointPlan.sellingPoints).toHaveLength(5);
    const read = () => GET(new NextRequest("http://localhost/api/project/selling-test/scripts"), { params: Promise.resolve({ id: "selling-test" }) });
    const saved = await (await read()).json();
    expect(saved).toHaveLength(1);
    expect(saved[0].sellingPointPlan.sellingPoints.map((p: { feature: string }) => p.feature)).toEqual(points);
    expect(saved[0].shots[0].sellingPointIds).toEqual(["sp2"]);

    // Simulate a storage failure after deletion: the previous script must remain readable.
    sqlite.exec("CREATE TRIGGER fail_script_insert BEFORE INSERT ON scripts BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
    create.mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response(draft));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(request())).status).toBe(500);
    expect(await (await read()).json()).toEqual(saved);
  } finally {
    sqlite.close();
  }
});
