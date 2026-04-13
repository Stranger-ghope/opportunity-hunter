/**
 * Embedding Client — wraps the Nosana-hosted Qwen3-Embedding-0.6B endpoint.
 * Used for semantic similarity scoring between opportunities and the user profile.
 * Falls back gracefully when the endpoint is unavailable.
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger";

class EmbeddingClient {
  private http: AxiosInstance;
  private model: string;
  private profileEmbedding: number[] | null = null;
  private circuitOpen = false;

  constructor() {
    const baseUrl =
      process.env.OPENAI_EMBEDDING_URL ||
      process.env.NOSANA_API_URL ||
      process.env.OPENAI_API_URL ||
      "";
    const apiKey =
      process.env.OPENAI_EMBEDDING_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "nosana";
    this.model =
      process.env.OPENAI_EMBEDDING_MODEL || "Qwen3-Embedding-0.6B";

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 10_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (baseUrl) {
      logger.info(`[Embedding] Model=${this.model} Base=${baseUrl}`);
    }
  }

  async embed(text: string): Promise<number[] | null> {
    if (this.circuitOpen || !this.http.defaults.baseURL) return null;

    try {
      const res = await this.http.post<{
        data: Array<{ embedding: number[] }>;
      }>("/embeddings", {
        model: this.model,
        input: text.slice(0, 3000),
        encoding_format: "float",
      });
      return res.data.data[0]?.embedding ?? null;
    } catch {
      this.circuitOpen = true;
      logger.warn("[Embedding] Endpoint unavailable — falling back to keyword matching");
      return null;
    }
  }

  async getProfileEmbedding(profileText: string): Promise<number[] | null> {
    if (!this.profileEmbedding) {
      this.profileEmbedding = await this.embed(profileText);
      if (this.profileEmbedding) {
        logger.info("[Embedding] Profile embedding cached");
      }
    }
    return this.profileEmbedding;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  resetCircuit() {
    this.circuitOpen = false;
    this.profileEmbedding = null;
  }

  isAvailable() {
    return !this.circuitOpen && !!this.http.defaults.baseURL;
  }

  getStatus() {
    return {
      endpoint: this.http.defaults.baseURL || "not configured",
      model: this.model,
      circuitOpen: this.circuitOpen,
      profileCached: this.profileEmbedding !== null,
      dimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || "1024", 10),
      healthy: !this.circuitOpen && !!this.http.defaults.baseURL,
    };
  }
}

export const embeddingClient = new EmbeddingClient();
