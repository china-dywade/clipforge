"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readScriptStream, type DraftLine, type ScriptStage } from "./script-progress";

export interface ScriptGenerationProgress {
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  status: "running" | "done" | "error";
  model: string;
  stage: ScriptStage;
  history: { stage: ScriptStage; at: number }[];
  lines: DraftLine[];
  error?: string;
  projectId?: string;
}

export function useScriptGeneration(model: string) {
  const [progress, setProgress] = useState<ScriptGenerationProgress | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const request = useCallback(async (url: string, init: RequestInit): Promise<Response> => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const now = Date.now();
    setProgress({ startedAt: now, updatedAt: now, status: "running", model, stage: "preparing", history: [{ stage: "preparing", at: now }], lines: [] });
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/x-ndjson");
    try {
      const raw = await fetch(url, { ...init, headers, signal: controller.signal });
      const response = await readScriptStream(raw, (event) => {
        if (active.current !== controller) return;
        setProgress((previous) => {
          if (!previous) return previous;
          const updated = { ...previous, updatedAt: Date.now() };
          if (event.type === "preview") return { ...updated, lines: event.lines };
          if (event.type === "stage") return {
            ...updated, stage: event.stage, model: event.model ?? previous.model,
            history: previous.stage === event.stage ? previous.history : [...previous.history, { stage: event.stage, at: Date.now() }],
          };
          return updated;
        });
      });
      const data = await response.clone().json().catch(() => ({}));
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      if (active.current === controller) setProgress((p) => p && ({ ...p, status: response.ok ? "done" : "error", finishedAt: Date.now(), error: data?.error, projectId: data?.projectId ?? body.projectId }));
      return response;
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted) setProgress((p) => p && ({ ...p, status: "error", finishedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }));
      throw error;
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [model]);

  const reset = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setProgress(null);
  }, []);
  return { progress, request, reset };
}
