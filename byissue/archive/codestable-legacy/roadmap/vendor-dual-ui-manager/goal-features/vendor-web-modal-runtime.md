# Goal Feature: vendor-web-modal-runtime

- Roadmap item: `vendor-web-modal-runtime`
- Depends on: `vendor-config-core`
- Nature: functional
- Design: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-review.md`
- QA: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-acceptance.md`

## Deliverable

一次性 local Web modal minimal loop：static assets、loopback HTTP、capability token、Opaque keep-value、browser opener/session lifecycle，以及 `/vendor web` orchestration。

## Core Runtime Path

从 Pi `/vendor web` 启动 `127.0.0.1:0`，浏览器加载 sanitized draft，只编辑已有 provider `baseUrl`，通过 GET state / PUT config / POST cancel 保存或取消；Esc/shutdown 清理，保存后单次 refresh。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
npm pack --workspace @bytetrue/pi-vendor --dry-run
```

## Feature DoD

- SecretRef 覆盖 known provider/model/modelOverride secret-bearing paths；exact path/revision hydration，no reveal/remap。
- Token/Host/Origin/method/content-type/body/CSP/no-store/asset allowlist 全有 integration tests。
- first-terminal-action-wins；recoverable errors 回 open；response-before-close；active connections cleanup。
- Browser opener fallback、RPC/JSON/print mode guard、single active session、single refresh/error messaging。
- Minimal UI 不提前实现 Raw JSON/provider CRUD/model routes。

## Stage Gates

- Review：独立 reviewer重点核验 SecretRef、HTTP auth、races、cleanup、asset resolution。
- QA：真实随机端口/socket、adversarial refs、五种 shutdown、browser fallback、packed file listing。
- Acceptance：minimal loop manual/API evidence + all checks passed。

## Evidence Required

- build/test/typecheck/pack outputs
- HTTP/security/socket contract tests
- Adversarial SecretRef matrix
- Browser/manual minimal path
- Asset listing and scope manifest

## Deliverables

- Web runtime/server/browser/route seams
- Static minimal assets + build script/package files
- Command integration/tests
- Review/QA/acceptance/evidence/gates

## Cleanliness

Generated assets必须可复现；无远程资源、runtime framework、daemon、临时 browser process 残留。

## Failure Recovery

需要改变 Opaque协议、terminal状态机、minimal scope 或 owner no-commit policy时 handoff。Browser不可自动打开但URL fallback可验证时不阻塞。
