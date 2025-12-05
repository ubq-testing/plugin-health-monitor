import { GitHubApi } from "./handlers/github-api";
import { checkAllRepositories, printSummary } from "./handlers/workflow-checker";
import { FailureAnalyzer } from "./handlers/failure-analyzer";
import { validateEnv } from "./types/env";
import { logger } from "./utils";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const env = validateEnv();
  const api = new GitHubApi(env.GITHUB_TOKEN);

  // Initialize analyzer if OPENROUTER_API_KEY is available
  let analyzer: FailureAnalyzer | undefined;
  if (env.OPENROUTER_API_KEY) {
    analyzer = new FailureAnalyzer();
    logger.info("AI failure analysis enabled");
  } else {
    logger.info("AI failure analysis disabled (OPENROUTER_API_KEY not set)");
  }

  const allFailures = await checkAllRepositories(api, analyzer);
  printSummary(allFailures);
}

main()
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
