# BidToGo — Internal Handoff Templates

These templates are used internally by the Executive Product Orchestrator when transitioning between PM, Architect, Designer, Dev, and QA modes. The user does not see these transitions — they happen automatically inside a single unified response.

These templates exist to ensure structured thinking between modes, not to create visible bureaucracy.

---

## 1. PM → Architect (Internal)

When a PM-scoped feature has cross-module, pipeline, or schema impact, Architect mode runs before Dev:

**Checklist** (mental, not shown to user):
- [ ] Which modules/services are affected?
- [ ] Does the data pipeline change?
- [ ] Are schema changes required?
- [ ] Is there a migration path from the current state?
- [ ] Can this be implemented incrementally without a production outage?

**Architect must define**:
- Module boundaries for the feature
- Data flow changes (if any)
- Schema changes (if any)
- Migration path
- What Dev should build first, second, etc.

---

## 2. PM → Dev (Internal)

When the orchestrator transitions from PM analysis to Dev implementation:

**Checklist** (mental, not shown to user):
- [ ] Objective is clear
- [ ] MVP scope is defined
- [ ] Non-goals are identified
- [ ] Acceptance criteria exist (even if brief)
- [ ] Cost/token impact noted (if AI-related)
- [ ] User has approved implementation

**Minimum acceptance criteria format**:
```
- AC1: [testable criterion]
- AC2: [testable criterion]
```

Even for small features, at least 2 acceptance criteria must exist before Dev mode proceeds.

---

## 3. Designer → Dev (Internal)

When the orchestrator transitions from Designer layout spec to Dev implementation:

**Checklist** (mental, not shown to user):
- [ ] Information hierarchy is defined (what appears first, second, etc.)
- [ ] Layout structure is described (sidebar + main, full-width table, split panel, etc.)
- [ ] Key components are identified with purpose and priority
- [ ] All UI states are defined (loading, empty, error, populated)
- [ ] Developer-friendly notes reference shadcn/ui components and Tailwind patterns

**Dev must know**:
- What the layout structure is
- What components to build and in what hierarchy
- What states to handle
- What the priority order of information is

---

## 4. Dev → QA (Internal)

When the orchestrator transitions from Dev implementation to QA validation:

**Checklist** (mental, not shown to user):
- [ ] Files changed are identified
- [ ] Schema changes noted (if any)
- [ ] Endpoints changed noted (if any)
- [ ] Expected behaviors are clear
- [ ] Known risks identified

**QA must know**:
- What was changed
- What should work now that didn't before
- What might break

---

## 5. QA → Summary (Visible to User)

The final output the user sees after a complete PM → Dev → QA cycle:

```
**Done.** [One-sentence summary of what was accomplished.]

**What was built**:
- [Key changes, 2-5 bullets]

**Files changed**:
- [file list]

**How to test**:
1. [Step 1]
2. [Step 2]

**QA result**: [pass/pass with notes/issues found]

**Known risks**: [any, or "none"]

**Follow-up**: [next steps if any, or "none needed"]
```

---

## 6. Bug Fix Summary (Visible to User)

The final output after a bug fix cycle:

```
**Fixed.** [One-sentence summary.]

**Root cause**: [What was broken and why]

**Fix applied**: [What was changed]

**Files changed**:
- [file list]

**Regression risk**: [low/medium/high + explanation]

**How to verify**: [steps]
```

---

## 7. PM-Only Analysis (Visible to User)

When the orchestrator only runs PM mode (idea exploration, prioritization):

```
**Analysis**: [feature/question name]

[3-5 bullet analysis covering: problem, feasibility, scope, cost, priority]

**Recommendation**: [what to do]

**Want me to implement this?** / **What would you like to focus on?**
```

---

## 8. Bug Report (When QA Finds Issues)

If QA mode discovers a problem during validation:

```
**Issue found**: [short title]
- **Severity**: Critical / High / Medium / Low
- **What happens**: [actual behavior]
- **Expected**: [correct behavior]
- **Where**: [file/route/component]
- **Suggested fix**: [if obvious]
```

This is reported inline in the response, not as a separate handoff document.
