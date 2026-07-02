# core/http

The **CJS→TS runtime bridge**. The app runs under `tsx`, so `server.js` (CommonJS)
can mount routers written in TypeScript.

## Files
- `container.ts` — composition root: builds the core services (`auth`, `rbac`,
  `geography`, `audit`, `notifications`) over the **existing** pg Pool (no second pool).
- `register.ts` — `registerCoreRoutes(app)`: mounts the TypeScript routers onto the
  Express app. Called synchronously from `server.js` (before the 404 handler), wrapped
  in try/catch so a failure can never take down the legacy API.

## Mounted routers
- `/api/v1/auth-v2` → `core/auth/auth.routes.ts`
- `/api/v1/geography` → `core/geography/geography.routes.ts`

## Adding a router
1. Export a `buildXRouter(services): Router` factory from the module.
2. `app.use('/api/v1/x', buildXRouter(services))` in `register.ts`.

Route handlers validate input with **Zod** and return the standard envelope
(`{ success, data|message }`, ADR-0009). Permission-guarded routes use
`core/rbac/requirePermission`.
