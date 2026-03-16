import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { Innertube } from "youtubei.js";
import YTDlpWrap from "yt-dlp-wrap";
import type {
  EpisodeMetadata,
  JobRecord,
  SourcePlatform,
  TranscriptSegment,
} from "@/lib/types";

const execFileAsync = promisify(execFile);
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
});

const ytDlpCacheDir = resolveTempDir("bin");

function resolveTempDir(subdir: string): string {
  const candidates = [
    path.join(process.cwd(), "storage", subdir),
    path.join("/tmp", "podcast-translation", subdir),
  ];

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      continue;
    }
  }

  return path.join(os.tmpdir(), `podcast-translation-${subdir}`);
}

export type ExtractResult = {
  metadata: EpisodeMetadata;
  workingAudioPath: string | null;
  originalAudioPublicPath: string | null;
  transcriptOriginal: TranscriptSegment[] | null;
};

export async function extractEpisode(job: JobRecord): Promise<ExtractResult> {
  const tempDir = resolveTempDir("source");
  fs.mkdirSync(tempDir, { recursive: true });

  return extractSourceToTemp({
    sourceUrl: job.sourceUrl,
    platform: job.platform,
    id: job.id,
    tempDir,
    publicOriginalUrl: job.platform === "direct" ? job.sourceUrl : null,
  });
}

export async function extractSourceToTemp(input: {
  sourceUrl: string;
  platform: SourcePlatform;
  id?: string;
  tempDir?: string;
  publicOriginalUrl?: string | null;
  skipDurationProbe?: boolean;
}): Promise<ExtractResult> {
  const tempDir =
    input.tempDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "podcast-translation-demo-"));
  fs.mkdirSync(tempDir, { recursive: true });

  const id = input.id ?? makeTempId();

  if (input.platform === "direct") {
    return extractDirectAudio({
      id,
      sourceUrl: input.sourceUrl,
      tempDir,
      publicOriginalUrl: input.publicOriginalUrl ?? input.sourceUrl,
      skipDurationProbe: input.skipDurationProbe ?? false,
    });
  }

  if (input.platform === "youtube") {
    return extractYoutubeAudio({
      id,
      sourceUrl: input.sourceUrl,
      tempDir,
      skipDurationProbe: input.skipDurationProbe ?? false,
    });
  }

  if (input.platform === "apple") {
    return extractAppleAudio({
      id,
      sourceUrl: input.sourceUrl,
      tempDir,
      skipDurationProbe: input.skipDurationProbe ?? false,
    });
  }

  throw new Error(
    "This platform is not wired in this MVP yet. Try an Apple Podcasts episode link, a YouTube single-video URL, or a direct audio URL.",
  );
}

async function extractDirectAudio(input: {
  id: string;
  sourceUrl: string;
  tempDir: string;
  publicOriginalUrl: string | null;
  skipDurationProbe: boolean;
}): Promise<ExtractResult> {
  const filename = `${input.id}-source.mp3`;
  const workingAudioPath = path.join(input.tempDir, filename);
  await downloadFile(input.sourceUrl, workingAudioPath);

  return {
    metadata: {
      title: "Direct audio episode",
      showTitle: "Imported audio",
      durationSeconds: input.skipDurationProbe
        ? null
        : await getAudioDurationSeconds(workingAudioPath),
      coverUrl: null,
      sourceUrl: input.sourceUrl,
      platform: "direct",
    },
    workingAudioPath,
    originalAudioPublicPath: input.publicOriginalUrl,
    transcriptOriginal: null,
  };
}

async function extractYoutubeAudio(input: {
  id: string;
  sourceUrl: string;
  tempDir: string;
  skipDurationProbe: boolean;
}): Promise<ExtractResult> {
  const transcriptOriginal = await extractYoutubeTranscript(input.sourceUrl);
  const metadata = await getYoutubeMetadata(input.sourceUrl);

  if (transcriptOriginal.length > 0) {
    const audioDownload = await tryDownloadYoutubeAudio(input.id, input.sourceUrl, input.tempDir);
    return {
      metadata: {
        title: metadata.title ?? "YouTube episode",
        showTitle: metadata.showTitle ?? "YouTube",
        durationSeconds:
          metadata.durationSeconds ??
          (audioDownload && !input.skipDurationProbe
            ? await getAudioDurationSeconds(audioDownload)
            : null),
        coverUrl: metadata.coverUrl,
        sourceUrl: input.sourceUrl,
        platform: "youtube",
      },
      workingAudioPath: audioDownload,
      originalAudioPublicPath: null,
      transcriptOriginal,
    };
  }

  const audioDownload = await tryDownloadYoutubeAudio(input.id, input.sourceUrl, input.tempDir);
  if (!audioDownload) {
    throw new Error(
      "This YouTube video could not expose a usable transcript or downloadable audio in the current runtime. Try another single-video link, or use Apple Podcasts instead.",
    );
  }

  return {
    metadata: {
      title: metadata.title ?? "YouTube episode",
      showTitle: metadata.showTitle ?? "YouTube",
      durationSeconds:
        metadata.durationSeconds ??
        (input.skipDurationProbe ? null : await getAudioDurationSeconds(audioDownload)),
      coverUrl: metadata.coverUrl ?? null,
      sourceUrl: input.sourceUrl,
      platform: "youtube",
    },
    workingAudioPath: audioDownload,
    originalAudioPublicPath: null,
    transcriptOriginal: null,
  };
}

async function extractAppleAudio(input: {
  id: string;
  sourceUrl: string;
  tempDir: string;
  skipDurationProbe: boolean;
}): Promise<ExtractResult> {
  const appleIds = extractAppleIds(input.sourceUrl);
  if (!appleIds.collectionId) {
    throw new Error("Unable to read the Apple Podcasts show id from this URL.");
  }
  if (!appleIds.episodeId) {
    throw new Error("Please paste a single Apple Podcasts episode link, not a show page.");
  }

  const lookup = await fetchJson<AppleLookupResponse>(
    `https://itunes.apple.com/lookup?id=${appleIds.collectionId}&media=podcast&entity=podcastEpisode&limit=200`,
  );
  const show = lookup.results?.find((item) => item.kind === "podcast" && item.feedUrl);
  const targetEpisode = lookup.results?.find(
    (item) => item.kind === "podcast-episode" && String(item.trackId) === appleIds.episodeId,
  );

  if (!show?.feedUrl) {
    throw new Error("Apple Podcasts lookup did not return a public RSS feed.");
  }
  if (!targetEpisode) {
    throw new Error("Apple Podcasts did not return metadata for this episode link.");
  }

  const pageMeta = await extractAppleEpisodePageMeta(input.sourceUrl);
  const feed = await fetchAppleFeed(show.feedUrl);
  const episode = matchAppleEpisode(feed.items, targetEpisode, pageMeta);

  if (!episode?.audioUrl) {
    throw new Error("Could not map this Apple Podcasts episode to a playable RSS item.");
  }

  const ext = inferAudioExtension(episode.audioUrl);
  const workingAudioPath = path.join(input.tempDir, `${input.id}-source.${ext}`);
  await downloadFile(episode.audioUrl, workingAudioPath);

  return {
    metadata: {
      title: episode.title,
      showTitle:
        feed.showTitle || targetEpisode.collectionName || show.collectionName || "Apple Podcasts",
      durationSeconds:
        targetEpisode.trackTimeMillis
          ? Math.round(targetEpisode.trackTimeMillis / 1000)
          : episode.durationSeconds ??
            (input.skipDurationProbe ? null : await getAudioDurationSeconds(workingAudioPath)),
      coverUrl:
        episode.coverUrl ??
        pageMeta.coverUrl ??
        feed.coverUrl ??
        targetEpisode.artworkUrl600 ??
        show.artworkUrl600 ??
        null,
      sourceUrl: input.sourceUrl,
      platform: "apple",
    },
    workingAudioPath,
    originalAudioPublicPath: episode.audioUrl,
    transcriptOriginal: null,
  };
}

async function downloadFile(url: string, destinationPath: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error("Unable to download the source audio file.");
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
}

async function getAudioDurationSeconds(filePath: string) {
  const ffprobeBinary = ensureExecutable(ffprobe.path);
  if (!ffprobeBinary) {
    return null;
  }

  const { stdout } = await execFileAsync(ffprobeBinary, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  const duration = Math.round(Number.parseFloat(stdout.trim()));
  return Number.isFinite(duration) ? duration : null;
}

function makeTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findDownloadedFile(tempDir: string, id: string) {
  const match = fs
    .readdirSync(tempDir)
    .find((file) => file.startsWith(id) && !file.endsWith(".part") && !file.endsWith(".json"));

  if (!match) {
    return null;
  }

  return path.join(tempDir, match);
}

type AppleLookupResponse = {
  results?: Array<{
    kind?: string;
    wrapperType?: string;
    trackId?: number;
    collectionId?: number;
    collectionName?: string;
    trackName?: string;
    feedUrl?: string;
    artworkUrl600?: string;
    episodeUrl?: string;
    releaseDate?: string;
    trackTimeMillis?: number;
  }>;
};

type AppleFeed = {
  showTitle: string | null;
  coverUrl: string | null;
  items: AppleFeedItem[];
};

type AppleFeedItem = {
  title: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  publishedAt: string | null;
};

type ApplePageMeta = {
  title: string | null;
  description: string | null;
  coverUrl: string | null;
};

async function fetchAppleFeed(feedUrl: string): Promise<AppleFeed> {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error("Unable to fetch the podcast RSS feed from Apple Podcasts.");
  }

  const xml = await response.text();
  const parsed = xmlParser.parse(xml) as {
    rss?: {
      channel?: {
        title?: string;
        image?: { url?: string };
        "itunes:image"?: { href?: string };
        item?: AppleRawItem | AppleRawItem[];
      };
    };
  };

  const channel = parsed.rss?.channel;
  const rawItems = toArray(channel?.item);

  return {
    showTitle: readText(channel?.title),
    coverUrl: readText(channel?.["itunes:image"]?.href) ?? readText(channel?.image?.url),
    items: rawItems.map((item) => ({
      title: decodeHtmlEntities(readText(item.title) ?? "Untitled episode"),
      audioUrl: readText(item.enclosure?.url),
      durationSeconds: parseDurationSeconds(readText(item["itunes:duration"])),
      coverUrl: readText(item["itunes:image"]?.href),
      publishedAt: readText(item.pubDate),
    })),
  };
}

type AppleRawItem = {
  title?: string;
  pubDate?: string;
  enclosure?: { url?: string };
  "itunes:duration"?: string;
  "itunes:image"?: { href?: string };
};

function extractAppleIds(sourceUrl: string) {
  const collectionId = sourceUrl.match(/\/id(\d+)/i)?.[1] ?? null;
  let episodeId: string | null = null;

  try {
    const url = new URL(sourceUrl);
    episodeId = url.searchParams.get("i");
  } catch {
    episodeId = null;
  }

  return { collectionId, episodeId };
}

async function extractAppleEpisodePageMeta(sourceUrl: string): Promise<ApplePageMeta> {
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return { title: null, description: null, coverUrl: null };
    }

    const html = await response.text();
    const title =
      html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ??
      html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
      null;
    const description =
      html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] ?? null;
    const coverUrl =
      html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] ?? null;

    return {
      title: title ? decodeHtmlEntities(title).trim() : null,
      description: description ? decodeHtmlEntities(description).trim() : null,
      coverUrl,
    };
  } catch {
    return { title: null, description: null, coverUrl: null };
  }
}

function matchAppleEpisode(
  items: AppleFeedItem[],
  targetEpisode: NonNullable<AppleLookupResponse["results"]>[number],
  pageMeta: ApplePageMeta,
) {
  const playable = items.filter((item) => item.audioUrl);
  if (playable.length === 0) {
    return null;
  }

  const targetTitle = normalizeTitle(
    pageMeta.title ?? targetEpisode.trackName ?? "",
  );
  const targetDate = targetEpisode.releaseDate
    ? new Date(targetEpisode.releaseDate).getTime()
    : null;

  const scored = playable
    .map((item) => {
      let score = 0;
      const itemTitle = normalizeTitle(item.title);

      if (itemTitle === targetTitle) {
        score += 100;
      } else if (itemTitle.includes(targetTitle) || targetTitle.includes(itemTitle)) {
        score += 40;
      }

      if (pageMeta.description) {
        const desc = normalizeTitle(pageMeta.description).slice(0, 80);
        if (desc && itemTitle.includes(desc.slice(0, 20))) {
          score += 5;
        }
      }

      if (targetDate && item.publishedAt) {
        const publishedAt = new Date(item.publishedAt).getTime();
        const dayDiff = Math.abs(publishedAt - targetDate) / 86400000;
        if (dayDiff < 0.6) {
          score += 30;
        } else if (dayDiff < 2) {
          score += 10;
        }
      }

      if (targetEpisode.trackTimeMillis && item.durationSeconds) {
        const durationDiff = Math.abs(
          item.durationSeconds - Math.round(targetEpisode.trackTimeMillis / 1000),
        );
        if (durationDiff < 20) {
          score += 20;
        } else if (durationDiff < 120) {
          score += 8;
        }
      }

      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].item : null;
}

type YoutubeMetadata = {
  title: string | null;
  showTitle: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
};

type YoutubeCaptionNode = {
  t?: string | number;
  d?: string | number;
  s?: Array<{ "#text"?: string }> | { "#text"?: string };
  "#text"?: string;
};

async function extractYoutubeTranscript(sourceUrl: string) {
  try {
    const videoId = extractYoutubeVideoId(sourceUrl);
    if (!videoId) {
      return [];
    }

    const yt = await Innertube.create();
    const info = await yt.getInfo(videoId);
    const englishTrack =
      info.captions?.caption_tracks?.find((track) => track.language_code === "en") ??
      info.captions?.caption_tracks?.find((track) => track.language_code?.startsWith("en"));

    if (!englishTrack?.base_url) {
      return [];
    }

    const trackUrl = new URL(englishTrack.base_url);
    trackUrl.searchParams.set("fmt", "srv3");
    const response = await fetch(trackUrl.toString());
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const parsed = xmlParser.parse(xml) as {
      timedtext?: {
        body?: {
          p?: YoutubeCaptionNode | YoutubeCaptionNode[];
        };
      };
    };

    const segments = toArray(parsed.timedtext?.body?.p)
      .map(mapYoutubeCaptionNode)
      .filter((segment): segment is TranscriptSegment => Boolean(segment));

    return mergeTranscriptSegments(segments);
  } catch (error) {
    console.error("YouTube transcript extraction failed:", error);
    return [];
  }
}

async function getYoutubeMetadata(sourceUrl: string): Promise<YoutubeMetadata> {
  try {
    const videoId = extractYoutubeVideoId(sourceUrl);
    if (!videoId) {
      return emptyYoutubeMetadata();
    }

    const yt = await Innertube.create();
    const info = await yt.getInfo(videoId);

    return {
      title: readText(info.basic_info?.title),
      showTitle: readText(info.basic_info?.channel?.name),
      durationSeconds:
        typeof info.basic_info?.duration === "number"
          ? info.basic_info.duration
          : null,
      coverUrl: readText(info.basic_info?.thumbnail?.[0]?.url),
    };
  } catch (error) {
    console.error("YouTube metadata fetch failed:", error);
    return emptyYoutubeMetadata();
  }
}

async function tryDownloadYoutubeAudio(id: string, sourceUrl: string, tempDir: string) {
  try {
    const binaryPath = await ensureYtDlpBinary();
    const ytDlp = new YTDlpWrap(binaryPath);
    const outputTemplate = path.join(tempDir, `${id}.%(ext)s`);

    await ytDlp.execPromise([
      "--no-warnings",
      "--no-playlist",
      "-f",
      "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio",
      "-o",
      outputTemplate,
      sourceUrl,
    ]);

    const downloaded = findDownloadedFile(tempDir, id);
    if (!downloaded) {
      return null;
    }

    const normalizedPath = path.join(tempDir, `${id}-source.mp3`);
    await normalizeAudio(downloaded, normalizedPath);
    return normalizedPath;
  } catch (error) {
    console.error("yt-dlp audio download failed:", error);
    return null;
  }
}

async function ensureYtDlpBinary() {
  const binaryPath = path.join(ytDlpCacheDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  fs.mkdirSync(ytDlpCacheDir, { recursive: true });
  await YTDlpWrap.downloadFromGithub(binaryPath);
  return binaryPath;
}

async function normalizeAudio(inputPath: string, outputPath: string) {
  const ffmpegBinary = ffmpegPath ? ensureExecutable(ffmpegPath) : null;
  if (!ffmpegBinary) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  await execFileAsync(ffmpegBinary, [
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "32000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
    "-y",
  ]);
}

function mapYoutubeCaptionNode(node: YoutubeCaptionNode): TranscriptSegment | null {
  const startMs = Number(node.t ?? 0);
  const durationMs = Number(node.d ?? 0);
  const fragments = toArray(node.s)
    .map((part) => readText(part?.["#text"]))
    .filter(Boolean);
  const sourceText = decodeHtmlEntities(
    fragments.join("") || readText(node["#text"]) || "",
  );

  if (!sourceText.trim()) {
    return null;
  }

  return {
    startMs,
    endMs: startMs + durationMs,
    sourceText,
  };
}

function mergeTranscriptSegments(segments: TranscriptSegment[]) {
  const merged: TranscriptSegment[] = [];

  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.sourceText.length < 120 &&
      segment.sourceText.length < 120 &&
      segment.startMs - previous.endMs < 800
    ) {
      previous.endMs = segment.endMs;
      previous.sourceText = `${previous.sourceText} ${segment.sourceText}`.trim();
      continue;
    }

    merged.push({ ...segment });
  }

  return merged.slice(0, 30);
}

function extractYoutubeVideoId(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1) || null;
    }

    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

function emptyYoutubeMetadata(): YoutubeMetadata {
  return {
    title: null,
    showTitle: null,
    durationSeconds: null,
    coverUrl: null,
  };
}

function inferAudioExtension(url: string) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".m4a")) {
    return "m4a";
  }
  if (pathname.endsWith(".wav")) {
    return "wav";
  }
  if (pathname.endsWith(".webm")) {
    return "webm";
  }
  return "mp3";
}

function parseDurationSeconds(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }

  return (await response.json()) as T;
}

function ensureExecutable(binaryPath: string): string | null {
  if (!fs.existsSync(binaryPath)) {
    return null;
  }

  try {
    fs.chmodSync(binaryPath, 0o755);
  } catch {
    // Best effort only.
  }

  return binaryPath;
}
