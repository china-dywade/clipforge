/** Public generation events contain workflow state and script text only. */
export type ScriptStage = "preparing" | "analyzing" | "selling_points" | "connecting" | "writing" | "buffering" | "validating" | "repairing" | "saving";
export type DraftLine = { field: "title" | "description" | "voiceover"; text: string };
export type ScriptProgressEvent =
  | { type: "stage"; stage: ScriptStage; model?: string }
  | { type: "preview"; lines: DraftLine[] }
  | { type: "heartbeat" };
export type ScriptStreamEvent = ScriptProgressEvent
  | { type: "result"; status: number; data: unknown };
export interface ScriptProgressContext {
  emit: (event: ScriptProgressEvent) => void;
  signal: AbortSignal;
}

/** Show completed script fields as they arrive, never raw JSON or reasoning blocks. */
export function scriptDraftLines(content: string): DraftLine[] {
  const visible = content
    .replace(/<(think|thinking|reasoning|thought)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(think|thinking|reasoning|thought)\b[^>]*>[\s\S]*$/i, "");
  const lines: DraftLine[] = [];
  const fields = /"(title|description|voiceover)"\s*:\s*("(?:[^"\\]|\\.)*")/g;
  for (const match of visible.matchAll(fields)) {
    try {
      const text = JSON.parse(match[2]) as string;
      if (text.trim()) lines.push({ field: match[1] as DraftLine["field"], text: text.slice(0, 2000) });
    } catch { /* incomplete escape: wait for another chunk */ }
    if (lines.length >= 90) break;
  }
  return lines;
}

/** NDJSON records may cross both UTF-8 and network chunk boundaries. */
export async function readScriptStream(response: Response, onEvent: (event: ScriptProgressEvent) => void): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response;
  if (!response.body) throw new Error("生成进度连接为空 / Empty generation stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: Response | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ScriptStreamEvent;
    if (event.type === "result") {
      result = new Response(JSON.stringify(event.data), { status: event.status, headers: { "Content-Type": "application/json" } });
    } else onEvent(event);
  };
  try {
    while (!result) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (done) {
        consume(pending);
        break;
      }
    }
    if (!result) throw new Error("生成进度连接中断，请查看项目后重试 / Generation connection interrupted; check the project before retrying");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
