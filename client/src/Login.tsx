import { useState } from "react";
import { api } from "./api";

export function Login({ onLogin }: { onLogin: (id: string) => void }) {
  const [handle, setHandle] = useState("");
  const [existing, setExisting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.createPlayer(handle);
      onLogin(p.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setError(null);
    try {
      await api.player(existing.trim());
      onLogin(existing.trim());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="panel login stack">
      <h1>SPRAWLBORN</h1>
      <p className="muted">Economy prototype. Create a character to start trading.</p>

      <h2>New character</h2>
      <div className="row">
        <input placeholder="Handle" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="primary" disabled={busy || handle.trim().length < 3} onClick={create}>
          Create
        </button>
      </div>

      <h2>Existing character</h2>
      <div className="row">
        <input placeholder="Player ID" value={existing} onChange={(e) => setExisting(e.target.value)} style={{ flex: 1 }} />
        <button disabled={existing.trim().length !== 36} onClick={resume}>
          Load
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        No passwords yet. Keep your Player ID (shown in the top bar) to log in from another browser.
      </p>
      {error && <p className="sellText">{error}</p>}
    </div>
  );
}
