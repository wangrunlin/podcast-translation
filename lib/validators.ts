import { z } from "zod";

export const createJobSchema = z.object({
  sourceUrl: z.string().url(),
  targetLanguage: z.literal("zh-CN"),
  sessionId: z.string().min(8).max(128),
});
