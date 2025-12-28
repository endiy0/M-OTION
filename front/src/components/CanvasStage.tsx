import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";
import type { MappingConfig, Calibration } from "../lib/api";
import type { TrackingResult } from "../lib/tracking";
import { applyMapping, createFilterState } from "../lib/paramMapping";
import { ensureCubismCore, loadLive2DModel, resolveParameterIds } from "../lib/live2d";

type Props = {
  modelUrl?: string;
  mapping: MappingConfig | null;
  calibration: Calibration;
  tracking: TrackingResult | null;
  onParams?: (params: string[]) => void;
  onCoreMissing?: (message: string) => void;
};

export default function CanvasStage({
  modelUrl,
  mapping,
  calibration,
  tracking,
  onParams,
  onCoreMissing,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const mappingRef = useRef<MappingConfig | null>(mapping);
  const trackingRef = useRef<TrackingResult | null>(tracking);
  const calibrationRef = useRef<Calibration>(calibration);
  const filterRef = useRef(createFilterState());
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    mappingRef.current = mapping;
  }, [mapping]);

  useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  useEffect(() => {
    calibrationRef.current = calibration;
  }, [calibration]);

  useEffect(() => {
    const app = new PIXI.Application({
      width: 1920,
      height: 1080,
      backgroundAlpha: 0,
      antialias: true,
    });
    appRef.current = app;
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(app.view as HTMLCanvasElement);
      (app.view as HTMLCanvasElement).style.width = "100%";
      (app.view as HTMLCanvasElement).style.height = "100%";
    }

    app.ticker.add(() => {
      if (!modelRef.current || !mappingRef.current) return;
      applyMapping(
        modelRef.current,
        trackingRef.current,
        mappingRef.current,
        filterRef.current,
        calibrationRef.current as Record<string, number>
      );
    });

    return () => {
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!modelUrl || !appRef.current) {
        setStatus("モデルが読み込まれていません。");
        return;
      }
      setStatus("Live2Dモデルを読み込み中...");
      const core = await ensureCubismCore();
      if (!core.ok) {
        const message = core.message || "Live2D Core が見つかりません。";
        setStatus(message);
        onCoreMissing?.(message);
        return;
      }
      try {
        const model = await loadLive2DModel(modelUrl);
        if (cancelled || !appRef.current) return;
        if (modelRef.current) {
          appRef.current.stage.removeChild(modelRef.current);
          modelRef.current.destroy();
        }
        modelRef.current = model;
        model.interactive = false;
        appRef.current.stage.addChild(model);
        fitToStage(model, 1920, 1080);
        const params = await resolveParameterIds(model, modelUrl);
        onParams?.(params);
        setStatus("");
      } catch (err: any) {
        setStatus(err.message || "モデルの読み込みに失敗しました。");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [modelUrl, onParams, onCoreMissing]);

  return (
    <div className="stage-shell">
      <div className="stage-canvas" ref={containerRef} />
      {status && <div className="stage-overlay">{status}</div>}
    </div>
  );
}

function fitToStage(model: Live2DModel, width: number, height: number) {
  const bounds = model.getBounds();
  const scale = Math.min(width / bounds.width, height / bounds.height) * 0.9;
  model.scale.set(scale, scale);
  const next = model.getBounds();
  model.position.set(
    (width - next.width) / 2 - next.x,
    (height - next.height) / 2 - next.y
  );
}
