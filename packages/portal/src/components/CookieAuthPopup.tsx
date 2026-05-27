import { useState } from "react";
import { captureCookies, cancelCookieAuth } from "../api";

interface Props {
  integration: string;
  loginUrl: string;
  cdpUrl: string;
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CookieAuthPopup({ integration, loginUrl, sessionId, onClose, onSuccess }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCapture() {
    setCapturing(true);
    setError(null);
    try {
      await captureCookies(integration, sessionId);
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }

  async function handleCancel() {
    await cancelCookieAuth(integration, sessionId);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Log in to {integration}</h2>
          <button onClick={handleCancel} className="text-gray-500 hover:text-gray-700">&times;</button>
        </div>

        <div className="p-4 bg-gray-50 text-sm">
          <p>1. Complete login in the browser window below</p>
          <p>2. Click "Done — I've logged in" when finished</p>
        </div>

        <div className="flex-1 min-h-[400px]">
          <iframe
            src={loginUrl}
            className="w-full h-full min-h-[400px] border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={`${integration} login`}
          />
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <div className="p-4 border-t flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {capturing ? "Capturing..." : "Done — I've logged in"}
          </button>
        </div>
      </div>
    </div>
  );
}
