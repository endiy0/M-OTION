import type { MappingConfig, TrackingChannel } from "../lib/api";

type Props = {
  paramIds: string[];
  mapping: MappingConfig;
  onChange: (mapping: MappingConfig) => void;
  onCalibrate: () => void;
  onSave: () => void;
};

const channelLabels: Record<TrackingChannel, string> = {
  headYaw: "頭ヨー",
  headPitch: "頭ピッチ",
  headRoll: "頭ロール",
  eyeLOpen: "左目 開き",
  eyeROpen: "右目 開き",
  mouthOpen: "口 開き",
  mouthSmile: "口 スマイル",
  browL: "左眉 上げ",
  browR: "右眉 上げ",
};

export default function ParameterMapper({ paramIds, mapping, onChange, onCalibrate, onSave }: Props) {
  const update = (channel: TrackingChannel, key: keyof MappingConfig[TrackingChannel], value: any) => {
    onChange({
      ...mapping,
      [channel]: {
        ...mapping[channel],
        [key]: value,
      },
    });
  };

  return (
    <div className="card">
      <h3>パラメータマッピング</h3>
      <div className="grid">
        {Object.keys(mapping).map((channel) => {
          const key = channel as TrackingChannel;
          const cfg = mapping[key];
          return (
            <div key={key} className="card">
              <div style={{ fontWeight: 600 }}>{channelLabels[key]}</div>
              <label>パラメータID</label>
              <select
                value={cfg.paramId}
                onChange={(e) => update(key, "paramId", e.target.value)}
              >
                <option value="">-- なし --</option>
                {paramIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="grid two" style={{ marginTop: 8 }}>
                <div>
                  <label>ゲイン</label>
                  <input
                    type="number"
                    step="0.1"
                    value={cfg.gain}
                    onChange={(e) => update(key, "gain", Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>スムージング</label>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={cfg.smooth}
                    onChange={(e) => update(key, "smooth", Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>クランプ最小</label>
                  <input
                    type="number"
                    value={cfg.clamp[0]}
                    onChange={(e) => update(key, "clamp", [Number(e.target.value), cfg.clamp[1]])}
                  />
                </div>
                <div>
                  <label>クランプ最大</label>
                  <input
                    type="number"
                    value={cfg.clamp[1]}
                    onChange={(e) => update(key, "clamp", [cfg.clamp[0], Number(e.target.value)])}
                  />
                </div>
                <div>
                  <label>デッドゾーン</label>
                  <input
                    type="number"
                    step="0.05"
                    value={cfg.deadzone}
                    onChange={(e) => update(key, "deadzone", Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>反転</label>
                  <select value={cfg.invert ? "yes" : "no"} onChange={(e) => update(key, "invert", e.target.value === "yes")}>
                    <option value="no">いいえ</option>
                    <option value="yes">はい</option>
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={onCalibrate}>ニュートラルを記録</button>
        <button onClick={onSave}>マッピングを保存</button>
      </div>
    </div>
  );
}
