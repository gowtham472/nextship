# AGENTS.md: working rules for this repository

Binding instructions for every contributor, human or agent, working in this repo.
Read this before making any change. A change that violates these rules is not done,
regardless of whether it works.

**Maintainer:** Gowtham, author of the core and the first version.

---

## 1. Attribution: every change records who made it

Authorship is tracked in three places, each with a distinct job. All three are required.

### 1.1 `CHANGELOG.md`, the source of truth

Every change that touches behaviour, structure, or documentation gets an entry.
No entry, no merge.

```markdown
## [Unreleased]

### Added
- CLI `detect` / `build` / `package` pipeline. Resolves the project, runs the
  adapter-injected build, produces a runtime image. (Gowtham)
```

Format rules:

- Group under `Added`, `Changed`, `Fixed`, `Removed`, or `Docs`.
- End every bullet with the author in parentheses: `(Gowtham)`. Multiple authors:
  `(Gowtham, Name)`.
- Say what changed and why it matters, not which files moved.
- Move `[Unreleased]` into a dated version section at release.

### 1.2 Module header, who created the file

Every source file opens with a docblock naming its original author. This records
creation only. It never changes when someone else edits the file, so it cannot go stale.

```ts
/**
 * @nextship/cli: project detection
 *
 * <one paragraph: what this module does and why it exists>
 *
 * Author: Gowtham
 * Design: ../../docs/00-design.md §8
 */
```

### 1.3 Git commit trailers, who made each commit

Once the repository is initialised with git, every commit ends with an authorship trailer:

```
Co-Authored-By: Gowtham <email>
```

Commits made with agent assistance additionally carry the agent's trailer. Never
attribute a change to someone who did not make it.

---

## 2. Documentation stays in sync, in the same change

Docs are part of the change, not a follow-up. A commit that alters behaviour and
leaves the docs describing the old behaviour is an incomplete commit.

When you change something, update every affected surface before you finish:

| If you change | You must update |
|---|---|
| Any CLI command, flag, or output | `README.md` (commands and UX), `docs/00-design.md` |
| The manifest schema | `docs/00-design.md` §5.1, the adapter, and every consumer |
| Architecture or a locked decision | `docs/00-design.md` §2, and record the reversal in `CHANGELOG.md` |
| Phase scope or sequencing | `docs/01-roadmap.md` |
| Anything a user can observe | `README.md` |
| Anything at all | `CHANGELOG.md` |

Rules:

- **Never let a doc describe something that does not exist.** Aspirational text
  belongs in `docs/01-roadmap.md`, marked as a future phase, and nowhere else.
- **Never leave a doc describing something that was removed.** Deleting code means
  deleting its documentation in the same change.
- Docs reference each other by path and section, for example `docs/00-design.md §7`,
  so a renamed section is a real and findable break.

---

## 3. Every line must earn its place

No dead code. No hanging code. No decoration.

### 3.1 Prohibited

- **Stub functions** that return an empty or fabricated value so a call site type-checks.
  If the logic does not exist, do not create the function or its call.
- **Unused exports, parameters, imports, types, or fields.** If nothing consumes it,
  delete it.
- **Speculative structure** built for a feature that is not being implemented now:
  abstractions with one implementation and no second caller, config options nothing
  reads, interfaces nothing satisfies.
- **Manifest or config fields with no consumer.** The manifest is versioned. Add a
  field in the change that starts reading it, not before.
- **Commented-out code.** Version control already remembers it.
- **Fabricated values.** Never emit a path, endpoint, or capability the system does
  not actually provide. A health check path that nothing serves is a bug, not a placeholder.

### 3.2 How to express work that is deliberately deferred

Deferred work is a documented decision, never an artefact in the code:

- Scope not being built now becomes a phase entry in `docs/01-roadmap.md`.
- A known limitation of what shipped becomes a named limitation in `docs/00-design.md`.
- A genuine seam for a planned swap is allowed only when the interface is consumed
  today by the implementation that exists, and the docs name the future
  implementation. An interface with zero implementations is speculative structure.

A `TODO` comment is acceptable only when it marks a specific, near-term task already
tracked in the roadmap, and the surrounding code is complete and correct without it.
`TODO` is never a substitute for the code being finished.

### 3.3 Comments

Comment the why, never the what. The bar: a comment must tell the reader something
the code cannot. Most valuable here are comments recording a non-obvious external
constraint, such as a Next.js requirement, a cloud provider behaviour, or a failure
mode that is silent without the line above it. Delete any comment that restates the code.

---

## 4. Consistency: the codebase reads as one system

Two contributors solving the same kind of problem should produce the same shape of
solution. Before adding a new pattern, find the existing one and follow it.

### 4.1 Writing style

- **No em dashes or en dashes.** Use a colon to introduce, a comma to join, or
  parentheses to set aside. Rewrite the sentence rather than reaching for a dash.
- Sentence case for all headings.
- Second person for user-facing docs, plain imperative for instructions.
- One term per concept, everywhere. It is a **deployment**, never a "release" or a
  "push". It is the **manifest**, never a "config" or a "descriptor". It is a
  **target**, never a "provider" or a "platform". Fix drift when you find it.
- Code, paths, commands, and field names go in backticks in prose.

### 4.2 Code

- TypeScript throughout, ESM only, no CommonJS.
- Named exports for functions and types. A default export only where an external
  contract requires one, for example the cache handler.
- `camelCase` for values and functions, `PascalCase` for types and interfaces,
  `SCREAMING_SNAKE_CASE` for environment variables, `kebab-case` for file names.
- One module, one responsibility. A file that needs the word "and" to describe it
  should be two files.
- Errors: throw a typed error carrying a message that tells the user what to do next.
  Never throw a bare string. Never swallow an error silently unless the surrounding
  contract requires it, and when it does, say why in a comment.
- Async/await only, never raw `.then()` chains.
- No default parameter values that hide a required decision.

### 4.3 Command output

- Every command reports progress as discrete steps in the same visual format.
- Success lines state the result, not the effort. Failure lines state the cause and
  the next action.
- Never print a URL, identifier, or status that was not actually produced.

---

## 5. Correctness

- The **Next.js adapter compatibility test suite** is the arbiter of whether the
  adapter works. Claims of support come from suite results, never from inspection.
- **Streaming must be verified, not assumed.** A buffering proxy leaves PPR and
  Suspense apparently working while delivering none of the benefit. Any new
  deployment target ships with the streaming conformance test passing.
- Never claim a capability in docs or output that has not been observed working on
  a real target.
- **Logic has automated tests.** Detection, rendering, and anything that transforms
  input into output is covered by `node:test` cases that run with `pnpm test`.
  Error paths are tested, not just the happy path. A change that alters behaviour
  updates or adds the tests in the same change.
- **Failures are precise.** A production tool never rotates a secret, silently
  substitutes a default, or continues past a state it cannot explain. When a file
  exists but is unreadable, that is an error with a next action, not a cache miss.

---

## 6. Definition of done

A change is complete when all of the following are true:

- [ ] Every line has a consumer and a reason to exist (§3)
- [ ] It follows the existing patterns, naming, and terminology (§4)
- [ ] No em dashes in any prose, comment, or output (§4.1)
- [ ] Module headers name their author (§1.2)
- [ ] `CHANGELOG.md` has an attributed entry (§1.1)
- [ ] `README.md` and `docs/` describe exactly what now exists, no more and no less (§2)
- [ ] No fabricated paths, endpoints, or capabilities (§3.1)
- [ ] Claims about behaviour are backed by something that was run (§5)
- [ ] `pnpm typecheck` and `pnpm test` both pass (§5)
