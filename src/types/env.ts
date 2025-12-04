import { StaticDecode, Type as T } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import "dotenv/config";
import { LOG_LEVEL } from "@ubiquity-os/ubiquity-os-logger";
import { logger } from "../utils";

export const envSchema = T.Object({
  LOG_LEVEL: T.Optional(T.Enum(LOG_LEVEL, { default: LOG_LEVEL.INFO })),
  GITHUB_TOKEN: T.String({
    minLength: 1,
    description: "GitHub token for API authentication (from actions/create-github-app-token@v2)",
  }),
  OPENROUTER_API_KEY: T.Optional(
    T.String({
      minLength: 1,
      description: "OpenRouter API key for AI-powered failure analysis",
    })
  ),
});

export type Env = StaticDecode<typeof envSchema>;

export function validateEnv(): Env {
  const clean = Value.Clean(envSchema, process.env);

  if (!Value.Check(envSchema, clean)) {
    throw logger.error("Invalid environment variables", {
      errors: Value.Errors(envSchema, clean),
    });
  }
  return Value.Decode(envSchema, Value.Default(envSchema, clean));
}
