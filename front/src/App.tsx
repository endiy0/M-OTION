import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Editor from "./pages/Editor";
import Live from "./pages/Live";
import { checkCubismCore } from "./lib/live2d";

export default function App() {
  const [coreWarning, setCoreWarning] = useState("");

  useEffect(() => {
    checkCubismCore().then((res) => {
      if (!res.ok) setCoreWarning(res.message || "Live2D Cubism Core が見つかりません。");
    });
  }, []);

  return (
    <div className="layout">
      <header>
        <div className="brand">
          <div className="pill">M:OTION</div>
          <div>Live2D ランタイムプレイヤー + トラッキングドライバ</div>
        </div>
        <nav className="nav">
          <Link to="/">ホーム</Link>
        </nav>
      </header>
      <main>
        {coreWarning && <div className="card warning">{coreWarning}</div>}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/editor/:id" element={<Editor />} />
          <Route path="/live/:id" element={<Live />} />
        </Routes>
      </main>
    </div>
  );
}
