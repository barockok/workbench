import { describe, it, expect, vi } from "vitest";
import { searchSheets, appendSheet, readSheet, writeSheet } from "../../plugins/google-sheets/tools/sheets";
import { listEvents, listCalendars, freeBusy } from "../../plugins/google-calendar/tools/calendar";
import { listFiles } from "../../plugins/google-drive/tools/drive";

// Mock ctx.http that records URLs/bodies (same pattern as google-drive-query.test.ts).
function recordingCtx(jsonReply: unknown = { files: [] }) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (init?.body) bodies.push(init.body);
    return { json: async () => jsonReply, status: 200 };
  });
  return { ctx: { http } as any, urls, bodies };
}

function qParam(url: string): string {
  const u = new URL(url);
  return u.searchParams.get("q") ?? "";
}

describe("google_sheets_search query escaping", () => {
  it("escapes single quotes so user input can't break out of the q literal", async () => {
    const { ctx, urls } = recordingCtx();
    await searchSheets.handler(ctx, { query: "a' or b='", pageSize: 10 });
    const q = qParam(urls[0]);
    expect(q).toContain("a\\' or b=\\'");
    expect(q).toContain("mimeType='application/vnd.google-apps.spreadsheet'");
    // No unescaped user quote terminating the literal early.
    expect(q).not.toContain("name contains 'a' or b=''");
  });

  it("escapes backslashes before quotes", async () => {
    const { ctx, urls } = recordingCtx();
    await searchSheets.handler(ctx, { query: "back\\slash", pageSize: 10 });
    expect(qParam(urls[0])).toContain("back\\\\slash");
  });
});

describe("google_sheets_append", () => {
  it("POSTs to :append with USER_ENTERED + INSERT_ROWS and returns slim updates", async () => {
    const { ctx, urls, bodies } = recordingCtx({
      spreadsheetId: "s1",
      tableRange: "Sheet1!A1:C4",
      updates: {
        spreadsheetId: "s1",
        updatedRange: "Sheet1!A5:C6",
        updatedRows: 2,
        updatedColumns: 3,
        updatedCells: 6,
      },
    });
    const result = await appendSheet.handler(ctx, {
      spreadsheetId: "s1",
      range: "Sheet1!A:C",
      values: [
        ["a", "b", "c"],
        ["d", "e", "f"],
      ],
    });

    expect(urls[0]).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/s1/values/Sheet1!A%3AC:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"
    );
    expect(ctx.http.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(bodies[0])).toEqual({
      values: [
        ["a", "b", "c"],
        ["d", "e", "f"],
      ],
    });
    // Slim shape only — no raw envelope passthrough.
    expect(result).toEqual({ updatedRange: "Sheet1!A5:C6", updatedRows: 2 });
  });
});

describe("google_sheets_read / write shaping", () => {
  it("read returns only { range, values }", async () => {
    const { ctx } = recordingCtx({
      range: "Sheet1!A1:B2",
      majorDimension: "ROWS",
      values: [["x", "y"]],
    });
    const result = await readSheet.handler(ctx, { spreadsheetId: "s1", range: "Sheet1!A1:B2" });
    expect(result).toEqual({ range: "Sheet1!A1:B2", values: [["x", "y"]] });
  });

  it("read defaults values to [] when the range is empty", async () => {
    const { ctx } = recordingCtx({ range: "Sheet1!A1:B2", majorDimension: "ROWS" });
    const result = await readSheet.handler(ctx, { spreadsheetId: "s1", range: "Sheet1!A1:B2" });
    expect(result).toEqual({ range: "Sheet1!A1:B2", values: [] });
  });

  it("write returns only { updatedRange, updatedCells }", async () => {
    const { ctx } = recordingCtx({
      spreadsheetId: "s1",
      updatedRange: "Sheet1!A1:B1",
      updatedRows: 1,
      updatedColumns: 2,
      updatedCells: 2,
    });
    const result = await writeSheet.handler(ctx, {
      spreadsheetId: "s1",
      range: "Sheet1!A1:B1",
      values: [["x", "y"]],
    });
    expect(result).toEqual({ updatedRange: "Sheet1!A1:B1", updatedCells: 2 });
  });
});

describe("google_calendar_list_events shaping", () => {
  // Realistic raw payload: etags, creator/organizer blobs, reminders,
  // conference data, long nextPageToken.
  const rawPayload = {
    kind: "calendar#events",
    etag: '"p32o9bp8omu2vc0g"',
    summary: "user@example.com",
    updated: "2026-06-11T08:00:00.000Z",
    timeZone: "Asia/Jakarta",
    accessRole: "owner",
    defaultReminders: [{ method: "popup", minutes: 30 }],
    nextPageToken: "CigKGmtxxxxxx".padEnd(600, "x"),
    items: [
      {
        kind: "calendar#event",
        etag: '"3423098234098000"',
        id: "evt1",
        status: "confirmed",
        htmlLink: "https://www.google.com/calendar/event?eid=ZXZ0MQ",
        created: "2026-06-01T00:00:00.000Z",
        updated: "2026-06-02T00:00:00.000Z",
        summary: "Sprint planning",
        location: "Room 4",
        creator: { email: "boss@example.com" },
        organizer: { email: "boss@example.com" },
        start: { dateTime: "2026-06-13T10:00:00+07:00", timeZone: "Asia/Jakarta" },
        end: { dateTime: "2026-06-13T11:00:00+07:00", timeZone: "Asia/Jakarta" },
        iCalUID: "evt1@google.com",
        sequence: 0,
        attendees: [
          { email: "a@example.com", responseStatus: "accepted" },
          { email: "b@example.com", responseStatus: "needsAction" },
        ],
        reminders: { useDefault: true },
        conferenceData: { entryPoints: [{ uri: "https://meet.google.com/xyz" }] },
        eventType: "default",
      },
      {
        kind: "calendar#event",
        etag: '"3423098234098001"',
        id: "evt2",
        status: "confirmed",
        htmlLink: "https://www.google.com/calendar/event?eid=ZXZ0Mg",
        summary: "Holiday",
        creator: { email: "me@example.com", self: true },
        organizer: { email: "me@example.com", self: true },
        start: { date: "2026-06-14" },
        end: { date: "2026-06-15" },
        reminders: { useDefault: true },
      },
    ],
  };

  it("returns slim rows + top-level nextPageToken, no etags/reminders/conferenceData", async () => {
    const { ctx } = recordingCtx(rawPayload);
    const result: any = await listEvents.handler(ctx, { calendarId: "primary", maxResults: 10 });

    expect(result.nextPageToken).toBe(rawPayload.nextPageToken);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({
      id: "evt1",
      summary: "Sprint planning",
      start: "2026-06-13T10:00:00+07:00",
      end: "2026-06-13T11:00:00+07:00",
      location: "Room 4",
      status: "confirmed",
      organizer: "boss@example.com",
      attendees: 2,
      htmlLink: "https://www.google.com/calendar/event?eid=ZXZ0MQ",
    });
    // All-day event collapses start.date / end.date.
    expect(result.events[1].start).toBe("2026-06-14");
    expect(result.events[1].end).toBe("2026-06-15");
    expect(result.events[1].attendees).toBe(0);
    // Bloat fields gone everywhere.
    const flat = JSON.stringify(result);
    expect(flat).not.toContain("etag");
    expect(flat).not.toContain("conferenceData");
    expect(flat).not.toContain("reminders");
  });

  it("omits nextPageToken when the API returns none", async () => {
    const { ctx } = recordingCtx({ items: [] });
    const result: any = await listEvents.handler(ctx, { calendarId: "primary", maxResults: 10 });
    expect(result).toEqual({ events: [] });
  });
});

describe("google_calendar_list_calendars shaping", () => {
  it("returns slim rows with primary coerced to boolean", async () => {
    const { ctx } = recordingCtx({
      kind: "calendar#calendarList",
      etag: '"p320"',
      items: [
        {
          id: "primary-id@group.calendar.google.com",
          etag: '"e1"',
          summary: "Main",
          primary: true,
          accessRole: "owner",
          timeZone: "Asia/Jakarta",
          notificationSettings: { notifications: [{ type: "eventCreation", method: "email" }] },
          conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
          defaultReminders: [],
          colorId: "14",
        },
        {
          id: "team@group.calendar.google.com",
          etag: '"e2"',
          summary: "Team",
          accessRole: "reader",
          timeZone: "UTC",
          conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
        },
      ],
    });
    const result: any = await listCalendars.handler(ctx, { maxResults: 10 });
    expect(result.calendars).toEqual([
      {
        id: "primary-id@group.calendar.google.com",
        summary: "Main",
        primary: true,
        accessRole: "owner",
        timeZone: "Asia/Jakarta",
      },
      {
        id: "team@group.calendar.google.com",
        summary: "Team",
        primary: false,
        accessRole: "reader",
        timeZone: "UTC",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("conferenceProperties");
  });
});

describe("google_calendar_freebusy", () => {
  it("builds the freeBusy body and returns slim busy intervals", async () => {
    const { ctx, urls, bodies } = recordingCtx({
      kind: "calendar#freeBusy",
      timeMin: "2026-06-13T00:00:00.000Z",
      timeMax: "2026-06-14T00:00:00.000Z",
      calendars: {
        primary: {
          busy: [{ start: "2026-06-13T10:00:00Z", end: "2026-06-13T11:00:00Z" }],
        },
        "team@group.calendar.google.com": { busy: [] },
      },
    });
    const result: any = await freeBusy.handler(ctx, {
      timeMin: "2026-06-13T00:00:00Z",
      timeMax: "2026-06-14T00:00:00Z",
      calendarIds: ["primary", "team@group.calendar.google.com"],
    });

    expect(urls[0]).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(ctx.http.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(bodies[0])).toEqual({
      timeMin: "2026-06-13T00:00:00Z",
      timeMax: "2026-06-14T00:00:00Z",
      items: [{ id: "primary" }, { id: "team@group.calendar.google.com" }],
    });
    expect(result).toEqual({
      calendars: {
        primary: [{ start: "2026-06-13T10:00:00Z", end: "2026-06-13T11:00:00Z" }],
        "team@group.calendar.google.com": [],
      },
    });
  });
});

describe("google_drive_list shaping", () => {
  it("requests a fields projection and returns slim rows + nextPageToken", async () => {
    const { ctx, urls } = recordingCtx({
      nextPageToken: "tok123",
      files: [
        {
          id: "f1",
          name: "report.pdf",
          mimeType: "application/pdf",
          modifiedTime: "2026-06-10T00:00:00Z",
          size: "12345",
        },
        {
          id: "f2",
          name: "Doc",
          mimeType: "application/vnd.google-apps.document",
          modifiedTime: "2026-06-09T00:00:00Z",
          // Google-native files have no size.
        },
      ],
    });
    const result: any = await listFiles.handler(ctx, { pageSize: 10 });

    const u = new URL(urls[0]);
    expect(u.searchParams.get("fields")).toBe(
      "nextPageToken,files(id,name,mimeType,modifiedTime,size)"
    );
    expect(result.nextPageToken).toBe("tok123");
    expect(result.files).toEqual([
      {
        id: "f1",
        name: "report.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-06-10T00:00:00Z",
        size: "12345",
      },
      {
        id: "f2",
        name: "Doc",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-06-09T00:00:00Z",
      },
    ]);
  });

  it("still passes through a raw q filter", async () => {
    const { ctx, urls } = recordingCtx({ files: [] });
    await listFiles.handler(ctx, { pageSize: 5, query: "mimeType='application/pdf'" });
    expect(qParam(urls[0])).toBe("mimeType='application/pdf'");
  });
});
