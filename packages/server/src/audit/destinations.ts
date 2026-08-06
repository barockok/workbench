import { AuditEvent } from "@a-workbench/shared";
import { config } from "../config";
import { db } from "../db";

export interface AuditDestination {
  log(event: AuditEvent): void | Promise<void>;
}

export class SqliteDestination implements AuditDestination {
  async log(event: AuditEvent): Promise<void> {
    await db.run(
      `INSERT INTO audit_log (user_id, integration, tool, action, success, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.user_id,
        event.integration ?? null,
        event.tool ?? null,
        event.action,
        // A real boolean, not 1/0: `success` is BOOLEAN and PostgreSQL rejects
        // an integer for it. The SQLite adapter converts on the way in.
        event.success,
        event.error ?? null,
        event.duration_ms ?? null,
        Math.floor(new Date(event.timestamp).getTime() / 1000),
      ]
    );
  }
}

export class StdoutDestination implements AuditDestination {
  log(event: AuditEvent): void {
    console.log(JSON.stringify(event));
  }
}

export class KafkaDestination implements AuditDestination {
  async log(event: AuditEvent): Promise<void> {
    console.error("Kafka not implemented, falling back to stdout");
    console.log(JSON.stringify(event));
  }
}

export function createDestination(): AuditDestination {
  switch (config.AUDIT_LOG_DEST) {
    case "stdout":
      return new StdoutDestination();
    case "kafka":
      return new KafkaDestination();
    case "sqlite":
    default:
      return new SqliteDestination();
  }
}
