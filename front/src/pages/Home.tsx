import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createProject, deleteProject, listProjects, type ProjectRow } from "../lib/api";

export default function Home() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [name, setName] = useState("新規Live2Dプロジェクト");
  const navigate = useNavigate();

  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  const handleCreate = async () => {
    const res = await createProject(name);
    navigate(`/editor/${res.id}`);
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm("本当に削除しますか？戻すことはできません。");
    if (!confirmed) return;
    await deleteProject(id);
    const updated = await listProjects();
    setProjects(updated);
  };

  return (
    <div className="grid">
      <div className="card">
        <h2>プロジェクト作成</h2>
        <label>プロジェクト名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <button onClick={handleCreate}>作成してエディターを開く</button>
        </div>
      </div>
      <div className="card">
        <h2>プロジェクト一覧</h2>
        <div className="grid two">
          {projects.map((p) => (
            <div key={p.id} className="card">
              <div style={{ fontWeight: 600 }}>{p.name || "無題"}</div>
              <div style={{ fontSize: 12, color: "#9aa7b8" }}>{p.id}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <Link to={`/editor/${p.id}`}>
                  <button>エディター</button>
                </Link>
                <Link to={`/live/${p.id}`}>
                  <button>ライブ</button>
                </Link>
                <button onClick={() => handleDelete(p.id)}>削除</button>
              </div>
            </div>
          ))}
          {projects.length === 0 && <div>プロジェクトがありません。</div>}
        </div>
      </div>
    </div>
  );
}
