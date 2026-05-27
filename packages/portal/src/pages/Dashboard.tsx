import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations, fetchConnections, startCookieAuth } from "../api";
import { useAuth } from "../context/AuthContext";
import CookieAuthPopup from "../components/CookieAuthPopup";

interface CookieAuthState {
  integration: string;
  loginUrl: string;
  cdpUrl: string;
  sessionId: string;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
  });
  const { data: connectionsData, refetch: refetchConnections } = useQuery({
    queryKey: ["connections"],
    queryFn: fetchConnections,
  });

  const [cookieAuth, setCookieAuth] = useState<CookieAuthState | null>(null);

  const connectionMap = new Map(
    connectionsData?.connections?.map((c: { name: string; connected: boolean }) => [c.name, c.connected]) ?? []
  );

  async function handleConnect(integration: string) {
    const integ = data?.integrations?.find((i: { name: string }) => i.name === integration);
    if (!integ) return;

    // For cookie auth, start HITL session
    try {
      const result = await startCookieAuth(integration);
      if (result.type === "cookie") {
        setCookieAuth({
          integration,
          loginUrl: result.loginUrl,
          cdpUrl: result.cdpUrl,
          sessionId: result.sessionId,
        });
        return;
      }
    } catch {
      // Fallback: not cookie auth, ignore
    }

    // For OAuth, redirect to auth URL
    window.location.href = `/api/auth/${integration}`;
  }

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <div className="flex items-center gap-4">
          {user?.email && <span className="text-sm text-gray-600">{user.email}</span>}
          <button
            onClick={logout}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data?.integrations?.map((i: { name: string; version: string }) => {
          const connected = connectionMap.get(i.name) ?? false;
          return (
            <div key={i.name} className="bg-white p-4 rounded shadow">
              <div className="font-medium">{i.name}</div>
              <div className="text-sm text-gray-500">{i.version}</div>
              <div className="mt-2 flex items-center gap-2">
                {connected ? (
                  <span className="text-sm text-green-600 font-medium">Connected</span>
                ) : (
                  <button
                    onClick={() => handleConnect(i.name)}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {cookieAuth && (
        <CookieAuthPopup
          integration={cookieAuth.integration}
          loginUrl={cookieAuth.loginUrl}
          cdpUrl={cookieAuth.cdpUrl}
          sessionId={cookieAuth.sessionId}
          onClose={() => setCookieAuth(null)}
          onSuccess={() => refetchConnections()}
        />
      )}
    </div>
  );
}
