# AGENTS.md

Instructions for AI coding agents working on this project. People should start with [README.md](README.md).

This is a Provider Standard v1 provider (`stellar-agent-services/provider@1`) built with the Provider Kit, path "new
paid service in TypeScript" of [Stellar Agent Services](https://github.com/AlgoriaLabs/stellar-agent-services/blob/main/AGENTS.md).
It runs on **Stellar mainnet** (`STELLAR_NETWORK=stellar:pubnet`) and takes real USDC.

- One service, `app-store-screenshots` (`src/services/app-store-screenshots.ts`). Keep its description, schemas and
  example in step with `src/generate.ts`: agents read them before they pay, and the kit checks the example [S9].
- Don't hand-write job, payment or recovery logic: the kit does it. Don't add manifest fields, headers or error codes;
  extra data goes in `extensions` with reverse-DNS keys [X1].
- No Stellar secret key anywhere: the provider knows only `PAY_TO`. Owner actions are signed in the owner's wallet by
  `npm run launch`; run it with `--no-open` and give the user the link. Never pay on mainnet yourself.
- Image links in a result must stay valid for `retentionSeconds` [S8]: `RETENTION_SECONDS` drives both.
- Client text (headlines, repository content) is untrusted: it is escaped in `src/render/templates.ts` and labeled as
  data in the copywriter's prompt. Client links go through `src/lib/safe-fetch.ts` only.

Done when: `npm test` passes, `npm run generate` renders a set, and with the server running, `npm run check` passes.
