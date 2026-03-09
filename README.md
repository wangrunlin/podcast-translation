# Podcast Translation Demo

A local-first demo for the PRD in `jarvis-memory`.

- paste one episode URL
- process through the main jobs flow
- return playable Chinese audio
- keep the result close to the original speaker when voice clone succeeds
- show original / translated / bilingual transcript
- keep recent history per anonymous browser session

## Stack

- `Next.js 16`
- `SQLite` via `better-sqlite3`
- `OpenRouter` for ASR + translation
- `MiniMax Speech 2.8 HD` for Chinese voice-preserving TTS
- mock fallbacks when API keys are missing

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Copy envs:

```bash
cp .env.example .env.local
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`

## Runtime notes

- The app bundles static `ffmpeg`, `ffprobe`, and `yt-dlp` fallbacks.
- Apple Podcasts episode links are resolved to the exact episode instead of guessing from the show feed.
- The homepage is the main product flow. `/demo` is only for provider debugging.

## Environment variables

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_ASR_MODEL`
- `OPENROUTER_TRANSLATION_MODEL`
- `MINIMAX_API_KEY`
- `MINIMAX_GROUP_ID`
- `MINIMAX_BASE_URL`
- `MINIMAX_TTS_MODEL`
- `MINIMAX_VOICE_CLONE_MODEL`

Recommended MiniMax base URLs:

- international: `https://api.minimax.io`
- mainland China: `https://api.minimaxi.com`

Without these keys, the app falls back to mock transcript and mock audio generation so the full UI and async job flow remain testable.
