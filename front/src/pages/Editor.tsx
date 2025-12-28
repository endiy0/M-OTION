import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createSession,
  fetchLive2DManifest,
  getProject,
  saveMapping,
  saveProject,
  type MappingConfig,
  type Project,
  type Calibration,
} from "../lib/api";
import ModelUploader from "../components/ModelUploader";
import ParameterMapper from "../components/ParameterMapper";
import CanvasStage from "../components/CanvasStage";
import { calibrateFromTracking, defaultMapping } from "../lib/paramMapping";
import type { TrackingResult, CaptureOptions } from "../lib/tracking";
import { createCapturePipeline, createTrackingSocket, startCamera } from "../lib/tracking";

export default function Editor() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [manifest, setManifest] = useState<{ modelUrl?: string; modelList?: string[] }>({});
  const [paramIds, setParamIds] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingConfig | null>(null);
  const [calibration, setCalibration] = useState<Calibration>({});
  const [coreMessage, setCoreMessage] = useState<string>("");
  const [tracking, setTracking] = useState<TrackingResult | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [token, setToken] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loopRef = useRef<number | null>(null);

  const captureOpts: CaptureOptions = useMemo(
    () => ({
      width: 640,
      height: 360,
      fps: 12,
      quality: 0.6,
    }),
    []
  );

  useEffect(() => {
    if (!id) return;
    getProject(id).then((proj) => {
      setProject(proj);
      if (proj.mapping) setMapping(proj.mapping);
      if (proj.calibration) setCalibration(proj.calibration);
    });
    fetchLive2DManifest(id)
      .then(setManifest)
      .catch(() => setManifest({}));
  }, [id]);

  useEffect(() => {
    createSession().then(setToken);
  }, []);

  useEffect(() => {
    if (!trackingEnabled || !token || !videoRef.current) return;
    let stream: MediaStream | null = null;
    const ws = createTrackingSocket(token, setTracking);
    const captureFrame = createCapturePipeline(captureOpts);
    let seq = 0;
    let cancelled = false;

    startCamera(videoRef.current, captureOpts).then((s) => (stream = s));
    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      const frame = await captureFrame(videoRef.current, seq++);
      if (frame) ws.queueFrame(frame);
      loopRef.current = window.setTimeout(tick, 1000 / captureOpts.fps);
    };
    tick();

    return () => {
      cancelled = true;
      ws.close();
      if (loopRef.current) window.clearTimeout(loopRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [trackingEnabled, token, captureOpts]);

  const handleModelUploaded = async () => {
    if (!id) return;
    const proj = await getProject(id);
    setProject(proj);
    const mf = await fetchLive2DManifest(id);
    setManifest(mf);
  };

  const handleParams = (params: string[]) => {
    setParamIds(params);
    if (!mapping) {
      setMapping(defaultMapping(params));
    }
  };

  const handleSave = async () => {
    if (!id || !mapping) return;
    await saveMapping(id, mapping, calibration);
    const proj = await getProject(id);
    setProject(proj);
  };

  const handleCalibrate = () => {
    const baseline = calibrateFromTracking(tracking);
    setCalibration(baseline);
  };

  const handleSelectModel = async (path: string) => {
    if (!project || !id) return;
    const updated = {
      ...project,
      live2d: {
        ...(project.live2d || {}),
        modelPath: path,
      },
    };
    await saveProject(id, updated);
    setProject(updated);
    const mf = await fetchLive2DManifest(id);
    setManifest(mf);
  };

  return (
    <div className="grid">
      <div className="card">
        <h2>エディター</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div>プロジェクト: {project?.name}</div>
          <label style={{ marginLeft: "auto" }}>
            <input
              type="checkbox"
              checked={trackingEnabled}
              onChange={(e) => setTrackingEnabled(e.target.checked)}
            />
            キャリブレーション用トラッキングを有効化
          </label>
        </div>
        <video ref={videoRef} style={{ width: 1, height: 1, opacity: 0 }} />
      </div>

      <ModelUploader projectId={id || ""} onUploaded={handleModelUploaded} />

      {manifest.modelList && manifest.modelList.length > 1 && (
        <div className="card">
          <h3>model3.json を選択</h3>
          <select
            value={project?.live2d?.modelPath || ""}
            onChange={(e) => handleSelectModel(e.target.value)}
          >
            {manifest.modelList.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {coreMessage && <div className="card warning">{coreMessage}</div>}

      <div className="card">
        <h3>モデルプレビュー</h3>
        <CanvasStage
          modelUrl={manifest.modelUrl}
          mapping={mapping}
          calibration={calibration}
          tracking={tracking}
          onParams={handleParams}
          onCoreMissing={setCoreMessage}
        />
      </div>

      {paramIds.length > 0 && (
        <div className="card">
          <h3>検出されたパラメータID</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {paramIds.map((id) => (
              <div key={id} className="pill">
                {id}
              </div>
            ))}
          </div>
        </div>
      )}

      {mapping && (
        <ParameterMapper
          paramIds={paramIds}
          mapping={mapping}
          onChange={setMapping}
          onCalibrate={handleCalibrate}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
