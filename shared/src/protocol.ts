/** Real-time messages between the city client and the district server (JSON over WebSocket at /ws). */

export interface AvatarState {
  id: string;
  handle: string;
  /** Tile coordinates; fractional while walking. */
  x: number;
  y: number;
  moving: boolean;
}

export type ClientMsg =
  | { t: "join"; playerId: string }
  /** Walk to a tile. The server finds the path and rejects walls. */
  | { t: "move"; x: number; y: number };

export type ServerMsg =
  | { t: "welcome"; you: string; district: string }
  | { t: "state"; district: string; players: AvatarState[] }
  /** The player is travelling; reconnect (send join) after arrival. */
  | { t: "transit"; seconds: number }
  /** Removed from the district (left for travel, or logged in elsewhere). */
  | { t: "left"; reason: "travel" | "replaced" }
  | { t: "error"; message: string };

/** Walking speed in tiles per second. */
export const WALK_SPEED = 4;
/** Server simulation and broadcast rate. */
export const TICK_MS = 100;
