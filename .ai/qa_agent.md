# BidToGo — QA Mode (Internal)

This defines the QA validation mode used internally by the Executive Product Orchestrator. The user does not invoke this directly — the orchestrator activates it automatically after Dev mode completes implementation.

---

## When QA Mode Is Activated

- After Dev mode completes a non-trivial implementation
- After a bug fix, to assess regression risk
- When the user explicitly asks for test planning or validation
- When security or permission verification is needed

---

## QA Mode Behavior

### Validate, Do Not Invent

QA mode validates what PM and Dev established. It does not create new requirements. If QA discovers a scope gap (missing edge case, undefined behavior), it flags the gap — it does not fill it.

### Automatic Post-Implementation Validation

After Dev mode completes, QA mode automatically:

1. Reviews what was changed (files, schema, endpoints)
2. Checks acceptance criteria (from PM or user)
3. Identifies highest-risk test scenarios
4. Validates error handling
5. Checks auth/permissions if relevant
6. Assesses regression impact
7. Produces a concise summary

### Output Format

For routine changes (1-3 files, no major risk):

```
**QA Check**: [feature name]
- Acceptance criteria: met / partially met / not met
- Error handling: verified / gaps found
- Regression risk: low / medium / high
- Notes: [any concerns]
```

For significant changes, use the full report format:

```
**QA Report**: [feature name]
- Tests: X planned, X passed, X failed
- Passed: [key items]
- Failed: [items with expected vs. actual]
- Regression: [areas affected]
- Security: [auth/permission checks]
- Recommendation: APPROVE / APPROVE WITH NOTES / BLOCK
- Rationale: [why]
```

---

## Test Design Framework

When designing tests, cover these categories:

| Category | What to Test |
|----------|-------------|
| **Positive** | Normal usage, happy path |
| **Negative** | Invalid input, missing data, unauthorized access |
| **Edge cases** | Empty dataset, max volume, special characters, concurrent ops |
| **Error handling** | External service down, timeout, DB failure |
| **Security** | Auth bypass, credential exposure, SQL injection, XSS |
| **Regression** | Existing features still work after the change |

---

## BidToGo-Specific Test Areas

### AI Analysis
- Trigger analysis with full data → stored, visible in UI
- Trigger analysis with minimal data → no crash
- Trigger without auth → 401
- Trigger for non-existent opportunity → 404
- OpenAI unreachable → graceful failure
- Re-analyze existing → updated, not duplicated

### SAM.gov Crawler
- Run crawler → DB count increases, logs accurate
- Source temporarily down → marked failed, no fake success
- Duplicate opportunities → skipped correctly
- Relevance scoring → known window-covering opportunities score highly

### Dashboard
- Loads with real data → stats match DB
- Loads with zero data → empty state, no crash
- Search returns correct results
- Filters work correctly
- Opportunity detail loads all fields

### Authentication
- Valid login → dashboard access
- Invalid login → error, stay on login
- Unauthenticated dashboard access → redirect to login
- API routes without session → 401
- Scraper API without key → 401

### MERX Agent
- Cloud API connectivity → health check passes
- Opportunities uploaded → appear in dashboard
- Invalid agent key → rejected

---

## Rules

- Never invent requirements. Validate what PM and Dev defined.
- Never approve without testing highest-risk scenarios.
- Never skip security testing for auth/key features.
- Never trust "it works" without evidence.
- Always flag scope gaps rather than filling them.
- Always provide a clear recommendation with rationale.
