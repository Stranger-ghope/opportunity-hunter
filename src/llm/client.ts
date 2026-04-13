/**
 * LLM Client — unified interface for Nosana inference, Ollama, and OpenAI.
 * All agents route through here. Switch backend via INFERENCE_PROVIDER env var.
 */

import axios, { AxiosInstance } from "axios";
import https from "https";
import { LLMRequest, LLMResponse } from "../types";
import { logger } from "../utils/logger";

// Keep-alive agent for connection reuse
const nosanaAgent = new https.Agent({ keepAlive: true });

type InferenceProvider = "nosana" | "ollama" | "openai";

interface OpenAICompatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAICompatRequest {
  model: string;
  messages: OpenAICompatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" | "text" };
  stream?: boolean;
}

class LLMClient {
  private provider: InferenceProvider;
  private modelName: string;
  private http: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.provider = (process.env.INFERENCE_PROVIDER as InferenceProvider) || "nosana";
    this.modelName = process.env.MODEL_NAME || "Qwen/Qwen2.5-72B-Instruct-AWQ";

    this.baseUrl = this.resolveBaseUrl();
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 120_000,
      headers: this.buildHeaders(),
      ...(this.provider === "nosana" ? { httpsAgent: nosanaAgent } : {}),
    });

    logger.info(`[LLM] Provider=${this.provider} Model=${this.modelName} Base=${this.baseUrl}`);
  }

  private resolveBaseUrl(): string {
    switch (this.provider) {
      case "nosana":
        return process.env.NOSANA_API_URL || process.env.OPENAI_API_URL || "https://inference.nosana.io/v1";
      case "ollama":
        return (process.env.OLLAMA_BASE_URL || "http://localhost:11434") + "/v1";
      case "openai":
        return "https://api.openai.com/v1";
      default:
        throw new Error(`Unknown inference provider: ${this.provider}`);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = process.env.NOSANA_API_KEY || process.env.OPENAI_API_KEY;
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  /**
   * Primary completion call — all agents use this.
   */
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const startMs = Date.now();
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [3000, 8000, 15000]; // ms

    const body: OpenAICompatRequest = {
      model: this.modelName,
      messages: [
        { role: "system", content: req.system_prompt },
        { role: "user", content: req.user_prompt },
      ],
      temperature: req.temperature ?? 0.4,
      max_tokens: req.max_tokens ?? 2048,
      stream: false,
    };

    if (req.json_mode) {
      body.response_format = { type: "json_object" };
    }

    let lastError: string = "";
    const maxAttempts = req.no_retry ? 1 : MAX_RETRIES + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await this.http.post<{
          choices: Array<{ message: { content: string } }>;
          model: string;
          usage: { prompt_tokens: number; completion_tokens: number };
        }>("/chat/completions", body);

        const data = res.data;
        const content = data.choices?.[0]?.message?.content ?? "";
        const latency = Date.now() - startMs;

        logger.debug(`[LLM] ${latency}ms | in=${data.usage?.prompt_tokens} out=${data.usage?.completion_tokens}`);

        return {
          content,
          model: data.model || this.modelName,
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          latency_ms: latency,
        };
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status: number }; message?: string };
        const status = axiosErr?.response?.status;
        lastError = axiosErr?.message ?? String(err);

        const isTransient = status === 503 || status === 502 || status === 429;

        if (isTransient && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt];
          logger.warn(`[LLM] ${status} transient error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        logger.error(`[LLM] Request failed (status=${status ?? "network"}): ${lastError}`);
        throw new Error(`LLM inference failed: ${lastError}`);
      }
    }

    throw new Error(`LLM inference failed after ${MAX_RETRIES} retries: ${lastError}`);
  }

  /**
   * JSON-guaranteed call — parses and returns typed object.
   */
  async completeJSON<T>(req: LLMRequest): Promise<T> {
    const response = await this.complete({ ...req, json_mode: true });
    try {
      // Strip possible markdown code fences
      const cleaned = response.content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      return JSON.parse(cleaned) as T;
    } catch {
      logger.error(`[LLM] JSON parse failed. Raw: ${response.content.slice(0, 200)}`);
      throw new Error("LLM returned non-JSON content when JSON was expected.");
    }
  }

  getModelName(): string {
    return this.modelName;
  }

  getProvider(): string {
    return this.provider;
  }
}

// Singleton export
export const llmClient = new LLMClient();
