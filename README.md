# Walkthrough Core

Find the click that matters in a browser recording, then export what was visible at that moment. This TypeScript package powers the Walkthrough inspector, component snapshots and agent exports.

## Try a recording

From this directory with [Bun](https://bun.sh) installed:

```sh
bun install
bun run context examples/close-menu.json
bun run context examples/close-menu.json --node 4 --at 250 --format css
```

The first command after install lists one step at **250 ms**. The second exports the selected button's CSS, including `border-radius: 8px`. The example was written by hand and needs no account, browser or API key.

## Make a first contribution

Look at the step label: it says **Click · button**. Now open the example. The button has no visible text but `aria-labelledby` points to the text **Close menu**. Could the inspector show **Click · Close menu** instead? Start in `src/capture.ts`, where labels are first recorded. Add a synthetic DOM case for a referenced label and one for a masked label; do not expose masked text. Existing recordings keep their original evidence.

Run `bun test src` before and after your change. See [CONTRIBUTING](CONTRIBUTING.md) for two more tasks and how a reviewed change reaches Walkthrough. For bug reports, share a synthetic example like this one rather than a recording of a private workspace.
