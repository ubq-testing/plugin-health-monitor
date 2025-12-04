import { BOT_ACTORS, CONSECUTIVE_FAILURE_THRESHOLD, MARKETPLACE_ORG } from "../types/constants";
import { Repository, WorkflowFailureInfo, WorkflowInfo, WorkflowRun, WorkflowFailureDetails, JobFailureDetails, FailedStep } from "../types/workflow";
import { customOctokit, RestEndpointMethodTypes } from "@ubiquity-os/plugin-sdk/octokit";
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

      return data.workflows.filter((wf) => wf.path.includes("compute")).map((wf) => ({ id: wf.id, name: wf.name, path: wf.path }));
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
        per_page: 100,
      });

      function getActor(run: RestEndpointMethodTypes["actions"]["listWorkflowRuns"]["response"]["data"]["workflow_runs"][0]) {
        if (run.actor) {
          return { login: run.actor.login };
        } else if (run.triggering_actor) {
          return { login: run.triggering_actor.login };
        } else if (run.head_commit) {
          return { login: run.head_commit.author?.name || "" };
        } else {
          return null;
        }
      }

      return data.workflow_runs.map((run) => ({
        id: run.id,
        name: run.name || "",
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
        actor: getActor(run),
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
    const botRuns = runs.filter((run) => BOT_ACTORS.includes(run.actor?.login.toLowerCase() || ""));

    if (botRuns.length === 0) {
      logger.warn(`No bot-triggered runs found for workflow ${workflowName} in ${repo}`);
      return null;
    }

    // Sort by created_at descending (most recent first)
    botRuns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Count consecutive failures from the most recent run
    let consecutiveFailures = 0;
    let lastFailureUrl = "";
    let lastFailureRunId = 0;

    for (const run of botRuns) {
      if (run.conclusion === "failure") {
        consecutiveFailures++;
        if (!lastFailureUrl) {
          lastFailureUrl = run.html_url;
          lastFailureRunId = run.id;
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
        lastFailureRunId,
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

  /**
   * Get detailed failure information for a workflow run including failed jobs, steps, and log excerpts
   */
  async getFailureDetails(repo: string, runId: number, workflowName: string, workflowId: number): Promise<WorkflowFailureDetails> {
    const failedJobs = await this._getFailedJobs(repo, runId);

    // Get log excerpt from the first failed job
    let logExcerpt: string | undefined;
    if (failedJobs.length > 0) {
      logExcerpt = await this._getJobLogExcerpt(repo, failedJobs[0].jobId);
    }

    return {
      repo,
      workflowName,
      workflowId,
      runId,
      runUrl: `https://github.com/${this._org}/${repo}/actions/runs/${runId}`,
      failedJobs,
      logExcerpt,
    };
  }

  /**
   * Get all failed jobs for a workflow run with their failed steps
   */
  private async _getFailedJobs(repo: string, runId: number): Promise<JobFailureDetails[]> {
    try {
      const { data } = await this._octokit.rest.actions.listJobsForWorkflowRun({
        owner: this._org,
        repo,
        run_id: runId,
        filter: "latest",
      });

      const failedJobs: JobFailureDetails[] = [];

      for (const job of data.jobs) {
        if (job.conclusion === "failure") {
          const failedSteps: FailedStep[] = (job.steps || [])
            .filter((step) => step.conclusion === "failure")
            .map((step) => ({
              name: step.name,
              number: step.number,
              conclusion: step.conclusion || "failure",
            }));

          failedJobs.push({
            jobId: job.id,
            jobName: job.name,
            conclusion: job.conclusion,
            failedSteps,
            htmlUrl: job.html_url || "",
          });
        }
      }

      return failedJobs;
    } catch (err) {
      logger.error(`Failed to get jobs for run ${runId} in ${repo}`, { err });
      return [];
    }
  }

  /**
   * Download and extract relevant error portions from a job's logs
   */
  private async _getJobLogExcerpt(repo: string, jobId: number): Promise<string | undefined> {
    try {
      const response = await this._octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner: this._org,
        repo,
        job_id: jobId,
      });

      // Response is a redirect URL or the log content
      return typeof response.data === "string" ? response.data : String(response.data);
    } catch (err) {
      logger.warn(`Failed to download logs for job ${jobId} in ${repo}`, { err });
      return undefined;
    }
  }

  /**
   * Extract relevant error lines from raw log content
   */
  extractRelevantLogLines(logContent: string): string {
    const lines = logContent.split("\n");
    const relevantLines: { index: number; line: string }[] = [];

    const MAX_LOG_EXCERPT_LINES = 100;
    const CONTEXT_LINES = 3;

    // Patterns to identify relevant error lines in logs
    const ERROR_PATTERNS = [
      /error:/i,
      /failed:/i,
      /exception:/i,
      /fatal:/i,
      /\bat\s+\S+:\d+:\d+/i, // Stack trace line numbers
      /cannot find/i,
      /not found/i,
      /undefined/i,
      /npm err!/i,
      /exit code \d+/i,
      /process completed with exit code/i,
    ];

    // Find lines matching error patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
        // Add context lines before and after
        const startIdx = Math.max(0, i - CONTEXT_LINES);
        const endIdx = Math.min(lines.length - 1, i + CONTEXT_LINES);

        for (let j = startIdx; j <= endIdx; j++) {
          if (!relevantLines.some((r) => r.index === j)) {
            relevantLines.push({ index: j, line: lines[j] });
          }
        }
      }
    }

    // Sort by line index and deduplicate
    relevantLines.sort((a, b) => a.index - b.index);

    // Limit total lines
    const limitedLines = relevantLines.slice(0, MAX_LOG_EXCERPT_LINES);

    if (limitedLines.length === 0) {
      // If no patterns matched, return the last N lines (often contain the error)
      return lines.slice(-MAX_LOG_EXCERPT_LINES).join("\n");
    }

    // Build excerpt with line separators for gaps
    const excerptLines: string[] = [];
    let lastIndex = -1;

    for (const { index, line } of limitedLines) {
      if (lastIndex !== -1 && index > lastIndex + 1) {
        excerptLines.push("...");
      }
      excerptLines.push(line);
      lastIndex = index;
    }

    return excerptLines.join("\n");
  }
}
