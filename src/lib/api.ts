import type {
  Project,
  ProjectSummary,
  RenderJob,
  UploadResult,
} from "../types";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "The local server is not responding. Check that it is still running.",
    );
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(
      "The API proxy is not connected. Restart the app with npm run dev, or open http://localhost:4173 after npm run build.",
      response.status,
      "api_proxy_missing",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      data?.error || "Something went wrong on the local server.",
      response.status,
      data?.code,
    );
  }
  return data as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const data = await request<{ projects: ProjectSummary[] }>("/api/projects");
  return data.projects;
}

export async function getProject(id: string): Promise<Project> {
  const data = await request<{ project: Project }>(`/api/projects/${id}`);
  return data.project;
}

export async function createProject(body: {
  name: string;
  videoUploadId?: string | null;
  musicUploadId: string;
  voiceUploadId?: string | null;
}): Promise<Project> {
  const data = await request<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.project;
}

export async function patchProject(
  id: string,
  body: Partial<{
    name: string;
    settings: Partial<Project["settings"]>;
    segments: Project["segments"];
  }>,
): Promise<Project> {
  const data = await request<{ project: Project }>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return data.project;
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/api/projects/${id}`, { method: "DELETE" });
}

export async function analyzeProject(id: string): Promise<Project> {
  const data = await request<{ project: Project }>(
    `/api/projects/${id}/analyze`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.project;
}

export function uploadFile(
  file: File,
  role: "video" | "music" | "voice",
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/uploads?role=${role}&filename=${encodeURIComponent(file.name)}`,
    );
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("The upload was interrupted. Try again."));
    xhr.onabort = () => reject(new ApiError("The upload was cancelled."));
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as UploadResult);
        return;
      }
      reject(
        new ApiError(
          data?.error || (xhr.status === 404
            ? "The upload API was not found. Restart the app with npm run dev, or open http://localhost:4173 after npm run build."
            : "That file could not be uploaded."),
          xhr.status,
          data?.code,
        ),
      );
    };
    xhr.send(file);
  });
}

export async function startExport(
  projectId: string,
  body: { format: "mp4" | "wav" | "mp3"; normalize?: boolean; mastering?: import("../types").MasteringOptions },
): Promise<RenderJob> {
  const data = await request<{ job: RenderJob }>(
    `/api/projects/${projectId}/export`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return data.job;
}

export async function getAdaptiveLevels(projectId: string, settings: Project["settings"], signal?: AbortSignal): Promise<import("../types").AdaptiveLevels> {
  const data = await request<{ levels: import("../types").AdaptiveLevels }>(`/api/projects/${projectId}/adaptive-levels`, {
    method: "POST", body: JSON.stringify({ settings }), signal,
  });
  return data.levels;
}

export async function getJob(jobId: string): Promise<RenderJob> {
  const data = await request<{ job: RenderJob }>(`/api/jobs/${jobId}`);
  return data.job;
}

export async function cancelJob(jobId: string): Promise<RenderJob> {
  const data = await request<{ job: RenderJob }>(`/api/jobs/${jobId}/cancel`, {
    method: "POST",
  });
  return data.job;
}

export async function getHealth(): Promise<{
  ok: boolean;
  vadEngine: string;
  limits: { maxDurationSeconds: number; maxFileBytes: number };
}> {
  return request("/api/health");
}
