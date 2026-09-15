# OpenCode Prompts

Implementation prompts used for each build phase, recorded verbatim so the
build can be reproduced or audited. Source of truth for phase scope is
`build-plan-deep-dive.md` (do not modify that file).

## Phase 0 — Scaffolding

> Read the `buildplan.md` file and find the phase I specify.
>
> For example: "Build Phase 1"
>
> Before implementing:
> 1. Read the complete Phase 1 requirements from `buildplan.md`.
> 2. Inspect the existing project structure and code.
> 3. Check what has already been implemented.
> 4. Implement ONLY Phase 1. Do not implement future phases.
> 5. Follow the architecture and tech stack defined in the project.
> 6. Add the required tests and run them.
> 7. Fix any errors found during testing.
> 8. Verify the phase against its completion/acceptance criteria.
>
> Also create or update:
>
> `docs/opencode-prompts.md`
>
> Add the exact prompt/instructions used for this phase under the correct phase heading so that the implementation prompt is documented.
>
> Do not modify `buildplan.md`.
>
> At the end, report:
> - What was implemented
> - Files created/modified
> - Tests added/run
> - Test results
> - Whether the phase acceptance criteria are satisfied

Notes on execution (Phase 0):

- No `buildplan.md` existed in the repo; `build-plan-deep-dive.md` was used
  as the phase plan, and `architecture-design.md` as the stack authority.
- Requested phase at runtime: **Phase 0 — Scaffolding**.
- Scope implemented: backend FastAPI skeleton (`app/main.py`,
  `app/core/config.py`, `app/core/db.py`, `app/api/health.py`, Alembic
  `env.py` wired to `core.db` metadata), patient Vite app shell
  (`frontend/apps/patient/src/main.tsx`), shared Axios client
  (`frontend/shared/api/client.ts`), shadcn placeholder
  (`frontend/shared/ui/`), infra compose with postgres/redis/backend/frontend
  plus `infra/.env.example` covering every required key.
- No Phase 1+ code (auth, models, routers) was added.
