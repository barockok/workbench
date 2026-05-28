import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function readBootToken(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    const bootToken = decodeURIComponent(hash.slice(7));
    localStorage.setItem("awb_token", bootToken);
    // Strip the token from URL so it doesn't linger in history.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return bootToken;
  }
  return localStorage.getItem("awb_token");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readBootToken);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    fetch(`${import.meta.env.VITE_API_URL || ""}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => { if (!res.ok) throw new Error("Unauthorized"); return res.json(); })
      .then((data) => setUser(data))
      .catch(() => { localStorage.removeItem("awb_token"); setToken(null); })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = (newToken: string) => {
    localStorage.setItem("awb_token", newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem("awb_token");
    setToken(null);
    setUser(null);
    fetch(`${import.meta.env.VITE_API_URL || ""}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token ?? ""}` },
    }).catch(() => {});
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
