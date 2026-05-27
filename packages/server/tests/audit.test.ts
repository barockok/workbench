import { describe, it, expect, beforeEach } from "vitest";
import { SqliteDestination, StdoutDestination } from "../src/audit/destinations";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM audit_log");
});

describe("audit", () => {
  it("sqlite destination writes to db", () => {
    const dest = new SqliteDestination();
    dest.log({
      user_id: "alice",
      action: "EXECUTE",
      success: true,
      timestamp: new Date().toISOString(),
    });

    const count = db.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("stdout destination prints json", () => {
    const dest = new StdoutDestination();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    dest.log({
      user_id: "alice",
      action: "EXECUTE",
      success: true,
      timestamp: "2024-01-01T00:00:00Z",
    });

    console.log = originalLog;
    expect(JSON.parse(logs[0]).user_id).toBe("alice");
  });
});
