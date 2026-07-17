# Product

## Register

product

## Platform

web

## Users

Primary: people who installed `@bytetrue/pi-vendor` and need to manage custom providers and models for the Pi coding agent. Secondary: the package author, using the same full manager when TUI shortcuts are not enough.

Context is local and intentional — they open the manager from Pi (`/vendor` or `/vendor web`), edit a draft, then save or cancel. They are mid-config work, not browsing a marketing site.

Job to be done: add or change providers and models in `models.json` without corrupting the file, leaking secrets into the browser, or leaving Pi unable to load the result.

## Product Purpose

pi-vendor’s Web surface is the full manager for custom providers and models. It pairs with high-frequency TUI flows: TUI for the short path, Web for complete edit (structured form, optional fields, catalog/import, raw JSON).

Success: the user finishes a session with either a single validated atomic write that Pi can use immediately, or a clean cancel that changes nothing. Secrets stay opaque in the browser; conflicts and validation failures are recoverable without silent data loss.

## Positioning

A loopback, one-shot full manager for `models.json` — validation, revision checks, and secret keep-values — shared domain core with TUI, no daemon and no cloud.

## Brand Personality

Fast · Technical · Minimal.

Voice is direct and operational: state what happened, what failed, and what to do next. Emotion goal is quiet confidence under config risk — the UI should feel like a precise tool, not a product tour.

References that fit the feel: Linear and Raycast — clean product-tool density, clear hierarchy, little chrome, high signal-to-noise.

## Anti-references

- Generic SaaS admin: card walls, oversized rounding, marketing gradients, empty section eyebrows.
- Legacy admin / phpMyAdmin: gray table dumps, every field equally loud, no task focus.

## Design Principles

1. **Task over chrome** — every screen answers “edit this provider/model and leave”; decoration that does not help the edit is cut.
2. **Fail closed, recover clearly** — secrets, revision conflicts, and invalid config never fail soft into corrupted disk; messages name the recovery path.
3. **One draft, one write** — structured form and raw JSON are the same draft; save is one commit or none.
4. **Local and temporary** — the manager is a modal session, not a product home; open, finish, close.
5. **Density with calm** — technical users get information density without visual noise; hierarchy and spacing do the work, not badges and panels.

## Accessibility & Inclusion

Baseline product a11y: full keyboard paths for primary actions, visible focus, body text contrast that holds on dark UI, and respect for `prefers-reduced-motion`. No WCAG AA certification target unless requirements change.
