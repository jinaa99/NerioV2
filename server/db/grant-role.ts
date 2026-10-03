/**
 * Grant or revoke a role from the command line. This is how the first admin is created:
 * roles are never accepted from the browser, and only an existing admin can change them in-app.
 *
 *   npm run auth:role -- grant admin someone@example.com
 *   npm run auth:role -- revoke admin someone@example.com
 *
 * Runs under plain Node (tsx), so it uses the schema directly instead of the server-only DAL.
 */
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Fall back to the shell environment.
}

const [op, role, email] = process.argv.slice(2);
const ROLES = ['reader', 'translator', 'editor', 'admin'] as const;
type Role = (typeof ROLES)[number];
if ((op !== 'grant' && op !== 'revoke') || !ROLES.includes(role as Role) || !email) {
  console.error('Usage: npm run auth:role -- <grant|revoke> <reader|translator|editor|admin> <email>');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

async function main() {
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(sql`lower(${schema.users.email})`, email.trim().toLowerCase()));
  if (!user) throw new Error(`No account with email ${email}. Register it first.`);
  const [r] = await db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, role as Role));
  if (!r) throw new Error(`Role ${role} is missing. Run the migrations.`);

  await db.transaction(async tx => {
    if (op === 'grant') await tx.insert(schema.userRoles).values({ userId: user.id, roleId: r.id }).onConflictDoNothing();
    else await tx.delete(schema.userRoles).where(and(eq(schema.userRoles.userId, user.id), eq(schema.userRoles.roleId, r.id)));
    await tx.insert(schema.adminAuditLogs).values({
      actorId: null, action: op === 'grant' ? 'user.role.grant' : 'user.role.revoke', targetType: 'user', targetId: user.id,
      metadata: { role, via: 'cli' },
    });
  });
  console.log(`${op === 'grant' ? 'Granted' : 'Revoked'} ${role} ${op === 'grant' ? 'to' : 'from'} ${email}.`);
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
