import { useState } from "react";
import { uploadLive2DZip } from "../lib/api";

type Props = {
  projectId: string;
  onUploaded: () => void;
};

export default function ModelUploader({ projectId, onUploaded }: Props) {
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const handleUpload = async (file: File) => {
    setBusy(true);
    setStatus("");
    try {
      await uploadLive2DZip(projectId, file);
      setStatus("アップロード完了。");
      onUploaded();
    } catch (err: any) {
      setStatus(`アップロードに失敗しました: ${err.message || err.toString()}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Live2Dモデルのアップロード</h3>
      <p>
        Live2Dランタイム書き出し（model3.json + moc3 + textures）を含む ZIP または RAR をアップロードしてください。
      </p>
      <input
        type="file"
        accept=".zip,.rar"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
      {status && <div style={{ marginTop: 8, fontSize: 12 }}>{status}</div>}
    </div>
  );
}
