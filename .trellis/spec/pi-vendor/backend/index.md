# Pi Vendor Backend Guidelines

> Contracts for the `@bytetrue/pi-vendor` extension.

---

## Pre-Development Checklist

- Read [`provider-manager-contract.md`](./provider-manager-contract.md) before changing `/vendor`, `models.json` persistence, model enrichment, or official catalog lookup.
- Preserve the MVP boundary: `/vendor` edits `models.json`; it is not a dynamic `pi.registerProvider()` runtime system.
- Keep UI flows simple unless a concrete interaction requires custom TUI.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Provider Manager Contract](./provider-manager-contract.md) | `/vendor`, `models.json`, official catalog, templates, and `/models` import contracts | Active |

## Quality Check

- Run `npm run typecheck --workspace @bytetrue/pi-vendor`.
- Run `npm run test --workspace @bytetrue/pi-vendor`.
- For release/task final checks, run root `npm run test`.
