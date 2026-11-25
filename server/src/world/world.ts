import { WALK_SPEED, findPath, getMap, type AvatarState, type Point } from "@replicant/shared";

interface Avatar {
  id: string;
  handle: string;
  district: string;
  x: number;
  y: number;
  /** Remaining waypoints (tile centres). */
  path: Point[];
}

/**
 * Pure simulation of who is where in each district. No sockets, no database:
 * the socket layer (worldServer.ts) feeds it and broadcasts its snapshots.
 */
export class World {
  private readonly avatars = new Map<string, Avatar>();
  /** Last position per player per district, so rejoining doesn't teleport you to spawn. */
  private readonly lastPos = new Map<string, Point>();

  place(id: string, handle: string, district: string): Avatar {
    this.remove(id);
    const map = getMap(district);
    const saved = this.lastPos.get(`${id}:${district}`);
    const start = saved ?? map.spawn;
    const a: Avatar = { id, handle, district, x: start.x, y: start.y, path: [] };
    this.avatars.set(id, a);
    return a;
  }

  remove(id: string): string | undefined {
    const a = this.avatars.get(id);
    if (!a) return undefined;
    this.lastPos.set(`${id}:${a.district}`, { x: Math.round(a.x), y: Math.round(a.y) });
    this.avatars.delete(id);
    return a.district;
  }

  districtOf(id: string): string | undefined {
    return this.avatars.get(id)?.district;
  }

  /** Sets a walk target. Returns false if the tile can't be reached. */
  walkTo(id: string, target: Point): boolean {
    const a = this.avatars.get(id);
    if (!a) return false;
    const map = getMap(a.district);
    // Finish the step in progress first, so the avatar never snaps backwards.
    const next = a.path[0];
    const from = next ?? { x: Math.round(a.x), y: Math.round(a.y) };
    const rest = findPath(map, from, target);
    if (!rest) return false;
    a.path = next ? [next, ...rest] : rest;
    return true;
  }

  /** Advances everyone by dt seconds. Returns the districts where something moved. */
  step(dt: number): Set<string> {
    const changed = new Set<string>();
    for (const a of this.avatars.values()) {
      let budget = WALK_SPEED * dt;
      while (budget > 0 && a.path.length) {
        const wp = a.path[0]!;
        const dx = wp.x - a.x;
        const dy = wp.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          a.x = wp.x;
          a.y = wp.y;
          a.path.shift();
          budget -= dist;
        } else {
          a.x += (dx / dist) * budget;
          a.y += (dy / dist) * budget;
          budget = 0;
        }
        changed.add(a.district);
      }
    }
    return changed;
  }

  snapshot(district: string): AvatarState[] {
    const out: AvatarState[] = [];
    for (const a of this.avatars.values()) {
      if (a.district !== district) continue;
      out.push({ id: a.id, handle: a.handle, x: round2(a.x), y: round2(a.y), moving: a.path.length > 0 });
    }
    return out;
  }

  districts(): Set<string> {
    return new Set([...this.avatars.values()].map((a) => a.district));
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
