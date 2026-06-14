import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const ITERATIONS = 10000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

/**
 * Hash a plain text password using PBKDF2-SHA512.
 * Returns the hash formatted as "salt:hashHex".
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a plain text password against a stored PBKDF2 hash.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const verifyHash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(verifyHash, "hex"));
}
