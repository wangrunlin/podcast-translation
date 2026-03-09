export const env = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterBaseUrl:
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  openRouterAsrModel:
    process.env.OPENROUTER_ASR_MODEL ?? "google/gemini-3.1-flash-lite-preview",
  openRouterTranslationModel:
    process.env.OPENROUTER_TRANSLATION_MODEL ??
    "google/gemini-3.1-flash-lite-preview",
  miniMaxApiKey: process.env.MINIMAX_API_KEY ?? "",
  miniMaxGroupId: process.env.MINIMAX_GROUP_ID ?? "",
  miniMaxBaseUrl: process.env.MINIMAX_BASE_URL ?? "https://api.minimax.chat",
  miniMaxTtsModel: process.env.MINIMAX_TTS_MODEL ?? "speech-02-hd",
};

export function hasOpenRouter() {
  return Boolean(env.openRouterApiKey);
}

export function hasMiniMax() {
  return Boolean(env.miniMaxApiKey && env.miniMaxGroupId);
}
