import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createSession, fetchLive2DManifest, getProject, type MappingConfig } from "../lib/api";
import CanvasStage from "../components/CanvasStage";
import {
  createCapturePipeline,
  createTrackingSocket,
  startCamera,
  type CaptureOptions,
  type TrackingResult,
} from "../lib/tracking";

type Hud = { serverFps?: number; latency?: number; localFps?: number };

export default function Live() {
  const { id } = useParams();
  const [manifest, setManifest] = useState<{ modelUrl?: string }>({});
  const [mapping, setMapping] = useState<MappingConfig | null>(null);
  const [calibration, setCalibration] = useState<Record<string, number>>({});
  const [tracking, setTracking] = useState<TrackingResult | null>(null);
  const [hud, setHud] = useState<Hud>({});
  const [wsState, setWsState] = useState<"open" | "closed" | "error" | "idle" | "reconnecting">(
    "idle"
  );
  const [coreMessage, setCoreMessage] = useState("");
  const [token, setToken] = useState("");
  const [dropped, setDropped] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loopRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);

  const wsLabelMap: Record<"open" | "closed" | "error" | "idle" | "reconnecting", string> = {
    open: "接続中",
    closed: "切断",
    error: "エラー",
    idle: "待機",
    reconnecting: "再接続中",
  };

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
      setMapping(proj.mapping || null);
      setCalibration(proj.calibration || {});
    });
    fetchLive2DManifest(id)
      .then(setManifest)
      .catch(() => setManifest({}));
  }, [id]);

  useEffect(() => {
    createSession().then(setToken);
  }, []);

  useEffect(() => {
    if (!token || !videoRef.current) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const ws = createTrackingSocket(
      token,
      (msg) => {
        setTracking(msg);
        setHud((h) => ({
          ...h,
          serverFps: msg.debug?.serverFps,
          latency: msg.debug?.latencyMs,
        }));
      },
      (state) => setWsState(state),
      () => setDropped((d) => d + 1)
    );
    const captureFrame = createCapturePipeline(captureOpts);
    startCamera(videoRef.current, captureOpts).then((s) => (stream = s));

    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      const now = performance.now();
      const frame = await captureFrame(videoRef.current, seqRef.current++);
      if (frame) ws.queueFrame(frame);
      if (lastTickRef.current) {
        const interval = now - lastTickRef.current;
        setHud((h) => ({ ...h, localFps: Math.round(1000 / Math.max(interval, 1)) }));
      }
      lastTickRef.current = now;
      loopRef.current = window.setTimeout(tick, 1000 / captureOpts.fps);
    };
    tick();

    return () => {
      cancelled = true;
      ws.close();
      if (loopRef.current) window.clearTimeout(loopRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [token, captureOpts]);

  return (
    <div className="grid">
      <div className="card">
        <h2>ライブ</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="pill">WS: {wsLabelMap[wsState]}</div>
          <div className="pill">サーバーFPS: {hud.serverFps?.toFixed(1) ?? "--"}</div>
          <div className="pill">遅延: {hud.latency ?? "--"} ms</div>
          <div className="pill">クライアントFPS: {hud.localFps ?? "--"}</div>
          <div className="pill">ドロップ: {dropped}</div>
        </div>
      </div>

      {coreMessage && <div className="card warning">{coreMessage}</div>}
      {!mapping && (
        <div className="card warning">
          パラメータマッピングが保存されていません。エディターで設定してください。
        </div>
      )}
      {!manifest.modelUrl && (
        <div className="card warning">
          Live2Dモデルが読み込まれていません。エディターでアップロードしてください。
        </div>
      )}

      <div className="card">
        <h3>Live2D レンダー (1920x1080)</h3>
        <CanvasStage
          modelUrl={manifest.modelUrl}
          mapping={mapping}
          calibration={calibration}
          tracking={tracking}
          onCoreMissing={setCoreMessage}
        />
      </div>

      <div className="card">
        <h3>ウェブカメラ</h3>
        <video ref={videoRef} style={{ width: "100%", borderRadius: 12 }} muted playsInline />
      </div>
    </div>
  );
}
