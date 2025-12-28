import asyncio
import io
import json
import math
import os
import time
from contextlib import asynccontextmanager
from typing import Optional, List

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import mediapipe as mp
from starlette.websockets import WebSocketDisconnect

try:
  from mediapipe.tasks import python as mp_python
  from mediapipe.tasks.python import vision
except Exception as exc:  # noqa: PIE786
  raise RuntimeError("Mediapipe Tasks is required. Install via `pip install mediapipe`.") from exc

MODEL_URL = (
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)
MODEL_PATH = os.environ.get("MP_FACE_LANDMARKER_MODEL", "face_landmarker.task")

face_tracker = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
  ensure_model()
  global face_tracker  # noqa: PLW0603
  face_tracker = FaceTracker()
  yield


app = FastAPI(title="M:OTION Python Backend", lifespan=lifespan)
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.get("/health")
async def health():
  return {"status": "ok"}


@app.websocket("/ws/track")
async def ws_track(websocket: WebSocket):
  await websocket.accept()
  global face_tracker  # noqa: PLW0603
  if face_tracker is None:
    face_tracker = FaceTracker()
  while True:
    try:
      message = await websocket.receive()
      if message.get("type") == "websocket.disconnect":
        break
      if "bytes" not in message:
        continue
      raw = message["bytes"]
      header_len = int.from_bytes(raw[0:4], "little")
      header = json.loads(raw[4 : 4 + header_len].decode("utf-8"))
      jpeg_bytes = raw[4 + header_len :]
      frame_rgb = decode_jpeg(jpeg_bytes)
      ts_ms = int(header.get("ts", time.time() * 1000))
      if frame_rgb is None:
        await websocket.send_text(json.dumps(build_empty_payload(ts_ms, present=False)))
        continue
      result = await face_tracker.process(frame_rgb, ts_ms)
      payload = build_payload(result, header, face_tracker.fps())
      await websocket.send_text(json.dumps(payload))
    except WebSocketDisconnect:
      break
    except RuntimeError as exc:
      print("WS runtime error:", exc)
      break
    except Exception as exc:  # noqa: BLE001
      try:
        await websocket.send_text(json.dumps({"error": str(exc)}))
      except Exception:
        pass
      await asyncio.sleep(0.01)


def ensure_model():
  if os.path.exists(MODEL_PATH):
    return
  import urllib.request

  print("Downloading MediaPipe FaceLandmarker model...")
  urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)


class FaceTracker:
  def __init__(self):
    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = vision.FaceLandmarkerOptions(
      base_options=base_options,
      output_face_blendshapes=True,
      output_facial_transformation_matrixes=True,
      running_mode=vision.RunningMode.LIVE_STREAM,
      num_faces=1,
      result_callback=self._on_result,
    )
    self._landmarker = vision.FaceLandmarker.create_from_options(options)
    self._future: Optional[asyncio.Future] = None
    self._latest: Optional[vision.FaceLandmarkerResult] = None
    self._latest_ts = 0
    self._fps_hist = []

  def _on_result(self, result: vision.FaceLandmarkerResult, _image, timestamp_ms: int):
    self._latest = result
    self._latest_ts = timestamp_ms
    if self._future and not self._future.done():
      self._future.set_result((result, timestamp_ms))

  def fps(self):
    if len(self._fps_hist) < 2:
      return 0.0
    dt = self._fps_hist[-1] - self._fps_hist[0]
    if dt <= 0:
      return 0.0
    return (len(self._fps_hist) - 1) / (dt / 1000.0)

  async def process(self, frame_rgb: np.ndarray, ts_ms: int):
    loop = asyncio.get_running_loop()
    self._future = loop.create_future()
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
    self._landmarker.detect_async(mp_image, ts_ms)
    try:
      result, ts = await asyncio.wait_for(self._future, timeout=1.0)
      self._fps_hist.append(ts)
      if len(self._fps_hist) > 30:
        self._fps_hist.pop(0)
      return result
    except asyncio.TimeoutError:
      return None


def decode_jpeg(jpeg_bytes: bytes) -> Optional[np.ndarray]:
  data = np.frombuffer(jpeg_bytes, dtype=np.uint8)
  img_bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
  if img_bgr is None:
    try:
      pil_img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
      return np.array(pil_img)
    except Exception:
      return None
  return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def blendshape_lookup(blendshapes, name: str) -> float:
  if not blendshapes:
    return 0.0
  for entry in blendshapes[0]:
    if entry.category_name == name:
      return float(entry.score)
  return 0.0


def build_empty_payload(ts_ms: int, present: bool):
  return {
    "ts": ts_ms,
    "present": present,
    "pose": {"yawDeg": 0, "pitchDeg": 0, "rollDeg": 0},
    "eye": {"leftOpen": 1.0, "rightOpen": 1.0},
    "mouth": {"open": 0.0, "smile": 0.0},
    "brow": {"leftUp": 0.0, "rightUp": 0.0},
    "debug": {"serverFps": 0, "latencyMs": 0},
  }


def build_payload(result, header, fps_server: float):
  ts_ms = int(header.get("ts", time.time() * 1000))
  payload = build_empty_payload(ts_ms, present=False)
  payload["debug"]["serverFps"] = fps_server
  if not result or len(result.face_landmarks) == 0:
    return payload
  payload["present"] = True
  blend = result.face_blendshapes
  payload["eye"]["leftOpen"] = max(0.0, 1.0 - blendshape_lookup(blend, "eyeBlinkLeft"))
  payload["eye"]["rightOpen"] = max(0.0, 1.0 - blendshape_lookup(blend, "eyeBlinkRight"))
  payload["mouth"]["open"] = min(1.0, blendshape_lookup(blend, "jawOpen"))
  smile_left = blendshape_lookup(blend, "mouthSmileLeft")
  smile_right = blendshape_lookup(blend, "mouthSmileRight")
  payload["mouth"]["smile"] = (smile_left + smile_right) * 0.5
  payload["brow"]["leftUp"] = max(
    blendshape_lookup(blend, "browInnerUp"), blendshape_lookup(blend, "browOuterUpLeft")
  )
  payload["brow"]["rightUp"] = max(
    blendshape_lookup(blend, "browInnerUp"), blendshape_lookup(blend, "browOuterUpRight")
  )

  if result.facial_transformation_matrixes:
    yaw, pitch, roll = extract_pose_from_matrix(result.facial_transformation_matrixes[0])
  else:
    yaw, pitch, roll = estimate_pose_from_landmarks(result.face_landmarks[0])
  payload["pose"] = {"yawDeg": yaw, "pitchDeg": pitch, "rollDeg": roll}

  if header.get("ts"):
    payload["debug"]["latencyMs"] = max(0, int(time.time() * 1000) - int(header["ts"]))
  return payload


def extract_pose_from_matrix(matrix) -> List[float]:
  m = np.array(matrix).reshape((4, 4))
  r = m[:3, :3]
  sy = math.sqrt(r[0, 0] * r[0, 0] + r[1, 0] * r[1, 0])
  singular = sy < 1e-6
  if not singular:
    pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
    yaw = math.degrees(math.atan2(-r[2, 0], sy))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
  else:
    pitch = math.degrees(math.atan2(-r[1, 2], r[1, 1]))
    yaw = math.degrees(math.atan2(-r[2, 0], sy))
    roll = 0
  return [yaw, pitch, roll]


def estimate_pose_from_landmarks(landmarks) -> List[float]:
  left_eye = np.array([landmarks[33].x, landmarks[33].y, landmarks[33].z])
  right_eye = np.array([landmarks[263].x, landmarks[263].y, landmarks[263].z])
  nose = np.array([landmarks[1].x, landmarks[1].y, landmarks[1].z])
  eye_vec = right_eye - left_eye
  yaw = math.degrees(math.atan2(eye_vec[2], eye_vec[0]))
  pitch = math.degrees(math.atan2(nose[2], eye_vec[1]))
  roll = math.degrees(math.atan2(eye_vec[1], eye_vec[0]))
  return [yaw, pitch, roll]


if __name__ == "__main__":
  uvicorn.run(
    "pyserver:app",
    host="0.0.0.0",
    port=int(os.environ.get("PORT", 8001)),
    reload=False,
  )
