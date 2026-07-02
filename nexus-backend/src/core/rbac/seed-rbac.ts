/**
 * Seeds RBAC reference data from the single source of truth in @nexus/shared:
 * roles, permissions, and the role→permission map (expanding the super_admin
 * '*' wildcard to all concrete permissions). Also backfills existing legacy
 * users into geography-scoped grants (national scope for now — precise scoping
 * of legacy accounts happens when district strings are resolved in Step 0.7).
 *
 * Idempotent. Run with a Neon BRANCH url:
 *   pnpm --filter nexus-backend seed:rbac
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  PERMISSION_CODES,
  ROLE_PERMISSIONS,
  type Permission,
} from '@nexus/shared';
import { createDb } from '../../shared/db';

async function main(): Promise<void> {
  const { db, close } = createDb();

  // 1) Roles
  for (const role of ROLES) {
    await db.execute(sql`
      INSERT INTO roles (code, label) VALUES (${role}, ${ROLE_LABELS[role]})
      ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label
    `);
  }

  // 2) Permissions
  for (const code of PERMISSION_CODES) {
    await db.execute(sql`
      INSERT INTO permissions (code, description) VALUES (${code}, ${PERMISSIONS[code]})
      ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
    `);
  }

  // 3) role_permissions — rebuild cleanly from the map (expand '*' to all perms)
  await db.execute(sql`TRUNCATE role_permissions`);
  for (const role of ROLES) {
    const perms = ROLE_PERMISSIONS[role];
    const codes: Permission[] = perms.includes('*')
      ? PERMISSION_CODES
      : (perms as readonly Permission[]).slice();
    for (const code of codes) {
      await db.execute(sql`
        INSERT INTO role_permissions (role_code, permission_code) VALUES (${role}, ${code})
        ON CONFLICT DO NOTHING
      `);
    }
  }

  // 4) Backfill legacy users → scoped grants (national scope) where they have none
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role_code, place_id)
    SELECT u.id,
      CASE u.role
        WHEN 'admin'             THEN 'super_admin'
        WHEN 'district_officer'  THEN 'district_officer'
        WHEN 'sanitation_worker' THEN 'field_worker'
        WHEN 'school_admin'      THEN 'field_worker'
        WHEN 'ngo_staff'         THEN 'ngo_partner'
        ELSE 'citizen'
      END,
      NULL
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
  `);

  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM roles)::int            AS roles,
      (SELECT count(*) FROM permissions)::int      AS permissions,
      (SELECT count(*) FROM role_permissions)::int AS role_permissions,
      (SELECT count(*) FROM user_roles)::int       AS user_roles
  `);
  console.log('[seed:rbac]', JSON.stringify(counts.rows[0]));
  console.log('[seed:rbac] done.');
  await close();
}

main().catch((err) => {
  console.error('[seed:rbac] failed:', err);
  process.exit(1);
});
