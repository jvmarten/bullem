import bcrypt from 'bcrypt';

/** Cost factor for bcrypt hashing. 12 is a good balance of security and speed. */
const SALT_ROUNDS = 12;

/** Hash a plaintext password using bcrypt. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/** Verify a plaintext password against a bcrypt hash. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
