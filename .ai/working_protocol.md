# LeadHarvest — AI Working Protocol

This document defines how an AI assistant should behave when working on the LeadHarvest project. Follow these rules on every interaction.

---

## 1. Before Writing Any Code

### 1.1 Read the Context Files

Before generating code, making architectural decisions, or modifying the database schema, read these files in order:

1. **`.ai/project_context.md`** — Understand what the project is, who it serves, and what the business goals are.
2. **`.ai/rules.md`** — Understand the architectural rules that must not be violated.
3. **`.ai/coding_rules.md`** — Understand the code style and implementation patterns.
4. **`.ai/scraper_rules.md`** — Read this additionally when working on scraping, parsing, or data collection features.

### 1.2 Understand the Current State

Before modifying a file:

- Read the file first. Understand its current structure and purpose.
- Check for related files that might be affected by the change.
- If the change affects an API route, check the corresponding TypeScript interface in `apps/web/src/types/index.ts`.
- If the change affects the database, read `apps/web/prisma/schema.prisma` to understand the current schema.

### 1.3 Explain the Plan

Before implementing a non-trivial change:

- State what will change and why.
- List the files that will be modified or created.
- If there are trade-offs, present them and recommend an approach.
- Wait for confirmation before proceeding on large changes.

---

## 2. While Writing Code

### 2.1 Follow the Rules

- **Architecture**: Follow `rules.md`. Never bypass the data pipeline. Never let the frontend query the database directly. Never let scrapers skip normalization or scoring.
- **Code style**: Follow `coding_rules.md`. Use TypeScript strictly. Use Pydantic models in Python. Handle errors in every handler. No dead code.
- **Scraping**: Follow `scraper_rules.md`. Respect robots.txt. Respect rate limits. Never bypass access controls. Log every request.

### 2.2 Incremental Changes

- Make the smallest change that solves the problem.
- Do not refactor unrelated code in the same change.
- If a refactor is needed, do it as a separate step before or after the feature change.
- If a file is working correctly, do not rewrite it "for consistency" unless explicitly asked.

### 2.3 Preserve Working Code

- Do not delete or overwrite working code without a clear reason.
- If you need to replace a function, verify that nothing else depends on the old behavior.
- When modifying a component, keep its public interface stable unless the change explicitly requires an interface change.

### 2.4 Handle Edge Cases

- Every API route must handle: missing parameters, invalid parameters, empty results, database errors.
- Every scraper must handle: network failures, empty pages, changed HTML structure, missing fields.
- Every frontend component must handle: loading state, error state, empty state.

---

## 3. After Writing Code

### 3.1 Verify

- Run the TypeScript compiler (`npx tsc --noEmit`) to check for type errors.
- If you modified API routes, test them with `curl` to verify the response shape.
- If you modified the database schema, run `prisma db push` to verify it applies cleanly.
- If you modified scraper code, run a smoke test (`python -c "from src.module import ..."`) to verify imports.

### 3.2 Update Documentation

If the change affects:

| Area | Update |
|------|--------|
| API endpoints | README.md API table |
| Database schema | `docs/DATABASE.md` |
| Architecture | `docs/architecture.md` |
| Scraper sources | `data/sources.yaml` |
| Product features | `docs/PRD.md` |
| Keyword lists | Note in commit message |

### 3.3 Summarize

After completing a change, provide a concise summary:

- What was changed and why.
- Which files were modified or created.
- How to verify the change works.
- Any follow-up items or known limitations.

---

## 4. Behavioral Rules

### 4.1 Do

- Read files before modifying them.
- Check for existing utilities before writing new helper functions.
- Use the project's established patterns (Prisma for DB, Zod for validation, cn() for classes, etc.).
- Keep responses focused on the task. Provide context, but do not over-explain obvious things.
- Ask clarifying questions when requirements are ambiguous.
- Track progress with the todo list on multi-step tasks.

### 4.2 Do Not

- Do not rewrite entire files when a targeted edit suffices.
- Do not change the database schema without explaining what is changing and why.
- Do not introduce new dependencies without justification.
- Do not generate code that bypasses login systems, CAPTCHAs, paywalls, or access controls.
- Do not hardcode credentials, API keys, or environment-specific values in source files.
- Do not create documentation files unless explicitly requested.
- Do not add explanatory comments that merely narrate what the code does. Comments should explain non-obvious intent.

### 4.3 When Unsure

- If you are unsure about the right approach, read the relevant `.ai/` rule file.
- If the rule files do not cover the situation, ask the user for guidance.
- If the change could break existing functionality, say so explicitly and ask for confirmation.
- If the task is large (5+ files, architectural implications), propose a plan first.

---

## 5. Module-Specific Protocols

### 5.1 Working on API Routes

1. Read the current route file.
2. Read the TypeScript interface in `types/index.ts` that corresponds to the response shape.
3. Read the Prisma schema for the relevant models.
4. Implement the route following the patterns in existing routes (error handling, response shape, Zod validation).
5. Test with `curl` after implementation.

### 5.2 Working on Frontend Pages

1. Read the current page file.
2. Read the API route it fetches from to understand the response shape.
3. Read the UI components it uses from `components/ui/`.
4. Modify the page following the established pattern (useEffect + useState, loading/error/empty states, cn() for classes).
5. Verify the page loads in the browser.

### 5.3 Working on Scrapers

1. Read `.ai/scraper_rules.md` first.
2. Read the existing crawler/parser that is closest to the new source.
3. Check `data/sources.yaml` for the source configuration.
4. Implement the parser with selectors as constants at the top of the file.
5. Write a unit test with a saved HTML fixture.
6. Test end-to-end with a manual crawl trigger.
7. Add the source to `data/sources.yaml`.

### 5.4 Working on the Database Schema

1. Read `apps/web/prisma/schema.prisma`.
2. Read `docs/DATABASE.md`.
3. Explain what is changing and why before modifying.
4. Make the change in `schema.prisma`.
5. Run `prisma db push` (development) or create a migration (production).
6. If the change involves tsvector, GIN indexes, or generated columns, update `setup-search.sql`.
7. Update `docs/DATABASE.md`.
8. Update any API routes and TypeScript types that are affected.

---

## 6. Emergency Protocols

### 6.1 If You Break the Build

- Read the error message carefully.
- Check if the error is in the file you just modified.
- Fix the error in the same file — do not work around it in another file.
- Run the TypeScript compiler again to verify the fix.

### 6.2 If You Break the Database

- Do not attempt to fix the schema by deleting tables.
- Check the Prisma migration history.
- If in development, `prisma db push` can reconcile. If in production, create a forward migration.

### 6.3 If a Scraper Fails

- Check the `source_runs` table for the error message.
- Check if the source website has changed its HTML structure.
- Update the parser selectors if needed.
- Never retry a failed crawl without understanding why it failed.
