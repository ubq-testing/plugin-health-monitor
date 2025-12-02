import { GitHubApi } from "./handlers/github-api";
import { checkAllRepositories, printSummary } from "./handlers/workflow-checker";
import { validateEnv } from "./types/env";
import dotenv from "dotenv";
import { logger } from "./utils";
dotenv.config();

async function main() {
    const env = validateEnv();
    if(!env.GITHUB_TOKEN){
        throw logger.error("No token1!!")
    }
    const api = new GitHubApi(env.GITHUB_TOKEN);

    const allFailures = await checkAllRepositories(api);
    printSummary(allFailures);
}

main().catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
});
