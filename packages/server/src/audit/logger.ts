import { AuditEvent } from "@a-workbench/shared";
import { AuditDestination, createDestination } from "./destinations";

export class AuditLogger {
  private destination: AuditDestination;

  constructor() {
    this.destination = createDestination();
  }

  async log(event: Omit<AuditEvent, "timestamp">): Promise<void> {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    await this.destination.log(fullEvent);
  }
}

export const auditLogger = new AuditLogger();
