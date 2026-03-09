# AGENTS.md

## Purpose

This repository contains a podcast translation demo built with Next.js 16.
When working in this repo, optimize for a fast demo loop and real end-to-end validation.

## Commit Messages

All future commits must use this format:

`type(scope): message`

Examples:

- `feat(apple): add Apple Podcasts ingestion support`
- `fix(demo): repair MiniMax audio decoding`
- `chore(deps): upgrade parser dependency`

Preferred `type` values:

- `feat`
- `fix`
- `refactor`
- `chore`
- `docs`
- `test`

Use a short, specific `scope` tied to the changed area, such as:

- `demo`
- `ingest`
- `apple`
- `youtube`
- `models`
- `ui`
- `deploy`

## Deployment Notes

- `https://podcast-translation.vercel.app/demo` is the primary remote validation path.
- The async job flow is mainly for local validation and is less reliable on serverless hosting.
- Apple Podcasts support currently works by resolving the public RSS feed and selecting a playable episode.
- YouTube extraction is still constrained by the Vercel runtime.

## Environment Notes

- OpenRouter is used for transcription and translation.
- MiniMax is used for Chinese TTS.
- For China-region MiniMax accounts, use `https://api.minimaxi.com`.

## Working Style

- Prefer small, verifiable changes.
- After any ingestion or model change, run a real sample through the pipeline.
- When changing remote behavior, validate against the deployed Vercel app, not only local dev.
