import { describe, expect, it } from "vitest";
import { WALK_SPEED, getMap } from "@replicant/shared";
import { World } from "./world";

describe("World", () => {
  const spawn = getMap("arc-helix").spawn;

  it("places players at the district spawn", () => {
    const w = new World();
    w.place("a", "alice", "arc-helix");
    expect(w.snapshot("arc-helix")).toEqual([{ id: "a", handle: "alice", x: spawn.x, y: spawn.y, moving: false }]);
    expect(w.snapshot("spr-rustline")).toEqual([]);
  });

  it("walks along a path at walking speed and stops on the target", () => {
    const w = new World();
    w.place("a", "alice", "arc-helix");
    expect(w.walkTo("a", { x: spawn.x + 4, y: spawn.y })).toBe(true);
    w.step(0.5);
    const mid = w.snapshot("arc-helix")[0]!;
    expect(mid.x).toBeCloseTo(spawn.x + WALK_SPEED * 0.5);
    expect(mid.moving).toBe(true);
    w.step(5);
    expect(w.snapshot("arc-helix")[0]).toMatchObject({ x: spawn.x + 4, y: spawn.y, moving: false });
  });

  it("rejects unreachable targets", () => {
    const w = new World();
    w.place("a", "alice", "arc-helix");
    expect(w.walkTo("a", { x: 3, y: 3 })).toBe(false);
    expect(w.walkTo("nobody", { x: 2, y: 1 })).toBe(false);
  });

  it("remembers where you were when you come back to a district", () => {
    const w = new World();
    w.place("a", "alice", "arc-helix");
    w.walkTo("a", { x: 2, y: 1 });
    w.step(30);
    expect(w.remove("a")).toBe("arc-helix");
    w.place("a", "alice", "spr-rustline");
    expect(w.districtOf("a")).toBe("spr-rustline");
    w.place("a", "alice", "arc-helix");
    expect(w.snapshot("arc-helix")[0]).toMatchObject({ x: 2, y: 1 });
  });

  it("re-routes mid-step without snapping backwards", () => {
    const w = new World();
    w.place("a", "alice", "arc-helix");
    w.walkTo("a", { x: spawn.x + 4, y: spawn.y });
    w.step(0.1);
    const before = w.snapshot("arc-helix")[0]!.x;
    w.walkTo("a", { x: spawn.x - 4, y: spawn.y });
    w.step(0.05);
    expect(w.snapshot("arc-helix")[0]!.x).toBeGreaterThanOrEqual(before);
  });
});
