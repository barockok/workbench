import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import {
  encodeCursor,
  decodeCursor,
  listAuditEvents,
  summarizeAudit,
} from "../src/audit/query";

const NOW = Math.floor(Date.now() / 1000);

// Insert one audit row. `success` is a real boolean: the column is BOOLEAN and
// PostgreSQL rejects 1/0 for it; the SQLite adapter converts on the way in.
async function seed(o: {
  userId: string;
  integration?: string | null;
  tool?: string;
  success?: boolean;
  error?: string | null;
  durationMs?: number | null;
  createdAt?: number;
}) {
  await db.run(
    `INSERT INTO audit_log (user_id, integration, tool, action, success, error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      o.userId,
      o.integration === undefined ? "acme" : o.integration,
      o.tool ?? "acme_search",
      "EXECUTE",
      o.success ?? true,
      o.error ?? null,
      o.durationMs ?? 100,
      o.createdAt ?? NOW,
    ]
  );
}

beforeEach(async () => {
  await db.exec("DELETE FROM audit_log");
});

describe("cursor encoding", () => {
  it("round-trips a position", () => {
    const c = encodeCursor(1757001600, 8814);
    expect(decodeCursor(c)).toEqual({ createdAt: 1757001600, id: 8814 });
  });

  it("rejects a cursor that is not the expected shape", () => {
    expect(decodeCursor("not-base64-of-anything-useful")).toBeNull();
    expect(decodeCursor(Buffer.from("nope").toString("base64url"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("listAuditEvents", () => {
  it("returns only the requested user's rows, newest first", async () => {
    await seed({ userId: "user-1", tool: "older", createdAt: NOW - 60 });
    await seed({ userId: "user-1", tool: "newer", createdAt: NOW });
    await seed({ userId: "user-2", tool: "other-user" });

    const rows = await listAuditEvents({ userId: "user-1", limit: 10 });
    expect(rows.map((r) => r.tool)).toEqual(["newer", "older"]);
  });

  it("normalizes success into a real boolean", async () => {
    await seed({ userId: "user-1", success: false, error: "boom" });
    const [row] = await listAuditEvents({ userId: "user-1", limit: 10 });
    expect(row.success).toBe(false);
    expect(row.error).toBe("boom");
  });

  it("filters by integration", async () => {
    await seed({ userId: "user-1", integration: "acme" });
    await seed({ userId: "user-1", integration: "demo-repo" });
    const rows = await listAuditEvents({ userId: "user-1", limit: 10, integration: "demo-repo" });
    expect(rows).toHaveLength(1);
    expect(rows[0].integration).toBe("demo-repo");
  });

  it("filters by status", async () => {
    await seed({ userId: "user-1", tool: "ok_tool", success: true });
    await seed({ userId: "user-1", tool: "bad_tool", success: false });

    const failures = await listAuditEvents({ userId: "user-1", limit: 10, status: "error" });
    expect(failures.map((r) => r.tool)).toEqual(["bad_tool"]);

    const wins = await listAuditEvents({ userId: "user-1", limit: 10, status: "success" });
    expect(wins.map((r) => r.tool)).toEqual(["ok_tool"]);
  });

  it("pages past rows that share a created_at, without repeating or skipping", async () => {
    // Three rows on the same second: only the id tiebreak keeps paging correct.
    await seed({ userId: "user-1", tool: "a", createdAt: NOW });
    await seed({ userId: "user-1", tool: "b", createdAt: NOW });
    await seed({ userId: "user-1", tool: "c", createdAt: NOW });

    const first = await listAuditEvents({ userId: "user-1", limit: 2 });
    expect(first).toHaveLength(2);

    const last = first[first.length - 1];
    const second = await listAuditEvents({
      userId: "user-1",
      limit: 2,
      cursor: { createdAt: last.created_at, id: last.id },
    });

    const seen = [...first, ...second].map((r) => r.tool);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});

describe("summarizeAudit", () => {
  it("reports zero calls and a null rate on an empty window", async () => {
    const s = await summarizeAudit("user-1", 30);
    expect(s).toEqual({ toolCalls: 0, successRate: null, mostUsedIntegration: null });
  });

  it("counts calls and computes the success rate", async () => {
    await seed({ userId: "user-1", success: true });
    await seed({ userId: "user-1", success: true });
    await seed({ userId: "user-1", success: true });
    await seed({ userId: "user-1", success: false });

    const s = await summarizeAudit("user-1", 30);
    expect(s.toolCalls).toBe(4);
    expect(s.successRate).toBe(0.75);
  });

  it("ignores rows outside the window and rows belonging to other users", async () => {
    await seed({ userId: "user-1", createdAt: NOW });
    await seed({ userId: "user-1", createdAt: NOW - 40 * 86400 });
    await seed({ userId: "user-2", createdAt: NOW });

    const s = await summarizeAudit("user-1", 30);
    expect(s.toolCalls).toBe(1);
  });

  it("names the most-used integration, ignoring rows that have none", async () => {
    await seed({ userId: "user-1", integration: "acme" });
    await seed({ userId: "user-1", integration: "acme" });
    await seed({ userId: "user-1", integration: "demo-repo" });
    await seed({ userId: "user-1", integration: null });

    const s = await summarizeAudit("user-1", 30);
    expect(s.mostUsedIntegration).toBe("acme");
  });
});
