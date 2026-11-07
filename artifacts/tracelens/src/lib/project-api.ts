import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TraceEvent } from "@workspace/api-client-react";

/** Typed client for the authenticated (Clerk cookie) project API. No fallback data, ever. */
const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export type RealRunStatus = "recording" | "passed" | "failed" | "unknown" | "incomplete";
export interface ExpectedStep { id: string; label: string; outcome: string }
export interface Project {
  id: string; publicId: string; name: string; url: string; origins: string[]; workflowName: string;
  steps: ExpectedStep[]; retentionDays: number; archivedAt: string | null; verifiedAt: string | null;
  createdAt: string; journeyId: string; baselineId: string | null; runCount: number;
}
export interface RealRun {
  id: string; journeyId: string; journeyName?: string; name: string; variant: string; status: RealRunStatus;
  createdAt: string; finishedAt?: string | null; isBaseline?: boolean; recorderError?: string | null;
  eventCount?: number; [k: string]: unknown;
}
export interface Credential { id: string; name: string; createdAt: string; revokedAt: string | null; expiresAt: string | null }
export interface ProjectDetail { project: Project; runs: RealRun[]; total: number; credentials: Credential[] }
export interface RunDetail { run: RealRun; events: TraceEvent[]; lastSequence: number; steps: ExpectedStep[] }
export interface SessionGrant { token: string; expiresAt: string; runId: string | null; projectId: string }
export interface ComparisonRowT {
  key: string; label: string; change: "unchanged" | "changed" | "missing" | "extra";
  baseline: TraceEvent | null; current: TraceEvent | null; reasons: string[];
}
export interface CompareResult {
  baseline: RealRun; current: RealRun; rows: ComparisonRowT[]; changedCount: number;
  firstDivergence: string | null; markdown: string; baselineSteps: ExpectedStep[]; currentSteps: ExpectedStep[];
}
export interface ProjectInput { name: string; url: string; origins: string[]; workflowName: string; steps: ExpectedStep[]; retentionDays: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json: supplied, ...rest } = init ?? {};
  const json = supplied === undefined && rest.method && !["GET", "HEAD"].includes(rest.method) ? {} : supplied;
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const b = await res.json(); msg = b?.error || b?.message || msg; } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const pk = {
  list: (archived: boolean, offset: number, limit: number) => ["projects", "list", { archived, offset, limit }] as const,
  detail: (id: string, offset = 0, limit = 25) => ["projects", id, "detail", { offset, limit }] as const,
  run: (id: string, runId: string) => ["projects", id, "run", runId] as const,
  compare: (id: string, b: string, r: string) => ["projects", id, "compare", b, r] as const,
};

export function useProjects(archived: boolean, offset = 0, limit = 25) {
  return useQuery({
    queryKey: pk.list(archived, offset, limit),
    queryFn: () => req<{ projects: Project[]; total: number }>(`/projects?archived=${archived}&offset=${offset}&limit=${limit}`),
    placeholderData: keepPreviousData,
  });
}

export function useProject(id: string, offset = 0, limit = 25, poll = false, archived = false) {
  return useQuery({
    queryKey: [...pk.detail(id, offset, limit), archived],
    queryFn: () => req<ProjectDetail>(`/projects/${encodeURIComponent(id)}?offset=${offset}&limit=${limit}&archived=${archived}`),
    enabled: !!id,
    refetchInterval: poll ? 2000 : false,
    placeholderData: keepPreviousData,
  });
}

export function useProjectRun(id: string, runId: string) {
  return useQuery({
    queryKey: pk.run(id, runId),
    queryFn: () => req<RunDetail>(`/projects/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`),
    enabled: !!id && !!runId,
    refetchInterval: (q) => (q.state.data?.run.status === "recording" ? 1500 : false),
  });
}

export function useProjectCompare(id: string, baselineId: string, runId: string) {
  return useQuery({
    queryKey: pk.compare(id, baselineId, runId),
    queryFn: () => req<CompareResult>(`/projects/${encodeURIComponent(id)}/compare?baselineId=${encodeURIComponent(baselineId)}&runId=${encodeURIComponent(runId)}`),
    enabled: !!id && !!baselineId && !!runId && baselineId !== runId,
  });
}

function useInvalidateProject() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ["projects", "list"] });
    if (id) qc.invalidateQueries({ queryKey: ["projects", id] });
  };
}

export function useCreateProject() {
  const inv = useInvalidateProject();
  return useMutation({ mutationFn: (data: ProjectInput) => req<Project>(`/projects`, { method: "POST", json: data }), onSuccess: () => inv() });
}
export function useUpdateProject(id: string) {
  const inv = useInvalidateProject();
  return useMutation({ mutationFn: (data: Partial<Omit<ProjectInput, "url">>) => req<Project>(`/projects/${id}`, { method: "PUT", json: data }), onSuccess: () => inv(id) });
}
export function useArchiveProject() {
  const inv = useInvalidateProject();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => req<Project>(`/projects/${id}/archive`, { method: "POST", json: { archived } }),
    onSuccess: (_d, v) => inv(v.id),
  });
}
export function useCreateSession(id: string) {
  const inv = useInvalidateProject();
  return useMutation({
    mutationFn: (data: { origin: string; purpose: "verify" | "record"; name?: string }) => req<SessionGrant>(`/projects/${id}/sessions`, { method: "POST", json: data }),
    onSuccess: () => inv(id),
  });
}
export function useRevokeSession(id: string) {
  const inv = useInvalidateProject();
  return useMutation({
    mutationFn: (data: { runId: string } | { token: string }) => req<unknown>(`/projects/${id}/sessions/revoke`, { method: "POST", json: data }),
    onSuccess: () => inv(id),
  });
}
export function useFinishRun(id: string) {
  const inv = useInvalidateProject();
  return useMutation({
    mutationFn: (runId: string) => req<unknown>(`/projects/${id}/runs/${runId}/finish`, { method: "POST", json: { complete: false } }),
    onSuccess: () => inv(id),
  });
}
export function useArchiveRun(id: string) {
  const inv = useInvalidateProject();
  return useMutation({
    mutationFn: ({ runId, archived }: { runId: string; archived: boolean }) =>
      req<unknown>(`/projects/${id}/runs/${runId}/archive`, { method: "POST", json: { archived } }),
    onSuccess: () => inv(id),
  });
}
export function useSetProjectBaseline(id: string) {
  const inv = useInvalidateProject();
  return useMutation({ mutationFn: (runId: string) => req<unknown>(`/projects/${id}/runs/${runId}/baseline`, { method: "POST" }), onSuccess: () => inv(id) });
}
export function useCreateCredential(id: string) {
  const inv = useInvalidateProject();
  return useMutation({ mutationFn: (name: string) => req<{ id: string; token: string; expiresAt: string | null }>(`/projects/${id}/credentials`, { method: "POST", json: { name } }), onSuccess: () => inv(id) });
}
export function useRevokeCredential(id: string) {
  const inv = useInvalidateProject();
  return useMutation({ mutationFn: (keyId: string) => req<unknown>(`/projects/${id}/credentials/${keyId}/revoke`, { method: "POST" }), onSuccess: () => inv(id) });
}

/** Authenticated export: fetched with the session cookie, then saved locally. */
export async function downloadRunExport(id: string, runId: string) {
  const res = await fetch(`${API}/projects/${id}/runs/${runId}/export`, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status})`);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? `tracelens-run-${runId}.json`;
  saveBlob(blob, name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export const collectorUrl = () => `${window.location.origin}${API}/collector`;
export const sdkUrl = () => `${window.location.origin}${API}/sdk.js`;
