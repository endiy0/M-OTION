import type { Live2DModel } from "pixi-live2d-display/cubism4";

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

export async function ensureCubismCore() {
  if (window.Live2DCubismCore) {
    return { ok: true };
  }
  const resp = await fetch("/live2d/live2dcubismcore.min.js", { method: "HEAD" });
  if (!resp.ok) {
    return {
      ok: false,
      message:
        "Live2D Cubism Core が見つかりません。front/public/live2d/ に live2dcubismcore.min.js を置いてください。",
    };
  }
  await loadScript("/live2d/live2dcubismcore.min.js");
  if (!window.Live2DCubismCore) {
    return {
      ok: false,
      message: "Live2D Cubism Core の読み込みに失敗しました。ブラウザのコンソールを確認してください。",
    };
  }
  return { ok: true };
}

export async function checkCubismCore() {
  const resp = await fetch("/live2d/live2dcubismcore.min.js", { method: "HEAD" });
  if (!resp.ok) {
    return {
      ok: false,
      message:
        "Live2D Cubism Core が見つかりません。Cubism SDK for Web をダウンロードし、front/public/live2d/ に live2dcubismcore.min.js をコピーしてください。",
    };
  }
  return { ok: true };
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

export async function loadLive2DModel(modelUrl: string) {
  const core = await ensureCubismCore();
  if (!core.ok) {
    throw new Error(core.message || "Live2D Cubism Core が見つかりません。");
  }
  const settings = await fetchModelJson(modelUrl);
  if (isCubism2Settings(settings) && !isCubism3Settings(settings)) {
    throw new Error(
      "Cubism 2 モデルは対応していません。Cubism 3/4/5 のランタイム書き出し（model3.json）をアップロードしてください。"
    );
  }
  if (!isCubism3Settings(settings)) {
    throw new Error("Live2Dモデルが無効です。model3.json の書き出しをアップロードしてください。");
  }
  const Live2DModel = await getLive2DModelCtor();
  return Live2DModel.from(modelUrl, { autoInteract: false });
}

export function listParameterIds(model: Live2DModel): string[] {
  type CoreModelLike = {
    getParameterIds?: () => string[];
    getParameterCount?: () => number;
    getParameterId?: (index: number) => string;
  };
  const core = model.internalModel?.coreModel as CoreModelLike | undefined;
  if (!core) return [];
  if (typeof core.getParameterIds === "function") {
    return core.getParameterIds();
  }
  if (typeof core.getParameterCount === "function" && typeof core.getParameterId === "function") {
    const count = core.getParameterCount();
    const ids = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(core.getParameterId(i));
    }
    return ids;
  }
  return [];
}

export async function resolveParameterIds(model: Live2DModel, modelUrl: string): Promise<string[]> {
  const direct = listParameterIds(model);
  if (direct.length) return direct;
  try {
    const settings = await fetchModelJson(modelUrl);
    const displayInfo = settings?.FileReferences?.DisplayInfo;
    if (!displayInfo) return [];
    const infoUrl = resolveUrl(modelUrl, displayInfo);
    const resp = await fetch(infoUrl);
    if (!resp.ok) return [];
    const data = await resp.json();
    const ids = Array.isArray(data?.Parameters)
      ? (data.Parameters as Array<{ Id?: string }>)
          .map((p) => p?.Id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

let live2DModelCtor: typeof import("pixi-live2d-display/cubism4").Live2DModel | null = null;

async function getLive2DModelCtor() {
  if (live2DModelCtor) return live2DModelCtor;
  const mod = await import("pixi-live2d-display/cubism4");
  live2DModelCtor = mod.Live2DModel;
  return live2DModelCtor;
}

async function fetchModelJson(modelUrl: string) {
  const resp = await fetch(modelUrl);
  if (!resp.ok) {
    throw new Error(`モデルJSONの読み込みに失敗しました (${resp.status}).`);
  }
  return resp.json();
}

function resolveUrl(baseUrl: string, relative: string) {
  const base = baseUrl.startsWith("http") ? baseUrl : `${window.location.origin}${baseUrl}`;
  return new URL(relative, base).toString();
}

function isCubism3Settings(json: any) {
  return (
    json &&
    typeof json === "object" &&
    json.FileReferences &&
    typeof json.FileReferences.Moc === "string" &&
    Array.isArray(json.FileReferences.Textures)
  );
}

function isCubism2Settings(json: any) {
  return json && typeof json === "object" && typeof json.model === "string";
}
