import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/auth/encryption";

describe("encryption", () => {
  it("round-trips plaintext", () => {
    const original = "secret-token-123";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertext each time", () => {
    const encrypted1 = encrypt("same");
    const encrypted2 = encrypt("same");
    expect(encrypted1.toString("hex")).not.toBe(encrypted2.toString("hex"));
  });
});
