export type JobStatus =
  | "queued"
  | "extracting"
  | "transcribing"
  | "translating"
  | "synthesizing"
  | "packaging"
  | "completed"
  | "failed";

export type JobStage = JobStatus;

export type SourcePlatform = "youtube" | "apple" | "direct" | "unknown";

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText?: string;
};

export type JobRecord = {
  id: string;
  sessionId: string;
  sourceUrl: string;
  sourceType: string;
  platform: SourcePlatform;
  targetLanguage: string;
  title: string | null;
  showTitle: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  status: JobStatus;
  currentStage: JobStage;
  errorCode: string | null;
  errorMessage: string | null;
  audioOriginalPath: string | null;
  audioTranslatedPath: string | null;
  transcriptOriginal: TranscriptSegment[];
  transcriptTranslated: TranscriptSegment[];
  transcriptBilingual: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateJobInput = {
  sourceUrl: string;
  targetLanguage: string;
  sessionId: string;
};

export type EpisodeMetadata = {
  title: string;
  showTitle: string;
  durationSeconds: number | null;
  coverUrl: string | null;
  sourceUrl: string;
  platform: SourcePlatform;
  originalAudioPath?: string | null;
};
