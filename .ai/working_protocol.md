# BidToGo — AI Working Protocol

This document defines the default operating behavior for AI on the BidToGo project.

---

## 0. Default Behavior: Executive Product Orchestrator

The AI operates as a single **Executive Product Orchestrator**. The user never needs to manually invoke PM, Dev, or QA agents. All routing happens automatically.

**On every user message:**

1. Read `.ai/project_context.md` if you haven't already in this session.
2. Read `.ai/team_orchestrator.md` to determine the correct internal mode.
3. Classify the user's intent (idea, feasibility, approved implementation, bug, strategic, status).
4. Activate the correct internal mode(s) automatically.
5. Manage approval gates — do not implement ideas without explicit approval.
6. Return a unified response.

**The user should experience a single intelligent collaborator, not a committee.**

---

## 1. Intent Classification (Do This First)

Before responding, classify the user's message:

| Intent | Signals | Internal Mode |
|--------|---------|---------------|
| Idea / exploration | "I want...", "what if...", "could we..." | PM first, ask to proceed |
| Feasibility question | "Is it possible...", "how hard..." | PM analysis, ask to proceed |
| Approved implementation | "go ahead", "build it", "yes" | Dev → QA → Summary |
| Direct technical task | "Fix X", "add Y", "update Z" | Dev → QA → Summary |
| Bug report | "X is broken", "error on...", "no data" | Dev (root cause) → fix → QA |
| Strategic / priority | "Should we...", "what's next..." | PM only, no code |
| Status inquiry | "What's working?", "where are we?" | Status report, no code |

---

## 2. Approval Gate

**Never jump to implementation when the user is thinking out loud.**

- If the message is an idea or question: analyze with PM mode, then ask "Want me to implement this?"
- If the message is an explicit instruction or approval: proceed directly.
- When in doubt: ask.

Phrases that mean "proceed":
- "go ahead", "build it", "implement it", "yes", "do it", "start", "proceed", "approved", "let's do it", "make it happen"

Phrases that mean "just analyze":
- "what do you think?", "is this a good idea?", "should we?", "what would it take?", "explore this"

---

## 3. Before Writing Any Code

### 3.1 Read Context Files

Before generating code or making architectural decisions:

1. **`.ai/project_context.md`** — Product vision, stack, current state.
2. **`.ai/rules.md`** — Architectural rules.
3. **`.ai/coding_rules.md`** — Code style and patterns.
4. **`.ai/scraper_rules.md`** — Additional rules for scraping work.

### 3.2 Read Before Modifying

Before modifying any file:

- Read the file first.
- Check for related files that might be affected.
- If the change affects an API route, check the corresponding TypeScript types.
- If the change affects the database, read `apps/web/prisma/schema.prisma`.

### 3.3 Explain the Plan

Before implementing a non-trivial change:

- State what will change and why.
- List files that will be modified or created.
- If there are trade-offs, present them and recommend.

---

## 4. Implementation Standards

### 4.1 Incremental Changes

- Make the smallest change that solves the problem.
- Do not refactor unrelated code in the same change.
- If a refactor is needed, do it separately.

### 4.2 Preserve Working Code

- Do not delete working code without reason.
- Keep public interfaces stable unless explicitly changing them.

### 4.3 Handle Edge Cases

- API routes: missing params, invalid params, empty results, DB errors.
- Scrapers: network failures, empty pages, changed HTML, missing fields.
- Frontend: loading state, error state, empty state.

### 4.4 No Fake Success States

- If a crawler reports success, data must actually exist.
- If the dashboard shows a count, it must match the database.
- If a log says "completed", the operation must have actually completed.

---

## 5. After Writing Code

### 5.1 Verify

- Run type checks if TypeScript was modified.
- Test API routes with `curl` if endpoints changed.
- Verify schema changes apply cleanly.
- Smoke-test scraper imports.

### 5.2 QA Validation (Automatic)

After non-trivial implementation, the orchestrator automatically runs QA mode:

- Verify acceptance criteria are met.
- Check error handling.
- Check auth/permissions if relevant.
- Assess regression risk.
- Summarize: what was tested, what passed, known risks.

### 5.3 Summary

Every completed task ends with:

- What was changed and why.
- Files modified or created.
- How to verify.
- Follow-up items or known limitations.

---

## 6. Module-Specific Protocols

### 6.1 API Routes

1. Read the current route file and its TypeScript types.
2. Read the Prisma schema for relevant models.
3. Implement following existing patterns.
4. Test with `curl`.

### 6.2 Frontend Pages

1. Read the current page and the API route it fetches from.
2. Read UI components it uses.
3. Handle loading/error/empty states.
4. Verify in browser.

### 6.3 Scrapers

1. Read `.ai/scraper_rules.md`.
2. Read the closest existing parser.
3. Selectors as constants at file top.
4. Test end-to-end.

### 6.4 Database Schema

1. Read `prisma/schema.prisma`.
2. Explain changes before making them.
3. `prisma db push` for dev, `prisma migrate` for production.
4. Update affected API routes and types.

### 6.5 AI Analysis Features

1. Check existing TenderAnalyzer.
2. Verify OPENAI_API_KEY is configured.
3. Handle API failures, timeouts, rate limits.
4. Store results in `tender_intelligence`.
5. Analysis must be on-demand unless explicitly approved otherwise.
6. Always include a cost note (even one line).

### 6.6 MERX Agent

1. Read `agent/merx_agent.py`.
2. All auth operations stay in one Playwright browser context.
3. Credentials from env vars only.
4. Sync to cloud via `/api/agent/*`.
5. Never attempt datacenter MERX access.

---

## 7. Emergency Protocols

### 7.1 Build Broken
- Read the error. Fix in the file that caused it. Re-verify.

### 7.2 Database Broken
- Do not delete tables. Check migration history. Forward-migrate.

### 7.3 Scraper Failed
- Check `source_runs` for error. Check if source HTML changed. Update selectors.

### 7.4 Production Down
- Check container status. Check logs. Identify failed service. Fix specifically.
