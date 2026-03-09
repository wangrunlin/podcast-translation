import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import youtubedl from "youtube-dl-exec";
import type { EpisodeMetadata, JobRecord, SourcePlatform } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type ExtractResult = {
  metadata: EpisodeMetadata;
  workingAudioPath: string;
  originalAudioPublicPath: string | null;
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
  };
}

async function extractYoutubeAudio(input: {
  id: string;
  sourceUrl: string;
  tempDir: string;
  skipDurationProbe: boolean;
}): Promise<ExtractResult> {
  const outputTemplate = path.join(input.tempDir, `${input.id}.%(ext)s`);

  const info = (await youtubedl(input.sourceUrl, {
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
      showTitle: info.channel ?? "YouTube",
      durationSeconds:
        info.duration ??
        (input.skipDurationProbe
          ? null
          : await getAudioDurationSeconds(workingAudioPath)),
      coverUrl: info.thumbnail ?? null,
      sourceUrl: input.sourceUrl,
      platform: "youtube",
    },
    workingAudioPath,
    originalAudioPublicPath: null,
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
