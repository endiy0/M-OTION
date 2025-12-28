export type TrackingResult = {
  ts: number;
  present?: boolean;
  pose?: { yawDeg: number; pitchDeg: number; rollDeg: number };
  eye?: { leftOpen: number; rightOpen: number };
  mouth?: { open: number; smile: number };
  brow?: { leftUp: number; rightUp: number };
  debug?: { serverFps?: number; latencyMs?: number };
  error?: string;
};

export type CaptureOptions = {
  width: number;
  height: number;
  fps: number;
  quality: number;
};

export function createTrackingSocket(
  token: string,
  onResult: (result: TrackingResult) => void,
  onStatus?: (state: "open" | "closed" | "error") => void,
  onDrop?: () => void
) {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${window.location.host}/ws/client?token=${encodeURIComponent(token)}`;
  let ws: WebSocket | null = null;
  let open = false;
  let busy = false;
  let pending: ArrayBuffer | null = null;
  let manualClose = false;
  let reconnectTimer: number | null = null;
  let reconnectDelay = 500;
  let busyTimer: number | null = null;

  const clearBusyTimer = () => {
    if (busyTimer) {
      window.clearTimeout(busyTimer);
      busyTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (manualClose || reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 4000);
  };

  const flush = () => {
    if (!open || busy || !pending) return;
    ws?.send(pending);
    busy = true;
    clearBusyTimer();
    busyTimer = window.setTimeout(() => {
      busy = false;
      flush();
    }, 2000);
    pending = null;
  };

  const connect = () => {
    if (manualClose) return;
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      open = true;
      reconnectDelay = 500;
      onStatus?.("open");
      flush();
    };
    ws.onclose = () => {
      open = false;
      busy = false;
      clearBusyTimer();
      onStatus?.("closed");
      scheduleReconnect();
    };
    ws.onerror = () => {
      open = false;
      busy = false;
      clearBusyTimer();
      onStatus?.("error");
      scheduleReconnect();
    };
    ws.onmessage = (event) => {
      busy = false;
      clearBusyTimer();
      try {
        const parsed = JSON.parse(event.data);
        onResult(parsed);
      } catch (err) {
        console.warn("Failed to parse tracking result", err);
      }
      flush();
    };
  };

  connect();

  return {
    queueFrame: (frame: ArrayBuffer) => {
      if (manualClose) return;
      if (busy && pending) {
        onDrop?.();
      }
      pending = frame;
      flush();
    },
    close: () => {
      manualClose = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      clearBusyTimer();
      ws?.close();
    },
  };
}

export async function startCamera(video: HTMLVideoElement, opts: CaptureOptions) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: opts.width },
      height: { ideal: opts.height },
      frameRate: { ideal: opts.fps },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function createCapturePipeline(opts: CaptureOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  return async (video: HTMLVideoElement, seq: number): Promise<ArrayBuffer | null> => {
    if (!ctx || video.readyState < 2) return null;
    ctx.drawImage(video, 0, 0, opts.width, opts.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        (b) => resolve(b),
        "image/jpeg",
        Math.min(Math.max(opts.quality, 0.2), 0.95)
      )
    );
    if (!blob) return null;
    const jpegBuffer = await blob.arrayBuffer();
    const header = {
      ts: Date.now(),
      width: opts.width,
      height: opts.height,
      format: "jpeg",
      quality: opts.quality,
      seq,
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const payload = new Uint8Array(4 + headerBytes.length + jpegBuffer.byteLength);
    new DataView(payload.buffer).setUint32(0, headerBytes.length, true);
    payload.set(headerBytes, 4);
    payload.set(new Uint8Array(jpegBuffer), 4 + headerBytes.length);
    return payload.buffer;
  };
}
