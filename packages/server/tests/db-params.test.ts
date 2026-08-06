import { describe, it, expect } from "vitest";
import { toPgParams } from "../src/db-postgres";

// Pure function — runs on every platform, no database needed.
describe("toPgParams", () => {
  it("numbers placeholders left to right", () => {
    expect(toPgParams("INSERT INTO t (a, b, c) VALUES (?, ?, ?)")).toBe(
      "INSERT INTO t (a, b, c) VALUES ($1, $2, $3)"
    );
  });

  it("leaves a ? inside a string literal alone", () => {
    expect(toPgParams("SELECT * FROM t WHERE path LIKE '%?%' AND id = ?")).toBe(
      "SELECT * FROM t WHERE path LIKE '%?%' AND id = $1"
    );
  });

  it("handles a doubled quote inside a string literal", () => {
    expect(toPgParams("SELECT 'it''s ? here', ? FROM t")).toBe("SELECT 'it''s ? here', $1 FROM t");
  });

  it("leaves a ? inside a quoted identifier alone", () => {
    expect(toPgParams('SELECT "weird?col" FROM t WHERE id = ?')).toBe('SELECT "weird?col" FROM t WHERE id = $1');
  });

  it("leaves a ? inside a line comment alone", () => {
    expect(toPgParams("SELECT 1 -- what? \nWHERE id = ?")).toBe("SELECT 1 -- what? \nWHERE id = $1");
  });

  it("leaves a ? inside a block comment alone", () => {
    expect(toPgParams("SELECT /* really? */ 1 WHERE id = ?")).toBe("SELECT /* really? */ 1 WHERE id = $1");
  });

  it("leaves a ? inside a dollar-quoted string alone", () => {
    expect(toPgParams("SELECT $tag$a ? b$tag$, ?")).toBe("SELECT $tag$a ? b$tag$, $1");
  });

  it("does not mangle the JSONB ?| and ?& operators", () => {
    expect(toPgParams("SELECT * FROM t WHERE meta ?| ARRAY['a'] AND id = ?")).toBe(
      "SELECT * FROM t WHERE meta ?| ARRAY['a'] AND id = $1"
    );
    expect(toPgParams("SELECT * FROM t WHERE meta ?& ARRAY['a'] AND id = ?")).toBe(
      "SELECT * FROM t WHERE meta ?& ARRAY['a'] AND id = $1"
    );
  });

  it("passes SQL with no placeholders through untouched", () => {
    const sql = "SELECT count(*) FROM users";
    expect(toPgParams(sql)).toBe(sql);
  });
});
