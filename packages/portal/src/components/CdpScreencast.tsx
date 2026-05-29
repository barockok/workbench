import { useEffect, useRef, useState } from "react";

interface Props {
  // Relative path to the proxy WS, e.g. /api/auth/cookie/<int>/cdp.
  // No secrets in the URL — the client sends an auth handshake as the
  // first frame instead.
  cdpProxyUrl: string;
  sessionId: string;
  cdpToken: string;
  // Width of the rendered view (height keeps aspect ratio from chromium frames).
  width: number;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/**
 * Render a live screencast of the server-side Chromium and forward mouse +
 * keyboard input back over the same CDP socket so the user can complete a
 * login flow on a remote browser without exposing it directly.
 */
export default function CdpScreencast({ cdpProxyUrl, sessionId, cdpToken, width }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cmdIdRef = useRef(1);
  const remoteSizeRef = useRef({ width: 0, height: 0 });
  const readyRef = useRef(false);
  const [status, setStatus] = useState<"connecting" | "live" | "closed" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}${cdpProxyUrl}`);
    wsRef.current = ws;

    function send(method: string, params: Record<string, unknown> = {}): number {
      const id = cmdIdRef.current++;
      ws.send(JSON.stringify({ id, method, params }));
      return id;
    }

    ws.onopen = () => {
      // First frame is the auth handshake — the URL carries no secrets.
      // We also include the user's portal bearer so the server can verify
      // the WS caller is the same user who opened the cookie session.
      const bearer = localStorage.getItem("awb_token") ?? "";
      ws.send(JSON.stringify({ type: "auth", sessionId, cdpToken, bearer }));
    };

    ws.onmessage = async (ev) => {
      let msg: CdpMessage & { type?: string };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : await new Response(ev.data).text());
      } catch {
        return;
      }
      if (msg.type === "ready" && !readyRef.current) {
        readyRef.current = true;
        setStatus("live");
        send("Page.enable");
        send("Runtime.enable");
        send("Page.startScreencast", {
          format: "jpeg",
          quality: 70,
          maxWidth: 1280,
          maxHeight: 900,
          everyNthFrame: 1,
        });
        return;
      }
      if (msg.method === "Page.screencastFrame") {
        const params = msg.params as
          | { data: string; metadata?: { deviceWidth?: number; deviceHeight?: number }; sessionId: number }
          | undefined;
        if (!params) return;
        if (params.metadata?.deviceWidth) {
          remoteSizeRef.current = {
            width: params.metadata.deviceWidth,
            height: params.metadata.deviceHeight ?? remoteSizeRef.current.height,
          };
        }
        drawFrame(params.data);
        ws.send(
          JSON.stringify({
            id: cmdIdRef.current++,
            method: "Page.screencastFrameAck",
            params: { sessionId: params.sessionId },
          })
        );
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket error");
    };
    ws.onclose = (ev) => {
      setStatus("closed");
      if (ev.code === 4401) setError("Unauthorized");
    };

    function drawFrame(b64: string) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const img = new Image();
      img.onload = () => {
        if (canvas.width !== img.width) canvas.width = img.width;
        if (canvas.height !== img.height) canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${b64}`;
    }

    return () => {
      try {
        ws.close();
      } catch {
        // noop
      }
    };
  }, [cdpProxyUrl, sessionId, cdpToken]);

  // Translate a DOM event on the canvas into chromium coordinates.
  function canvasToRemote(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function dispatchMouse(
    type: "mousePressed" | "mouseReleased" | "mouseMoved",
    e: React.MouseEvent<HTMLCanvasElement>
  ) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = canvasToRemote(e);
    const buttonMap: Record<number, string> = { 0: "left", 1: "middle", 2: "right" };
    const button = buttonMap[e.button] ?? "none";
    ws.send(
      JSON.stringify({
        id: cmdIdRef.current++,
        method: "Input.dispatchMouseEvent",
        params: {
          type,
          x,
          y,
          button: type === "mouseMoved" ? "none" : button,
          buttons: e.buttons,
          clickCount: type === "mousePressed" ? e.detail || 1 : 0,
          modifiers: modifierMaskFromEvent(e),
        },
      })
    );
  }

  function dispatchScroll(e: React.WheelEvent<HTMLCanvasElement>) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = canvasToRemote(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    ws.send(
      JSON.stringify({
        id: cmdIdRef.current++,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseWheel",
          x,
          y,
          deltaX: -e.deltaX,
          deltaY: -e.deltaY,
          modifiers: modifierMaskFromEvent(e),
        },
      })
    );
  }

  function dispatchKey(e: React.KeyboardEvent<HTMLCanvasElement>, type: "keyDown" | "keyUp") {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    e.preventDefault();
    const isChar = type === "keyDown" && e.key.length === 1;
    ws.send(
      JSON.stringify({
        id: cmdIdRef.current++,
        method: "Input.dispatchKeyEvent",
        params: {
          type: isChar ? "char" : type,
          text: isChar ? e.key : undefined,
          key: e.key,
          code: e.code,
          windowsVirtualKeyCode: e.keyCode,
          modifiers: modifierMaskFromEvent(e),
        },
      })
    );
    // Also send the keyDown so chromium fires both pieces for printable keys.
    if (isChar) {
      ws.send(
        JSON.stringify({
          id: cmdIdRef.current++,
          method: "Input.dispatchKeyEvent",
          params: {
            type: "keyDown",
            key: e.key,
            code: e.code,
            windowsVirtualKeyCode: e.keyCode,
            modifiers: modifierMaskFromEvent(e),
          },
        })
      );
    }
  }

  return (
    <div style={{ position: "relative", width, background: "#000" }}>
      {status !== "live" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            font: "12px monospace",
            background: "rgba(0,0,0,0.6)",
            zIndex: 1,
          }}
        >
          {status}
          {error ? `: ${error}` : ""}
        </div>
      )}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{ width: "100%", display: "block", outline: "none", cursor: "default" }}
        onMouseDown={(e) => dispatchMouse("mousePressed", e)}
        onMouseUp={(e) => dispatchMouse("mouseReleased", e)}
        onMouseMove={(e) => dispatchMouse("mouseMoved", e)}
        onWheel={dispatchScroll}
        onKeyDown={(e) => dispatchKey(e, "keyDown")}
        onKeyUp={(e) => dispatchKey(e, "keyUp")}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

function modifierMaskFromEvent(
  e: React.MouseEvent | React.KeyboardEvent | React.WheelEvent
): number {
  // CDP modifier mask: 1=alt, 2=ctrl, 4=meta, 8=shift
  let m = 0;
  if (e.altKey) m |= 1;
  if (e.ctrlKey) m |= 2;
  if (e.metaKey) m |= 4;
  if (e.shiftKey) m |= 8;
  return m;
}
