# Contribute to Walkthrough Core

Core turns a browser recording into the steps people click in the inspector, the layers they edit, and the evidence they give their agent. Changes here affect those product surfaces.

Run `bun install` and `bun test src` from this package. Tests use synthetic pages and recordings; no workspace account or API key is needed. Please reduce a capture problem to a small example rather than attaching a private recording.

## Starter issues for the public release

| Task | Start here | What a reviewer will check |
| --- | --- | --- |
| Give icon-only buttons readable step names | `src/capture.ts` → `captureElement` | Capture the label of an icon button whose `aria-labelledby` references visible, non-private text. A new recording should show “Click · Close menu”; missing or private labels must fall back without leaking content. |
| Name components with nested headings | `src/component.ts` → `captureComponent` | Extracting a panel with `<h2><span>Notifications</span></h2>` yields “Notifications” instead of “div component”. Use already-captured, permitted text; blocked or masked text must not become a name. |
| Add a keyboard-menu regression example | `src/core.test.ts`, `src/export.ts` | A small synthetic menu opens with Enter and closes with Escape. Its exported evidence preserves the keys and timestamps and does not claim an unobserved mouse click. |

## How a change reaches the app

1. Pick one issue and include a small example of the current and expected output.
2. Add a regression test, run it before the fix, then submit the fix and passing result together. For an examples-only contribution, show the example exercises the intended behavior.
3. The maintainer reviews compatibility with existing recordings and privacy boundaries. The private app runs its relevant inspector/export browser test against the candidate revision before adopting it.
4. For a separate public release, the public repository must become the source of truth. Pin the reviewed release in the app, ship it, then link the public PR in the release notes and credit its author. Do not maintain two hand-copied implementations.
