import { ADMINS_TO_TAG, CONSECUTIVE_FAILURE_THRESHOLD, ISSUE_LABELS, ISSUE_TITLE } from "../types/constants";
import { RepoFailures, WorkflowFailureInfo } from "../types/workflow";
import { GitHubApi } from "./github-api";

export async function createIssueForFailures(api: GitHubApi, repo: string, failures: WorkflowFailureInfo[]): Promise<boolean> {
  // Check if an issue already exists
  if (await api.issueExists(repo, ISSUE_TITLE)) {
    console.log(`Issue already exists for ${repo}, skipping...`);
    return false;
  }

  const failureDetails = failures
    .map(
      (f) =>
        `### ${f.workflowName}\n` +
        `- **Consecutive failures:** ${f.consecutiveFailures}\n` +
        `- **Latest failure:** [View Run](${f.lastFailureUrl})\n`
    )
    .join("\n");

  const issueBody = `## Workflow Dispatch Failures Detected

The following workflows dispatched by the kernel (ubiquity-os[bot] or ubiquity-os-dev[bot]) have **${CONSECUTIVE_FAILURE_THRESHOLD}+ consecutive failures**:

${failureDetails}

---

${ADMINS_TO_TAG.join(" ")} - Please investigate these failing workflows.

> This issue was automatically created by the health monitor plugin.`;

  try {
    await api.createIssue(repo, ISSUE_TITLE, issueBody, ISSUE_LABELS);
    console.log(`Created issue for ${repo}`);
    return true;
  } catch (error) {
    console.error(`Failed to create issue for ${repo}:`, error);
    return false;
  }
}

export async function checkRepository(api: GitHubApi, repo: string): Promise<WorkflowFailureInfo[]> {
  const workflows = await api.getWorkflows(repo);
  const failures: WorkflowFailureInfo[] = [];

  for (const workflow of workflows) {
    const failure = await api.checkWorkflowForConsecutiveFailures(repo, workflow.id, workflow.name);
    if (failure) {
      failures.push(failure);
    }
  }

  return failures;
}

export async function checkAllRepositories(api: GitHubApi): Promise<RepoFailures[]> {
  console.log("Fetching repositories...");
  const repos = await api.getRepositories();
  console.log(`Found ${repos.length} repositories`);

  const allFailures: RepoFailures[] = [];

  for (const repo of repos) {
    console.log(`Checking ${repo.name}...`);
    const failures = await checkRepository(api, repo.name);

    if (failures.length > 0) {
      allFailures.push({ repo: repo.name, failures });
      await createIssueForFailures(api, repo.name, failures);
    }
  }

  return allFailures;
}

export function printSummary(allFailures: RepoFailures[]): void {
  if (allFailures.length > 0) {
    console.log("\n=== Summary of Failures ===");
    for (const { repo, failures } of allFailures) {
      console.log(`\n${repo}:`);
      for (const f of failures) {
        console.log(`  - ${f.workflowName}: ${f.consecutiveFailures} consecutive failures`);
      }
    }
  } else {
    console.log(`\nNo workflows found with ${CONSECUTIVE_FAILURE_THRESHOLD}+ consecutive failures.`);
  }
}
