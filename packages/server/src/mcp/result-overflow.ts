import crypto from "node:crypto";
import { config } from "../config";

// Oversized tool results are split into ~MAX_RESULT_CHARS chunks. The initial
// tools/call returns every stored part as a separate MCP content[] text block
// so the agent can concatenate without a continue loop. continue_tool_result
// remains for re-fetch. execute_tools packages each results[] item independently
// so one large Confluence page does not truncate its siblings.
// See docs/findings/2026-08-07-mcp-result-overflow-continuation.md

export const MAX_RESULT_CHARS = 60_000;
// Room for the continuation envelope (metadata + instruction) around each chunk.
const ENVELOPE_RESERVE = 2_000;
export const CHUNK_CHARS = MAX_RESULT_CHARS - ENVELOPE_RESERVE;

// Sentinel: handler return value expanded into one text content block per envelope.
export const CONTINUATION_PARTS_KEY = "_mcpContinuationParts";

const TTL_MS = 10 * 60 * 1000;

interface OverflowEntry {
  userId: string;
  text: string;
  complete: boolean;
  expiresAt: number;
  resultIndex?: number;
}

const store = new Map<string, OverflowEntry>();

let now: () => number = () => Date.now();
export function _setNowForTest(fn: () => number): void {
  now = fn;
}
export function _clearForTest(): void {
  store.clear();
}

export function reapExpired(): void {
  const t = now();
  for (const [k, v] of store) {
    if (v.expiresAt < t) store.delete(k);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startOverflowReaper(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => reapExpired(), intervalMs);
  timer.unref?.();
}

export type ContinuationEnvelope = {
  truncated: true;
  continuationId: string;
  part: number;
  totalParts: number;
  totalChars: number;
  hasMore: boolean;
  nextPart: number | null;
  complete: boolean;
  instruction: string;
  chunk: string;
  /** Set when this envelope belongs to one execute_tools results[] item. */
  resultIndex?: number;
};

/** Stub placed in execute_tools results[i] when that item was overflow-packaged. */
export type BatchOverflowStub = {
  truncated: true;
  continuationId: string;
  totalParts: number;
  totalChars: number;
  complete: boolean;
  resultIndex: number;
  /** false when this item's parts were deferred (over MAX_OVERFLOW_ITEMS). */
  partsIncluded: boolean;
  instruction: string;
};

function totalPartsFor(length: number): number {
  return Math.max(1, Math.ceil(length / CHUNK_CHARS));
}

type EnvelopeDelivery = "all" | "single";

function buildEnvelope(
  continuationId: string,
  text: string,
  part: number,
  complete: boolean,
  delivery: EnvelopeDelivery = "all",
  resultIndex?: number
): ContinuationEnvelope {
  const totalParts = totalPartsFor(text.length);
  const start = (part - 1) * CHUNK_CHARS;
  const chunk = text.slice(start, start + CHUNK_CHARS);
  const hasMore = part < totalParts;
  const nextPart = hasMore ? part + 1 : null;
  const itemHint =
    resultIndex !== undefined ? ` (execute_tools results[${resultIndex}])` : "";
  let instruction: string;
  const subject = resultIndex !== undefined ? "this item JSON" : "the full tool result JSON";
  if (delivery === "single" && hasMore) {
    instruction = `Result exceeded ${MAX_RESULT_CHARS} chars${itemHint} (showing part ${part} of ${totalParts}). Call continue_tool_result with continuationId="${continuationId}" and part=${nextPart} for the next chunk, or omit part to re-fetch all stored parts as separate content blocks. Concatenate every chunk field in ascending part order to reconstruct ${subject}.`;
  } else if (hasMore) {
    const allParts =
      resultIndex !== undefined
        ? `All available parts for this item are returned as separate text content blocks in this tools/call. Concatenate every chunk field for continuationId="${continuationId}" in ascending part order to reconstruct ${subject}.`
        : `All available parts are returned as separate text content blocks in this tools/call. Concatenate every chunk field in ascending part order to reconstruct ${subject}.`;
    instruction = `Result exceeded ${MAX_RESULT_CHARS} chars${itemHint} (part ${part} of ${totalParts}). ${allParts} Use continue_tool_result only to re-fetch if a part was discarded (omit part to get all stored parts, or pass part for a single chunk).`;
  } else if (complete) {
    instruction = `This is the final chunk${itemHint} (part ${part} of ${totalParts}). Concatenate every chunk field in ascending part order to reconstruct ${subject}.`;
  } else {
    instruction = `This is the last available chunk${itemHint} (part ${part} of ${totalParts}). Further content was omitted (MAX_OVERFLOW_PARTS=${config.MAX_OVERFLOW_PARTS}). Concatenate every chunk field in ascending part order to reconstruct the available ${resultIndex !== undefined ? "item JSON" : "tool result JSON"}.`;
  }
  const env: ContinuationEnvelope = {
    truncated: true,
    continuationId,
    part,
    totalParts,
    totalChars: text.length,
    hasMore,
    nextPart,
    complete,
    instruction,
    chunk,
  };
  if (resultIndex !== undefined) env.resultIndex = resultIndex;
  return env;
}

// Serialize an envelope to ≤ MAX_RESULT_CHARS JSON (shrinks chunk if needed).
export function encodeEnvelope(envelope: ContinuationEnvelope): string {
  const encoded = JSON.stringify(envelope);
  if (encoded.length <= MAX_RESULT_CHARS) return encoded;
  const shrink = encoded.length - MAX_RESULT_CHARS;
  const shrunk: ContinuationEnvelope = {
    ...envelope,
    chunk: envelope.chunk.slice(0, Math.max(0, envelope.chunk.length - shrink - 8)),
  };
  return JSON.stringify(shrunk);
}

function lookupEntry(
  userId: string,
  continuationId: string
): OverflowEntry | { error: string } {
  reapExpired();
  const entry = store.get(continuationId);
  if (!entry || entry.userId !== userId) {
    return { error: "Unknown or expired continuationId" };
  }
  if (entry.expiresAt < now()) {
    store.delete(continuationId);
    return { error: "Unknown or expired continuationId" };
  }
  return entry;
}

export type PackageOpts = {
  resultIndex?: number;
};

// Package a tool result for MCP content[]. Under the cap → one plain text
// element. Oversized → store a capped prefix and return one JSON envelope
// string per part (eager multi-content; no agent continue loop required).

export function packageResultContent(
  userId: string,
  text: string,
  opts?: PackageOpts
): string[] {
  if (text.length <= MAX_RESULT_CHARS) return [text];

  const maxParts = config.MAX_OVERFLOW_PARTS;
  const maxStored = maxParts * CHUNK_CHARS;
  const complete = text.length <= maxStored;
  const stored = complete ? text : text.slice(0, maxStored);

  const continuationId = crypto.randomBytes(16).toString("hex");
  store.set(continuationId, {
    userId,
    text: stored,
    complete,
    expiresAt: now() + TTL_MS,
    resultIndex: opts?.resultIndex,
  });

  const totalParts = totalPartsFor(stored.length);
  return Array.from({ length: totalParts }, (_, i) =>
    encodeEnvelope(
      buildEnvelope(continuationId, stored, i + 1, complete, "all", opts?.resultIndex)
    )
  );
}

// First content string only (under-cap passthrough or part-1 envelope).
export function packageResultText(userId: string, text: string): string {
  return packageResultContent(userId, text)[0];
}

/**
 * Package execute_tools `{ results }` per item.
 * - Small items stay inline in a header content block `{ results: [...] }`.
 * - Oversized items become a stub in that header plus eager continuation
 *   envelopes (with `resultIndex`) as following content blocks.
 * - If nothing overflowed, identical to packaging the whole `{ results }` blob
 *   (including whole-blob split when many medium items exceed the cap together).
 */
export function packageBatchResultContent(userId: string, results: unknown[]): string[] {
  const entries: unknown[] = [];
  const overflowBlocks: string[] = [];
  let anyOverflow = false;
  let eagerOverflowItems = 0;
  const maxEagerItems = config.MAX_OVERFLOW_ITEMS;

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const text = JSON.stringify(item);
    if (text.length <= MAX_RESULT_CHARS) {
      entries.push(item);
      continue;
    }
    anyOverflow = true;
    const parts = packageResultContent(userId, text, { resultIndex: i });
    const first = JSON.parse(parts[0]) as ContinuationEnvelope;
    const partsIncluded = eagerOverflowItems < maxEagerItems;
    if (partsIncluded) eagerOverflowItems++;
    const stub: BatchOverflowStub = {
      truncated: true,
      continuationId: first.continuationId,
      totalParts: first.totalParts,
      totalChars: first.totalChars,
      complete: first.complete,
      resultIndex: i,
      partsIncluded,
      instruction: partsIncluded
        ? `execute_tools results[${i}] exceeded ${MAX_RESULT_CHARS} chars (${first.totalParts} parts, complete=${first.complete}). Concatenate every chunk from content blocks with continuationId="${first.continuationId}" in ascending part order, then JSON.parse to get this item ({ result } or { error }). Do not concatenate with other items' chunks. Use continue_tool_result only if a part was discarded.`
        : `execute_tools results[${i}] exceeded ${MAX_RESULT_CHARS} chars (${first.totalParts} parts, complete=${first.complete}). Parts deferred (MAX_OVERFLOW_ITEMS=${maxEagerItems} eager items already included in this response). Call continue_tool_result with continuationId="${first.continuationId}" (omit part) to fetch all stored parts as separate content blocks, then concatenate chunk fields in ascending part order and JSON.parse. Do not concatenate with other items' chunks.`,
    };
    entries.push(stub);
    if (partsIncluded) overflowBlocks.push(...parts);
  }

  const header = JSON.stringify({ results: entries });
  if (!anyOverflow) {
    return packageResultContent(userId, header);
  }
  if (header.length <= MAX_RESULT_CHARS) {
    return [header, ...overflowBlocks];
  }
  // Pathological: many stubs — split the header like any other oversized blob.
  return [...packageResultContent(userId, header), ...overflowBlocks];
}

export function getContinuationPart(
  userId: string,
  continuationId: string,
  part: number
): ContinuationEnvelope | { error: string } {
  const entry = lookupEntry(userId, continuationId);
  if ("error" in entry) return entry;
  const totalParts = totalPartsFor(entry.text.length);
  if (!Number.isInteger(part) || part < 1 || part > totalParts) {
    return { error: `part must be an integer from 1 to ${totalParts}` };
  }
  return buildEnvelope(
    continuationId,
    entry.text,
    part,
    entry.complete,
    "single",
    entry.resultIndex
  );
}

// Fetch one part, or all stored parts when `part` is omitted.
export function getContinuationParts(
  userId: string,
  continuationId: string,
  part?: number
): ContinuationEnvelope[] | { error: string } {
  const entry = lookupEntry(userId, continuationId);
  if ("error" in entry) return entry;
  const totalParts = totalPartsFor(entry.text.length);
  if (part === undefined) {
    return Array.from({ length: totalParts }, (_, i) =>
      buildEnvelope(continuationId, entry.text, i + 1, entry.complete, "all", entry.resultIndex)
    );
  }
  if (!Number.isInteger(part) || part < 1 || part > totalParts) {
    return { error: `part must be an integer from 1 to ${totalParts}` };
  }
  return [
    buildEnvelope(continuationId, entry.text, part, entry.complete, "single", entry.resultIndex),
  ];
}
