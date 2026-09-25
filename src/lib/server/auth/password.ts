import "server-only";
import * as argon2 from "argon2";
import { passwordSchema } from "../../validation/auth";

export async function hashPassword(password: string): Promise<string> {
  const validatedPassword = passwordSchema.parse(password);

  return argon2.hash(validatedPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (
    password.length === 0 ||
    password.length > 128 ||
    !storedHash.startsWith("$argon2id$")
  ) {
    return false;
  }

  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}