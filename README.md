# M:OTION - Live2D Runtime Player + Tracking Driver

M:OTION is a monorepo that lets you upload a Live2D runtime export (model3.json + moc3 + textures), render it in the browser at **1920x1080**, and drive parameters using face tracking computed on the Python backend.

## Prerequisites
- Node.js 18+ and npm
- Python 3.10+ with `pip`
- Webcam access in Chrome

## Install
```bash
npm install
npm install --prefix front
pip install -r pyserver/requirements.txt
```

## Run (local dev)
```bash
npm run dev
# starts:
# - node server.js (http://localhost:3000, WS /ws/client)
# - Vite dev server on 5173 (proxy /api + /ws)
# - FastAPI + uvicorn on 8001
```

## Build & serve (production-ish)
```bash
npm run build
cd pyserver && python pyserver.py &
PORT=3000 node server.js
```

## Live2D Cubism Core (bring-your-own)
Do NOT commit proprietary Live2D Cubism Core files into this repo.  
You must download the Cubism SDK for Web yourself and place the runtime JS in:

```
front/public/live2d/live2dcubismcore.min.js
```

The app checks for that file at startup and shows a clear UI error if it is missing.

## Sample models (legal sources)
Do NOT bundle Live2D sample assets in this repo.  
Use one of the official sources and upload the runtime export ZIP/RAR:
- Live2D "Sample Data" page (official downloads)
- Cubism SDK for Web `Samples/Resources` (use the runtime export folder)

## Data layout
```
data/projects/<id>/
  project.json
  live2d/
    <modelName>.model3.json
    <modelName>.moc3
    textures/*.png
    physics3.json (optional)
    expressions/*.exp3.json (optional)
    motions/*.motion3.json (optional)
data/projects.db
```

## API overview
- `POST /api/session` -> `{ token }`
- `POST /api/projects` -> `{ id }`
- `GET /api/projects` -> list
- `GET /api/projects/:id` -> project.json
- `PUT /api/projects/:id` -> update project.json
- `POST /api/projects/:id/live2d/upload` -> upload ZIP/RAR and unpack into `live2d/`
- `GET /api/projects/:id/live2d/manifest` -> `{ modelUrl, modelList }`
- `POST /api/projects/:id/autoconfig` -> save mapping + calibration
- `WS /ws/client` -> browser tracking WS (bridged to Python)

## Tracking transport
Browser -> Node -> Python uses a binary packet:
- 4-byte uint32 header length (LE)
- JSON header (utf-8) `{ ts, width, height, format:"jpeg", quality, seq }`
- JPEG payload

Python -> Node -> Browser returns JSON:
```
{
  "ts": 123,
  "present": true,
  "pose": { "yawDeg": 0, "pitchDeg": 0, "rollDeg": 0 },
  "eye": { "leftOpen": 0.9, "rightOpen": 0.9 },
  "mouth": { "open": 0.2, "smile": 0.1 },
  "brow": { "leftUp": 0.1, "rightUp": 0.1 },
  "debug": { "serverFps": 12.0, "latencyMs": 40 }
}
```

## Public deployment checklist
1) `npm run build`
2) Run Python: `python pyserver.py`
3) Run Node: `PORT=3000 node server.js`
4) Put nginx/caddy in front with TLS and WS upgrade for `/ws/client`.
5) Set env:
   - `ALLOWED_ORIGINS="https://yourdomain.com"`
   - `PY_BASE=http://localhost:8001`
   - `PY_WS=ws://localhost:8001`
6) Persist `./data` and `data/projects.db`.

## Notes
- The canvas internal resolution is fixed at **1920x1080** and scales to fit the viewport.
- Tracking is server-side only (one face). Default capture is 640x360 @ 12 FPS with JPEG quality 0.6.
- Live2D model generation is **not** performed by this app; users must upload runtime exports.
