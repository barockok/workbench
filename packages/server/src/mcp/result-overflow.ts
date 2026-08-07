import crypto from "node:crypto";
import { config } from "../config";

// Oversized tool results are split into ~MAX_RESULT_CHARS chunks and held here
// briefly so the agent can fetch subsequent parts via continue_tool_result
// instead of receiving a mid-string truncation.
// See docs/findings/2026-08-07-mcp-result-overflow-continuation.md

export const MAX_RESULT_CHARS = 60_000;
// Room for the continuation envelope (metadata + instruction) around each chunk.
const ENVELOPE_RESERVE = 2_000;
export const CHUNK_CHARS = MAX_RESULT_CHARS - ENVELOPE_RESERVE;

const TTL_MS = 10 * 60 * 1000;

interface OverflowEntry {
  userId: string;
  text: string;
  complete: boolean;
  expiresAt: number;
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
};

function totalPartsFor(length: number): number {
  return Math.max(1, Math.ceil(length / CHUNK_CHARS));
}

function buildEnvelope(
  continuationId: string,
  text: string,
  part: number,
  complete: boolean
): ContinuationEnvelope {
  const totalParts = totalPartsFor(text.length);
  const start = (part - 1) * CHUNK_CHARS;
  const chunk = text.slice(start, start + CHUNK_CHARS);
  const hasMore = part < totalParts;
  const nextPart = hasMore ? part + 1 : null;
  let instruction: string;
  if (hasMore) {
    instruction = `Result exceeded ${MAX_RESULT_CHARS} chars (showing part ${part} of ${totalParts}). Call continue_tool_result with continuationId="${continuationId}" and part=${nextPart} to fetch the next chunk. Keep calling until hasMore is false, then concatenate every chunk field in order to reconstruct the full tool result JSON.`;
  } else if (complete) {
    instruction = `This is the final chunk (part ${part} of ${totalParts}). Concatenate every chunk field in order to reconstruct the full tool result JSON.`;
  } else {
    instruction = `This is the last available chunk (part ${part} of ${totalParts}). Further content was omitted (MAX_OVERFLOW_PARTS=${config.MAX_OVERFLOW_PARTS}). Concatenate every chunk field in order to reconstruct the available tool result JSON.`;
  }
  return {
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
}

/** Store an oversized payload and return a JSON envelope for part 1 (≤ MAX_RESULT_CHARS). */
export function packageResultText(userId: string, text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;

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
  });

  const envelope = buildEnvelope(continuationId, stored, 1, complete);
  const encoded = JSON.stringify(envelope);
  // Safety: if the envelope somehow exceeds the cap, shrink the chunk.
  if (encoded.length <= MAX_RESULT_CHARS) return encoded;
  const shrink = encoded.length - MAX_RESULT_CHARS;
  envelope.chunk = envelope.chunk.slice(0, Math.max(0, envelope.chunk.length - shrink - 8));
  return JSON.stringify(envelope);
}

export function getContinuationPart(
  userId: string,
  continuationId: string,
  part: number
): ContinuationEnvelope | { error: string } {
  reapExpired();
  const entry = store.get(continuationId);
  if (!entry || entry.userId !== userId) {
    return { error: "Unknown or expired continuationId" };
  }
  if (entry.expiresAt < now()) {
    store.delete(continuationId);
    return { error: "Unknown or expired continuationId" };
  }
  const totalParts = totalPartsFor(entry.text.length);
  if (!Number.isInteger(part) || part < 1 || part > totalParts) {
    return { error: `part must be an integer from 1 to ${totalParts}` };
  }
  return buildEnvelope(continuationId, entry.text, part, entry.complete);
}
