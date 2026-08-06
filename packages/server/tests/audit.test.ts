import { describe, it, expect, beforeEach, vi } from "vitest";
import { SqliteDestination, StdoutDestination, KafkaDestination, createDestination } from "../src/audit/destinations";
import { db } from "../src/db";

beforeEach(async () => {
  await db.exec("DELETE FROM audit_log");
  vi.restoreAllMocks();
});

describe("audit", () => {
  it("sqlite destination writes to db", async () => {
    const dest = new SqliteDestination();
    await dest.log({
      user_id: "alice",
      action: "EXECUTE",
      success: true,
      timestamp: new Date().toISOString(),
    });

    const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM audit_log");
    expect(Number(count?.c)).toBe(1);
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

  it("kafka destination falls back to stdout", async () => {
    const dest = new KafkaDestination();
    const errors: string[] = [];
    const logs: string[] = [];
    const originalErr = console.error;
    const originalLog = console.log;
    console.error = (msg: string) => errors.push(msg);
    console.log = (msg: string) => logs.push(msg);

    await dest.log({
      user_id: "alice",
      action: "EXECUTE",
      success: true,
      timestamp: "2024-01-01T00:00:00Z",
    });

    console.error = originalErr;
    console.log = originalLog;
    expect(errors[0]).toContain("Kafka not implemented");
    expect(JSON.parse(logs[0]).user_id).toBe("alice");
  });

  it("createDestination returns sqlite by default", () => {
    const dest = createDestination();
    expect(dest).toBeInstanceOf(SqliteDestination);
  });

  it("createDestination respects AUDIT_LOG_DEST config", async () => {
    const { config } = await import("../src/config");
    const original = config.AUDIT_LOG_DEST;

    config.AUDIT_LOG_DEST = "stdout";
    expect(createDestination()).toBeInstanceOf(StdoutDestination);

    config.AUDIT_LOG_DEST = "kafka";
    expect(createDestination()).toBeInstanceOf(KafkaDestination);

    config.AUDIT_LOG_DEST = original;
  });
});
