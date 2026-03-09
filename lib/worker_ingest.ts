import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile, spawnSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import { Innertube } from "youtubei.js";
import youtubedl from "youtube-dl-exec";
import type {
  EpisodeMetadata,
  JobRecord,
  SourcePlatform,
  TranscriptSegment,
} from "@/lib/types";

const execFileAsync = promisify(execFile);

export type ExtractResult = {
  metadata: EpisodeMetadata;
  workingAudioPath: string | null;
  originalAudioPublicPath: string | null;
  transcriptOriginal: TranscriptSegment[] | null;
};

export async function extractEpisode(job: JobRecord): Promise<ExtractResult> {
  const tempDir = path.join(process.cwd(), "storage", "source");
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
    "This platform is not wired in this demo yet. Try Apple Podcasts, YouTube, or a direct audio URL.",
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
    return {
      metadata: {
        title: metadata.title ?? "YouTube episode",
        showTitle: metadata.showTitle ?? "YouTube",
        durationSeconds: metadata.durationSeconds,
        coverUrl: metadata.coverUrl,
        sourceUrl: input.sourceUrl,
        platform: "youtube",
      },
      workingAudioPath: null,
      originalAudioPublicPath: null,
      transcriptOriginal,
    };
  }

  if (!canUseYtDlpFallback()) {
    throw new Error(
      "This YouTube video could not expose a usable English transcript in the current runtime. Try another YouTube video with captions, or use Apple Podcasts / direct audio instead.",
    );
  }

  const outputTemplate = path.join(input.tempDir, `${input.id}.%(ext)s`);

  const info = await getYoutubeMetadataViaYtDlp(input.sourceUrl);

  await youtubedl(input.sourceUrl, {
    format: "bestaudio/best",
    output: outputTemplate,
    noWarnings: true,
    noCheckCertificates: true,
  });

  const workingAudioPath = findDownloadedFile(input.tempDir, input.id);

  return {
    metadata: {
      title: info.title ?? "YouTube episode",
      showTitle: info.showTitle ?? "YouTube",
      durationSeconds:
        info.durationSeconds ??
        (input.skipDurationProbe
          ? null
          : await getAudioDurationSeconds(workingAudioPath)),
      coverUrl: info.coverUrl ?? null,
      sourceUrl: input.sourceUrl,
      platform: "youtube",
    },
    workingAudioPath,
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
  const collectionId = extractAppleCollectionId(input.sourceUrl);
  if (!collectionId) {
    throw new Error("Unable to read the Apple Podcasts show id from this URL.");
  }

  const lookup = await fetchJson<AppleLookupResponse>(
    `https://itunes.apple.com/lookup?id=${collectionId}`,
  );
  const show = lookup.results?.find((item) => item.feedUrl);

  if (!show?.feedUrl) {
    throw new Error("Apple Podcasts lookup did not return a public RSS feed.");
  }

  const feed = await fetchAppleFeed(show.feedUrl);
  const targetTitle = await extractAppleEpisodeTitle(input.sourceUrl);
  const episode = pickAppleEpisode(feed.items, targetTitle);

  if (!episode?.audioUrl) {
    throw new Error("Could not find a playable episode in the Apple Podcasts feed.");
  }

  const ext = inferAudioExtension(episode.audioUrl);
  const workingAudioPath = path.join(input.tempDir, `${input.id}-source.${ext}`);
  await downloadFile(episode.audioUrl, workingAudioPath);

  return {
    metadata: {
      title: episode.title,
      showTitle: feed.showTitle || show.collectionName || "Apple Podcasts",
      durationSeconds:
        episode.durationSeconds ??
        (input.skipDurationProbe ? null : await getAudioDurationSeconds(workingAudioPath)),
      coverUrl: episode.coverUrl ?? feed.coverUrl ?? show.artworkUrl600 ?? null,
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
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return Math.round(Number.parseFloat(stdout.trim()));
}

function makeTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findDownloadedFile(tempDir: string, id: string) {
  const match = fs
    .readdirSync(tempDir)
    .find((file) => file.startsWith(id) && !file.endsWith(".part"));

  if (!match) {
    throw new Error("YouTube audio download completed without a readable output file.");
  }

  return path.join(tempDir, match);
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
});

type AppleLookupResponse = {
  results?: Array<{
    collectionName?: string;
    feedUrl?: string;
    artworkUrl600?: string;
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
      title: readText(item.title) ?? "Untitled episode",
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

function pickAppleEpisode(items: AppleFeedItem[], targetTitle: string | null) {
  const playable = items.filter((item) => item.audioUrl);
  if (playable.length === 0) {
    return null;
  }

  if (targetTitle) {
    const normalizedTarget = normalizeTitle(targetTitle);
    const exact = playable.find(
      (item) => normalizeTitle(item.title) === normalizedTarget,
    );
    if (exact) {
      return exact;
    }

    const partial = playable.find((item) =>
      normalizeTitle(item.title).includes(normalizedTarget),
    );
    if (partial) {
      return partial;
    }
  }

  const shortEpisode =
    playable.find(
      (item) =>
        item.durationSeconds !== null && item.durationSeconds > 0 && item.durationSeconds <= 12 * 60,
    ) ??
    playable.find(
      (item) =>
        item.durationSeconds !== null && item.durationSeconds > 0 && item.durationSeconds <= 20 * 60,
    );

  return shortEpisode ?? playable[0];
}

function extractAppleCollectionId(sourceUrl: string) {
  const match = sourceUrl.match(/\/id(\d+)/i);
  return match?.[1] ?? null;
}

async function extractAppleEpisodeTitle(sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (!url.searchParams.get("i")) {
    return null;
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const ogTitle =
      html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ??
      html.match(/<title>([^<]+)<\/title>/i)?.[1];

    return ogTitle ? decodeHtmlEntities(ogTitle).trim() : null;
  } catch {
    return null;
  }
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
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

async function extractYoutubeTranscript(sourceUrl: string) {
  try {
    const videoId = extractYoutubeVideoId(sourceUrl);
    if (!videoId) {
      return [];
    }

    const yt = await Innertube.create();
    const info = await yt.getInfo(videoId);
    const englishTrack = info.captions?.caption_tracks?.find(
      (track) => track.language_code === "en",
    );

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
  } catch {
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
  } catch {
    return emptyYoutubeMetadata();
  }
}

async function getYoutubeMetadataViaYtDlp(
  sourceUrl: string,
): Promise<YoutubeMetadata> {
  const info = (await youtubedl(sourceUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    skipDownload: true,
  })) as {
    title?: string;
    channel?: string;
    thumbnail?: string;
    duration?: number;
  };

  return {
    title: info.title ?? null,
    showTitle: info.channel ?? null,
    durationSeconds: info.duration ?? null,
    coverUrl: info.thumbnail ?? null,
  };
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

  return merged.slice(0, 24);
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

function canUseYtDlpFallback() {
  const result = spawnSync("python3", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}
