export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  live2d?: {
    modelPath?: string;
    modelList?: string[];
    updatedAt?: number;
  };
  mapping?: MappingConfig;
  calibration?: Calibration;
};

export type TrackingChannel =
  | "headYaw"
  | "headPitch"
  | "headRoll"
  | "eyeLOpen"
  | "eyeROpen"
  | "mouthOpen"
  | "mouthSmile"
  | "browL"
  | "browR";

export type ChannelConfig = {
  paramId: string;
  gain: number;
  clamp: [number, number];
  smooth: number;
  deadzone: number;
  invert: boolean;
};

export type MappingConfig = Record<TrackingChannel, ChannelConfig>;

export type Calibration = Partial<Record<TrackingChannel, number>>;

export type ProjectRow = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

const jsonHeaders = { "Content-Type": "application/json" };

export async function createSession(): Promise<string> {
  const resp = await fetch("/api/session", { method: "POST" });
  const data = await resp.json();
  return data.token;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const resp = await fetch("/api/projects");
  return resp.json();
}

export async function createProject(name: string): Promise<{ id: string }> {
  const resp = await fetch("/api/projects", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  });
  return resp.json();
}

export async function getProject(id: string): Promise<Project> {
  const resp = await fetch(`/api/projects/${id}`);
  if (!resp.ok) throw new Error("プロジェクトが見つかりません。");
  return resp.json();
}

export async function saveProject(id: string, project: Project) {
  const resp = await fetch(`/api/projects/${id}`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(project),
  });
  if (!resp.ok) throw new Error("保存に失敗しました。");
}

export async function deleteProject(id: string) {
  const resp = await fetch(`/api/projects/${id}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error("Failed to delete project.");
}

export async function uploadLive2DZip(id: string, file: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  const resp = await fetch(`/api/projects/${id}/live2d/upload`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function fetchLive2DManifest(id: string) {
  const resp = await fetch(`/api/projects/${id}/live2d/manifest`);
  if (!resp.ok) throw new Error("モデルのマニフェストが見つかりません。");
  return resp.json();
}

export async function saveMapping(id: string, mapping: MappingConfig, calibration: Calibration) {
  const resp = await fetch(`/api/projects/${id}/autoconfig`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ mapping, calibration }),
  });
  if (!resp.ok) throw new Error("マッピングの保存に失敗しました。");
}
