import bcrypt from "bcryptjs";
import { pgPool, ensureUsersTable } from "./pg";

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

export async function createUser(email: string, password: string): Promise<User> {
  await ensureUsersTable();
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pgPool.query<UserRow>(
    `INSERT INTO users (email, password_hash)
     VALUES (LOWER($1), $2)
     RETURNING id, email, created_at`,
    [email, hash],
  );
  return { id: rows[0].id, email: rows[0].email, createdAt: rows[0].created_at };
}

export async function findUserByEmail(
  email: string,
): Promise<{ id: string; email: string; passwordHash: string } | null> {
  await ensureUsersTable();
  const { rows } = await pgPool.query<UserRow>(
    `SELECT id, email, password_hash FROM users WHERE LOWER(email) = LOWER($1)`,
    [email],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash };
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
