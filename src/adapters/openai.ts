import OpenAI from "openai";
import { logger } from "../utils";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const FALLBACK_MODEL = "anthropic/claude-opus-4.5";

export interface LlmConfig {
  model?: string;
  maxTokens?: number;
}

interface OpenRouterModel {
  id: string;
  pricing: {
    prompt: string;
    completion: string;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

// Preferred free models in order of priority
const PREFERRED_FREE_MODELS = ["qwen/qwen3-coder:free", "openai/gpt-oss-20b:free", "kwaipilot/kat-coder-pro:free"];

export class OpenAiAdapter {
  private _client: OpenAI;
  private _maxTokens: number;
  private _freeModels: string[] | null = null;
  private _preferredModel: string | null = null;

  constructor(config: LlmConfig = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw logger.error("OPENROUTER_API_KEY environment variable is required");
    }

    this._client = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
    });
    this._preferredModel = config.model || null;
    this._maxTokens = config.maxTokens || 5000;
  }

  /**
   * Fetch available free models from OpenRouter API
   */
  private async _fetchFreeModels(): Promise<string[]> {
    if (this._freeModels) {
      return this._freeModels;
    }

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`);
      if (!response.ok) {
        logger.warn("Failed to fetch OpenRouter models list", { status: response.status });
        return PREFERRED_FREE_MODELS;
      }

      const data = (await response.json()) as OpenRouterModelsResponse;
      const freeModels = data.data
        .filter((model) => {
          const promptPrice = parseFloat(model.pricing?.prompt || "1");
          const completionPrice = parseFloat(model.pricing?.completion || "1");
          return promptPrice === 0 && completionPrice === 0;
        })
        .map((model) => model.id);

      this._freeModels = freeModels;
      logger.debug(`Found ${freeModels.length} free models on OpenRouter`);
      return freeModels;
    } catch (err) {
      logger.warn("Error fetching OpenRouter models, using fallback list", { err });
      return PREFERRED_FREE_MODELS;
    }
  }

  /**
   * Try to complete with a specific model
   */
  private async _tryComplete(model: string, systemPrompt: string, userPrompt: string): Promise<string | null> {
    const response = await this._client.chat.completions.create({
      model,
      max_completion_tokens: this._maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    if (!response.choices?.length) {
      return null;
    }

    return response.choices[0].message.content;
  }

  /**
   * Complete a prompt, trying free models first with fallback
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<string | null> {
    const freeModels = await this._fetchFreeModels();
    const freeModelSet = new Set(freeModels);

    // Build list of models to try in order
    const modelsToTry: string[] = [];

    // If user specified a model, try it first
    if (this._preferredModel) {
      modelsToTry.push(this._preferredModel);
    }

    // Add preferred free models that are currently free
    for (const preferred of PREFERRED_FREE_MODELS) {
      if (freeModelSet.has(preferred) && !modelsToTry.includes(preferred)) {
        modelsToTry.push(preferred);
      }
    }

    // Add fallback model last
    if (!modelsToTry.includes(FALLBACK_MODEL)) {
      modelsToTry.push(FALLBACK_MODEL);
    }

    // Try each model in order
    for (const model of modelsToTry) {
      try {
        logger.debug(`Trying model: ${model}`);
        const result = await this._tryComplete(model, systemPrompt, userPrompt);
        if (result) {
          logger.debug(`Successfully completed with model: ${model}`);
          return result;
        }
        logger.warn(`Model ${model} returned no choices, trying next...`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn(`Model ${model} failed: ${errorMessage}, trying next...`);
      }
    }

    logger.error("All models failed to complete the request");
    return null;
  }
}
