import { BOT_ACTORS, CONSECUTIVE_FAILURE_THRESHOLD, MARKETPLACE_ORG } from "../types/constants";
import { Repository, WorkflowFailureInfo, WorkflowInfo, WorkflowRun } from "../types/workflow";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { logger } from "../utils";

export class GitHubApi {
  private _octokit: InstanceType<typeof customOctokit>;
  private _org: string;

  constructor(token: string, org: string = MARKETPLACE_ORG) {
    this._octokit = new customOctokit({ auth: token });
    this._org = org;
  }

  async getRepositories(): Promise<Repository[]> {
    const data = await this._octokit.paginate(this._octokit.rest.repos.listForOrg, {
      org: this._org,
      type: "all",
      per_page: 100,
    });

    return data.map((repo) => ({
      name: repo.name,
      full_name: repo.full_name,
      owner: { login: repo.owner.login },
    }));
  }

  async getWorkflows(repo: string): Promise<WorkflowInfo[]> {
    try {
      const { data } = await this._octokit.rest.actions.listRepoWorkflows({
        owner: this._org,
        repo,
        per_page: 100,
      });

      return data.workflows.map((wf) => ({ id: wf.id, name: wf.name }));
    } catch (err) {
      throw logger.error(`Failed to get workflows for ${repo}:`, { err });
    }
  }

  async getWorkflowRuns(repo: string, workflowId: number): Promise<WorkflowRun[]> {
    try {
      const { data } = await this._octokit.rest.actions.listWorkflowRuns({
        owner: this._org,
        repo,
        workflow_id: workflowId,
        event: "workflow_dispatch",
        per_page: 100,
        actor: BOT_ACTORS.join(","),
      });

      return data.workflow_runs.map((run) => ({
        id: run.id,
        name: run.name || "",
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
        actor: run.actor ? { login: run.actor.login } : null,
      }));
    } catch (err) {
      throw logger.error(`Failed to get workflow runs for ${repo}:`, { err });
    }
  }

  async checkWorkflowForConsecutiveFailures(
    repo: string,
    workflowId: number,
    workflowName: string,
    threshold: number = CONSECUTIVE_FAILURE_THRESHOLD
  ): Promise<WorkflowFailureInfo | null> {
    const runs = await this.getWorkflowRuns(repo, workflowId);

    // Filter runs triggered by our bot actors
    const botRuns = runs.filter((run) => BOT_ACTORS.includes(run.actor?.login || ""));

    if (botRuns.length === 0) {
      logger.warn(`No bot-triggered runs found for workflow ${workflowName} in ${repo}`);
      return null;
    }

    // Sort by created_at descending (most recent first)
    botRuns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Count consecutive failures from the most recent run
    let consecutiveFailures = 0;
    let lastFailureUrl = "";

    for (const run of botRuns) {
      if (run.conclusion === "failure") {
        consecutiveFailures++;
        if (!lastFailureUrl) {
          lastFailureUrl = run.html_url;
        }
      } else if (run.conclusion === "success") {
        // Stop counting when we hit a success
        break;
      }
      // Skip runs that are still in progress or have other conclusions
    }

    if (consecutiveFailures >= threshold) {
      logger.warn(`Workflow ${workflowName} in ${repo} has ${consecutiveFailures} consecutive failures.`);
      return {
        workflowName,
        workflowId,
        consecutiveFailures,
        lastFailureUrl,
      };
    }

    return null;
  }

  async issueExists(repo: string, title: string): Promise<boolean> {
    try {
      const data = await this._octokit.paginate(this._octokit.rest.issues.listForRepo, {
        owner: this._org,
        repo,
        state: "open",
        per_page: 100,
      });

      return data.some((issue) => issue.title === title && issue.state.toLowerCase() === "open");
    } catch (err) {
      throw logger.error(`Failed to check existing issues for ${repo}:`, { err });
    }
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<void> {
    await this._octokit.rest.issues.create({
      owner: this._org,
      repo,
      title,
      body,
      labels,
    });
  }
}
