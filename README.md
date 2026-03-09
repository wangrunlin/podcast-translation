# Podcast Translation Demo

A local-first demo for the PRD in `jarvis-memory`.

- paste one episode URL
- process asynchronously
- return playable Chinese audio
- show original / translated / bilingual transcript
- keep recent history per anonymous browser session

## Stack

- `Next.js 16`
- `SQLite` via `better-sqlite3`
- `OpenRouter` for ASR + translation
- `MiniMax` for Chinese TTS
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

## Required local tools

- `ffmpeg`
- `ffprobe`
- `yt-dlp` for YouTube podcast extraction

If `yt-dlp` is missing, the app still works with direct audio URLs.

## Environment variables

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_ASR_MODEL`
- `OPENROUTER_TRANSLATION_MODEL`
- `MINIMAX_API_KEY`
- `MINIMAX_GROUP_ID`
- `MINIMAX_BASE_URL`
- `MINIMAX_TTS_MODEL`

Without these keys, the app falls back to mock transcript and mock audio generation so the full UI and async job flow remain testable.
