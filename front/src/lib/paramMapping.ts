import type { MappingConfig, TrackingChannel } from "./api";
import type { TrackingResult } from "./tracking";

export type FilterState = Record<TrackingChannel, number>;

const channelOrder: TrackingChannel[] = [
  "headYaw",
  "headPitch",
  "headRoll",
  "eyeLOpen",
  "eyeROpen",
  "mouthOpen",
  "mouthSmile",
  "browL",
  "browR",
];

export function defaultMapping(paramIds: string[]): MappingConfig {
  const find = (candidates: string[]) =>
    paramIds.find((id) => candidates.some((c) => id.toLowerCase() === c.toLowerCase())) || "";
  return {
    headYaw: {
      paramId: find(["ParamAngleX"]),
      gain: 1,
      clamp: [-30, 30],
      smooth: 0.35,
      deadzone: 0.1,
      invert: false,
    },
    headPitch: {
      paramId: find(["ParamAngleY"]),
      gain: 1,
      clamp: [-30, 30],
      smooth: 0.35,
      deadzone: 0.1,
      invert: false,
    },
    headRoll: {
      paramId: find(["ParamAngleZ"]),
      gain: 1,
      clamp: [-30, 30],
      smooth: 0.35,
      deadzone: 0.1,
      invert: false,
    },
    eyeLOpen: {
      paramId: find(["ParamEyeLOpen", "ParamEyeOpenL"]),
      gain: 1,
      clamp: [0, 1],
      smooth: 0.2,
      deadzone: 0,
      invert: false,
    },
    eyeROpen: {
      paramId: find(["ParamEyeROpen", "ParamEyeOpenR"]),
      gain: 1,
      clamp: [0, 1],
      smooth: 0.2,
      deadzone: 0,
      invert: false,
    },
    mouthOpen: {
      paramId: find(["ParamMouthOpenY"]),
      gain: 1,
      clamp: [0, 1],
      smooth: 0.25,
      deadzone: 0,
      invert: false,
    },
    mouthSmile: {
      paramId: find(["ParamMouthForm", "ParamMouthSmile"]),
      gain: 1,
      clamp: [-1, 1],
      smooth: 0.25,
      deadzone: 0,
      invert: false,
    },
    browL: {
      paramId: find(["ParamBrowLY", "ParamBrowL"]),
      gain: 1,
      clamp: [0, 1],
      smooth: 0.3,
      deadzone: 0,
      invert: false,
    },
    browR: {
      paramId: find(["ParamBrowRY", "ParamBrowR"]),
      gain: 1,
      clamp: [0, 1],
      smooth: 0.3,
      deadzone: 0,
      invert: false,
    },
  };
}

export function createFilterState(): FilterState {
  return channelOrder.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as FilterState);
}

export function applyMapping(
  model: any,
  tracking: TrackingResult | null,
  mapping: MappingConfig,
  filterState: FilterState,
  calibration: Record<string, number>
) {
  if (!tracking || tracking.present === false) return;
  const coreModel = model?.internalModel?.coreModel;
  if (!coreModel) return;
  const values: Record<TrackingChannel, number> = {
    headYaw: tracking.pose?.yawDeg ?? 0,
    headPitch: tracking.pose?.pitchDeg ?? 0,
    headRoll: tracking.pose?.rollDeg ?? 0,
    eyeLOpen: tracking.eye?.leftOpen ?? 1,
    eyeROpen: tracking.eye?.rightOpen ?? 1,
    mouthOpen: tracking.mouth?.open ?? 0,
    mouthSmile: tracking.mouth?.smile ?? 0,
    browL: tracking.brow?.leftUp ?? 0,
    browR: tracking.brow?.rightUp ?? 0,
  };

  for (const channel of channelOrder) {
    const cfg = mapping[channel];
    if (!cfg || !cfg.paramId) continue;
    let v = values[channel] - (calibration[channel] ?? 0);
    if (cfg.invert) v *= -1;
    v *= cfg.gain;
    if (Math.abs(v) < cfg.deadzone) v = 0;
    v = Math.max(cfg.clamp[0], Math.min(cfg.clamp[1], v));
    const alpha = cfg.smooth;
    const next = filterState[channel] * (1 - alpha) + v * alpha;
    filterState[channel] = next;
    coreModel.setParameterValueById(cfg.paramId, next);
  }
  if (typeof coreModel.update === "function") {
    coreModel.update();
  }
}

export function calibrateFromTracking(tracking: TrackingResult | null) {
  if (!tracking) return {};
  return {
    headYaw: tracking.pose?.yawDeg ?? 0,
    headPitch: tracking.pose?.pitchDeg ?? 0,
    headRoll: tracking.pose?.rollDeg ?? 0,
    eyeLOpen: tracking.eye?.leftOpen ?? 1,
    eyeROpen: tracking.eye?.rightOpen ?? 1,
    mouthOpen: tracking.mouth?.open ?? 0,
    mouthSmile: tracking.mouth?.smile ?? 0,
    browL: tracking.brow?.leftUp ?? 0,
    browR: tracking.brow?.rightUp ?? 0,
  };
}
