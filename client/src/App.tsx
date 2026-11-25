import { useCallback, useEffect, useState } from "react";
import { api, type PlayerView } from "./api";
import { Login } from "./Login";
import { Game } from "./Game";

const KEY = "replicant.playerId";

export function App() {
  const [playerId, setPlayerId] = useState<string | null>(() => localStorage.getItem(KEY));
  const [view, setView] = useState<PlayerView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const login = (id: string) => {
    localStorage.setItem(KEY, id);
    setPlayerId(id);
  };
  const logout = () => {
    localStorage.removeItem(KEY);
    setPlayerId(null);
    setView(null);
  };

  const refresh = useCallback(async () => {
    if (!playerId) return;
    try {
      setView(await api.player(playerId));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [playerId]);

  useEffect(() => {
    if (!playerId) return;
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [playerId, refresh]);

  if (!playerId) return <Login onLogin={login} />;
  if (!view) {
    return (
      <div className="panel login">
        <p>{loadError ? `Couldn't load your character: ${loadError}` : "Connecting…"}</p>
        {loadError && <button onClick={logout}>Back to login</button>}
      </div>
    );
  }
  return <Game view={view} refresh={refresh} onLogout={logout} />;
}
