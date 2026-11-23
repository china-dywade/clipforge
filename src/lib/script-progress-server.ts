import type { ScriptProgressContext, ScriptStreamEvent } from "./script-progress";

/** Existing JSON callers retain their response contract; browser callers opt into progress. */
export function scriptProgressResponse(
  req: Request,
  work: (progress?: ScriptProgressContext) => Promise<Response>,
): Promise<Response> | Response {
  if (!req.headers.get("accept")?.includes("application/x-ndjson")) return work();
  const abort = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const onAbort = () => abort.abort();
  if (req.signal.aborted) abort.abort();
  req.signal.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => {
    clearInterval(timer);
    req.signal.removeEventListener("abort", onAbort);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ScriptStreamEvent) => {
        if (closed || abort.signal.aborted) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      emit({ type: "stage", stage: "preparing" });
      // A heartbeat confirms the server is still connected, not that the model made progress.
      timer = setInterval(() => emit({ type: "heartbeat" }), 5000);
      void (async () => {
        try {
          const response = await work({ emit, signal: abort.signal });
          const data: unknown = await response.json();
          emit({ type: "result", status: response.status, data });
        } catch {
          emit({ type: "result", status: 500, data: { error: req.headers.get("accept-language")?.startsWith("en")
            ? "Script generation interrupted. Please retry."
            : "脚本生成中断，请重试。" } });
        } finally {
          cleanup();
          if (!closed) { closed = true; controller.close(); }
        }
      })();
    },
    cancel() {
      closed = true;
      abort.abort();
      cleanup();
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
