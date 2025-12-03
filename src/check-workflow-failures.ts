import { GitHubApi } from "./handlers/github-api";
import { checkAllRepositories, printSummary } from "./handlers/workflow-checker";
import { validateEnv } from "./types/env";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const env = validateEnv();
  const api = new GitHubApi(env.GITHUB_TOKEN);

  const allFailures = await checkAllRepositories(api);
  printSummary(allFailures);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
}).finally(() => {
  process.exit(0);
});
