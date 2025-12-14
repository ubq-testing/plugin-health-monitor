import { ADMINS_TO_TAG, CONSECUTIVE_FAILURE_THRESHOLD, ISSUE_LABELS, ISSUE_TITLE } from "../types/constants";
import { RepoFailures, WorkflowFailureInfo } from "../types/workflow";
import { logger } from "../utils";
import { GitHubApi } from "./github-api";

async function buildFailureDetailsSection(api: GitHubApi, repo: string, failures: WorkflowFailureInfo[]): Promise<string[]> {
  const failureDetails: string[] = [];

  for (const f of failures) {
    const parts: string[] = [
      `### ${f.workflowName}`,
      `- **Consecutive failures:** ${f.consecutiveFailures}`,
      `- **Latest failure:** [View Run](${f.lastFailureUrl})`,
    ];

    if (!f.lastFailureRunId) {
      logger.warn(`No lastFailureRunId for ${f.workflowName}, skipping log extraction.`);
      failureDetails.push(parts.join("\n"));
      continue;
    }

    const details = await api.getFailureDetails(repo, f.lastFailureRunId, f.workflowName, f.workflowId);
    const extractedLogs = api.extractRelevantLogLines(details.logExcerpt);

    if (!extractedLogs) {
      logger.warn(`No relevant logs extracted for ${f.workflowName}, skipping log excerpt.`);
      failureDetails.push(parts.join("\n"));
      continue;
    }

    parts.push(`<details>\n<summary>Relevant Log Excerpt</summary>\n\n\`\`\`\n${extractedLogs}\n\`\`\`\n</details>`);

    failureDetails.push(parts.join("\n"));
  }

  return failureDetails;
}

export async function createIssueForFailures(api: GitHubApi, repo: string, failures: WorkflowFailureInfo[]): Promise<boolean> {
  // Check if an issue already exists
  if (await api.issueExists(repo, ISSUE_TITLE)) {
    logger.info(`Issue already exists for ${repo}, skipping...`);
    return false;
  }

  const failureDetails = await buildFailureDetailsSection(api, repo, failures);

  const issueBody = `## Workflow Dispatch Failures Detected

The following workflows dispatched by the kernel have **${CONSECUTIVE_FAILURE_THRESHOLD}+ consecutive failures**:

${failureDetails.join("\n")}

---

${ADMINS_TO_TAG.join(" ")} - Please investigate these failing workflows.

> This issue was automatically created by the health monitor plugin.`;

  try {
    await api.createIssue(repo, ISSUE_TITLE, issueBody, ISSUE_LABELS);
    logger.info(`Created issue for ${repo}`);
    return true;
  } catch (err) {
    logger.error(`Failed to create issue for ${repo}:`, { err });
    return false;
  }
}

export async function checkRepository(api: GitHubApi, repo: string): Promise<WorkflowFailureInfo[]> {
  const workflows = await api.getWorkflows(repo);
  const failures: WorkflowFailureInfo[] = [];

  if (workflows.length === 0) {
    logger.info(`No workflows found for repository ${repo}`);
    return failures;
  }

  logger.debug(`Found ${workflows.length} workflows`, { repo, workflows });

  for (const workflow of workflows) {
    const failure = await api.checkWorkflowForConsecutiveFailures(repo, workflow.id, workflow.name);
    if (failure) {
      failures.push(failure);
    }
  }

  return failures;
}

export async function checkAllRepositories(api: GitHubApi): Promise<RepoFailures[]> {
  logger.info("Fetching repositories...");
  const repos = await api.getRepositories();
  logger.debug(`Found ${repos.length} repositories`);

  const allFailures: RepoFailures[] = [];

  for (const repo of repos) {
    logger.info(`Checking ${repo.name}...`);
    const failures = await checkRepository(api, repo.name);
    logger.debug(`Found ${failures.length} failures in ${repo.name}`);
    if (failures.length > 0) {
      allFailures.push({ repo: repo.name, failures });
      await createIssueForFailures(api, repo.name, failures);
    }
  }

  return allFailures;
}

export function printSummary(allFailures: RepoFailures[]): void {
  if (allFailures.length > 0) {
    logger.info("\n=== Summary of Failures ===");
    for (const { repo, failures } of allFailures) {
      logger.info(`\n${repo}:`);
      for (const f of failures) {
        logger.info(`  - ${f.workflowName}: ${f.consecutiveFailures} consecutive failures`);
      }
    }
  } else {
    logger.info(`\nNo workflows found with ${CONSECUTIVE_FAILURE_THRESHOLD}+ consecutive failures.`);
  }
}
