import { http, HttpResponse } from "msw";
import { workflowDb } from "./workflow-db";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Intercepts the routes for workflow failure testing
 */
export const workflowHandlers = [
  // Get org repos
  http.get("https://api.github.com/orgs/:org/repos", ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const perPage = parseInt(url.searchParams.get("per_page") || "100");

    const allRepos = workflowDb.repos.getAll();
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const pagedRepos = allRepos.slice(start, end);

    return HttpResponse.json(pagedRepos);
  }),

  // Get repo workflows
  http.get("https://api.github.com/repos/:owner/:repo/actions/workflows", ({ params }) => {
    const { repo } = params;
    const workflows = workflowDb.workflows.findMany({
      where: { repo: { equals: repo as string } },
    });

    return HttpResponse.json({
      total_count: workflows.length,
      workflows: workflows,
    });
  }),

  // Get workflow runs
  http.get("https://api.github.com/repos/:owner/:repo/actions/workflows/:workflow_id/runs", ({ params, request }) => {
    const { repo, workflow_id: workflowId } = params;
    const url = new URL(request.url);
    const event = url.searchParams.get("event");

    let runs = workflowDb.workflowRuns.findMany({
      where: {
        repo: { equals: repo as string },
        workflow_id: { equals: Number(workflowId) },
      },
    });

    if (event) {
      runs = runs.filter((run) => run.event === event);
    }

    return HttpResponse.json({
      total_count: runs.length,
      workflow_runs: runs,
    });
  }),

  // List jobs for a workflow run
  http.get("https://api.github.com/repos/:owner/:repo/actions/runs/:run_id/jobs", ({ params }) => {
    const { repo, run_id: runId } = params;
    const jobs = workflowDb.jobs.findMany({
      where: {
        repo: { equals: repo as string },
        run_id: { equals: Number(runId) },
      },
    });

    return HttpResponse.json({
      total_count: jobs.length,
      jobs: jobs.map((job) => ({
        id: job.id,
        run_id: job.run_id,
        name: job.name,
        conclusion: job.conclusion,
        html_url: job.html_url,
        steps: job.steps,
      })),
    });
  }),

  // Download job logs
  http.get("https://api.github.com/repos/:owner/:repo/actions/jobs/:job_id/logs", ({ params }) => {
    const { repo, job_id: jobId } = params;
    const jobLog = workflowDb.jobLogs.findFirst({
      where: {
        repo: { equals: repo as string },
        job_id: { equals: Number(jobId) },
      },
    });

    if (!jobLog) {
      return new HttpResponse("No logs available", { status: 200 });
    }

    return new HttpResponse(jobLog.content, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),

  // List repo issues
  http.get("https://api.github.com/repos/:owner/:repo/issues", ({ params }) => {
    const { repo } = params;
    const issues = workflowDb.issues.findMany({
      where: { repo: { equals: repo as string } },
    });

    return HttpResponse.json(issues);
  }),

  // Create issue
  http.post("https://api.github.com/repos/:owner/:repo/issues", async ({ params, request }) => {
    const { repo } = params;
    const body = (await request.json()) as { title: string; body: string; labels: string[] };
    const id = workflowDb.issues.count() + 1;

    const newIssue = workflowDb.issues.create({
      id,
      repo: repo as string,
      title: body.title,
      body: body.body,
      state: "open",
      labels: body.labels || [],
    });

    return HttpResponse.json(newIssue, { status: 201 });
  }),

  // OpenRouter: Get models
  http.get(`${OPENROUTER_BASE_URL}/models`, () => {
    const models = workflowDb.openRouterModels.getAll();

    // If no models are set up, return default free models
    if (models.length === 0) {
      return HttpResponse.json({
        data: [
          { id: "qwen/qwen3-coder:free", pricing: { prompt: "0", completion: "0" } },
          { id: "openai/gpt-oss-20b:free", pricing: { prompt: "0", completion: "0" } },
          { id: "kwaipilot/kat-coder-pro:free", pricing: { prompt: "0", completion: "0" } },
        ],
      });
    }

    return HttpResponse.json({
      data: models.map((m) => ({
        id: m.id,
        pricing: m.pricing,
      })),
    });
  }),

  // OpenRouter: Chat completions
  http.post(`${OPENROUTER_BASE_URL}/chat/completions`, async () => {
    const llmResponse = workflowDb.llmResponses.findFirst({
      where: { id: { equals: 1 } },
    });

    if (!llmResponse) {
      // Return a default mock response
      return HttpResponse.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Test failure summary",
                rootCause: "Test root cause",
                errorMessages: ["Error 1", "Error 2"],
                affectedFiles: ["file1.ts", "file2.ts"],
                fixSpecification: "Fix specification for test",
                suggestedActions: ["Action 1", "Action 2"],
              }),
            },
          },
        ],
      });
    }

    return HttpResponse.json({
      choices: [
        {
          message: {
            content: llmResponse.response,
          },
        },
      ],
    });
  }),
];
