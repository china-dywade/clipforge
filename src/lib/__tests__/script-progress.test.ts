// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { readScriptStream, scriptDraftLines, type ScriptProgressEvent } from "@/lib/script-progress";
import { scriptProgressResponse } from "@/lib/script-progress-server";
import { completeWithJsonRetry } from "@/lib/script-engine/generator";

describe("script progress transport", () => {
  it("delivers a real stage before work finishes and preserves the final error and draft ID", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    const response = await scriptProgressResponse(new Request("http://localhost", { headers: { Accept: "application/x-ndjson" } }), async (progress) => {
      progress?.emit({ type: "stage", stage: "connecting", model: "test" });
      await waiting;
      return Response.json({ error: "模型连接失败", projectId: "draft" }, { status: 502 });
    });
    const events: ScriptProgressEvent[] = [];
    const reading = readScriptStream(response, (event) => events.push(event));
    await vi.waitFor(() => expect(events).toContainEqual({ type: "stage", stage: "connecting", model: "test" }));
    finish();
    const result = await reading;
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: "模型连接失败", projectId: "draft" });
  });

  it("keeps JSON callers unchanged", async () => {
    const original = Response.json({ scripts: [] }, { status: 201 });
    const work = vi.fn(async () => original);
    expect(await scriptProgressResponse(new Request("http://localhost"), work)).toBe(original);
    expect(work).toHaveBeenCalledWith();
  });

  it("handles fragmented UTF-8 and a final line without newline", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "preview", lines: [{ field: "title", text: "中文标题" }] }) + "\n" + JSON.stringify({ type: "result", status: 200, data: { saved: true } }));
    const response = new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { "Content-Type": "application/x-ndjson" } });
    const events: ScriptProgressEvent[] = [];
    const result = await readScriptStream(response, (e) => events.push(e));
    expect(events).toEqual([{ type: "preview", lines: [{ field: "title", text: "中文标题" }] }]);
    expect(await result.json()).toEqual({ saved: true });
  });

  it("rejects an interrupted stream instead of claiming success", async () => {
    const response = new Response('{"type":"stage","stage":"saving"}\n', { headers: { "Content-Type": "application/x-ndjson" } });
    await expect(readScriptStream(response, () => {})).rejects.toThrow("连接中断");
  });

  it("cancels provider work when the client leaves", async () => {
    let signal!: AbortSignal;
    const response = await scriptProgressResponse(new Request("http://localhost", { headers: { Accept: "application/x-ndjson" } }), async (progress) => {
      signal = progress!.signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return Response.json({});
    });
    await response.body!.cancel();
    expect(signal.aborted).toBe(true);
  });
});

describe("script draft preview", () => {
  it("shows only completed script fields, including escaped text", () => {
    expect(scriptDraftLines('{"title":"桌面整理","voiceover":"先把\\"杂物\\"移开。","description":"未完成')).toEqual([
      { field: "title", text: "桌面整理" }, { field: "voiceover", text: '先把"杂物"移开。' },
    ]);
  });
  it("does not display closed or incomplete reasoning blocks", () => {
    expect(scriptDraftLines('<think>{"title":"内部内容"}</think>{"title":"公开标题"}')).toEqual([{ field: "title", text: "公开标题" }]);
    expect(scriptDraftLines('<think>{"title":"内部内容"}')).toEqual([]);
  });
});

describe("streamed script generation", () => {
  const params = { model: "test", messages: [{ role: "user" as const, content: "write JSON" }] };
  const clientFor = (create: unknown) => ({ chat: { completions: { create } } }) as OpenAI;
  const reply = async function* (text: string) {
    yield { choices: [{ delta: { reasoning_content: "private reasoning" } }] };
    yield { choices: [{ delta: { content: text } }] };
  };

  it("sends script text and validation events before returning the parsed result", async () => {
    const events: ScriptProgressEvent[] = [];
    const create = vi.fn(async () => reply('{"title":"测试脚本"}'));
    const result = await completeWithJsonRetry(clientFor(create), params, {}, JSON.parse, { emit: (e) => events.push(e), signal: new AbortController().signal });
    expect(result).toEqual({ title: "测试脚本" });
    expect(events).toContainEqual({ type: "stage", stage: "writing" });
    expect(events).toContainEqual({ type: "preview", lines: [{ field: "title", text: "测试脚本" }] });
    expect(events.at(-1)).toEqual({ type: "stage", stage: "validating" });
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("reports a real format repair and clears the rejected draft", async () => {
    const events: ScriptProgressEvent[] = [];
    const create = vi.fn().mockResolvedValueOnce(reply('{"title":"不完整"')).mockResolvedValueOnce(reply('{"title":"已修复"}'));
    const result = await completeWithJsonRetry(clientFor(create), params, {}, JSON.parse, { emit: (e) => events.push(e), signal: new AbortController().signal });
    expect(result).toEqual({ title: "已修复" });
    expect(events).toContainEqual({ type: "stage", stage: "repairing" });
    expect(events).toContainEqual({ type: "preview", lines: [] });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("supports providers that explicitly reject streaming", async () => {
    const events: ScriptProgressEvent[] = [];
    const create = vi.fn().mockRejectedValueOnce({ status: 400, message: "Unsupported parameter: stream" }).mockResolvedValueOnce({ choices: [{ message: { content: '{"title":"完整脚本"}' } }] });
    const result = await completeWithJsonRetry(clientFor(create), params, {}, JSON.parse, { emit: (e) => events.push(e), signal: new AbortController().signal });
    expect(result).toEqual({ title: "完整脚本" });
    expect(events).toContainEqual({ type: "stage", stage: "buffering" });
    expect(create.mock.calls[1][0]).not.toHaveProperty("stream");
  });
});
