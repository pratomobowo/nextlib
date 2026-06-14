import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("Password Auth Helpers", () => {
  it("should hash and verify passwords successfully", () => {
    const password = "mySecurePassword123";
    const hash = hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).toContain(":");
    expect(hash.split(":").length).toBe(2);

    const isValid = verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it("should fail validation with an incorrect password", () => {
    const password = "mySecurePassword123";
    const hash = hashPassword(password);

    const isValid = verifyPassword("wrongPassword", hash);
    expect(isValid).toBe(false);
  });

  it("should generate unique hashes for the same password due to random salt", () => {
    const password = "testPassword";
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);

    expect(hash1).not.toBe(hash2);
    
    // Both should still verify successfully
    expect(verifyPassword(password, hash1)).toBe(true);
    expect(verifyPassword(password, hash2)).toBe(true);
  });

  it("should fail gracefully with malformed hashes", () => {
    expect(verifyPassword("password", "salt")).toBe(false);
    expect(verifyPassword("password", "")).toBe(false);
    expect(verifyPassword("password", "salt:hash:extra")).toBe(false);
  });
});
