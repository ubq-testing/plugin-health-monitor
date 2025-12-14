import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { drop } from "@mswjs/data";
import { GitHubApi } from "../src/handlers/github-api";
import { checkRepository, createIssueForFailures } from "../src/handlers/workflow-checker";
import { ISSUE_TITLE } from "../src/types/constants";
import { workflowDb } from "./__mocks__/workflow-db";
import { workflowServer } from "./__mocks__/workflow-server";

const TEST_ORG = "test-org";
const TEST_REPO = "test-repo";
const TEST_TOKEN = "test-token";

beforeAll(() => {
  workflowServer.listen();
});

afterEach(() => {
  workflowServer.resetHandlers();
  drop(workflowDb);
});

afterAll(() => {
  workflowServer.close();
});

function createWorkflowRuns(workflowId: number, repo: string, runs: Array<{ conclusion: string | null; actor: string; daysAgo: number }>) {
  runs.forEach((run, index) => {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - run.daysAgo);

    workflowDb.workflowRuns.create({
      id: index + 1,
      workflow_id: workflowId,
      repo,
      name: "Test Workflow",
      conclusion: run.conclusion,
      created_at: createdAt.toISOString(),
      html_url: `https://github.com/${TEST_ORG}/${repo}/actions/runs/${index + 1}`,
      event: "workflow_dispatch",
      actor: {
        login: run.actor,
        id: 1,
      },
    });
  });
}

describe("GitHubApi", () => {
  describe("getRepositories", () => {
    it("should fetch all repositories from the organization", async () => {
      workflowDb.repos.create({
        id: 1,
        name: "repo-1",
        full_name: `${TEST_ORG}/repo-1`,
        owner: { login: TEST_ORG, id: 1 },
      });
      workflowDb.repos.create({
        id: 2,
        name: "repo-2",
        full_name: `${TEST_ORG}/repo-2`,
        owner: { login: TEST_ORG, id: 1 },
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const repos = await api.getRepositories();

      expect(repos).toHaveLength(2);
      expect(repos[0].name).toBe("repo-1");
      expect(repos[1].name).toBe("repo-2");
    });

    it("should return empty array when organization has no repositories", async () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const repos = await api.getRepositories();

      expect(repos).toHaveLength(0);
    });
  });

  describe("getWorkflows", () => {
    it("should fetch all workflows for a repository", async () => {
      workflowDb.workflows.create({
        id: 1,
        name: "CI",
        repo: TEST_REPO,
        state: "active",
        path: ".github/workflows/compute.yml",
      });
      workflowDb.workflows.create({
        id: 2,
        name: "Deploy",
        repo: TEST_REPO,
        state: "active",
        path: ".github/workflows/compute.yml",
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const workflows = await api.getWorkflows(TEST_REPO);

      expect(workflows).toHaveLength(2);
      expect(workflows[0].name).toBe("CI");
      expect(workflows[1].name).toBe("Deploy");
    });
  });

  describe("checkWorkflowForConsecutiveFailures", () => {
    beforeEach(() => {
      workflowDb.workflows.create({
        id: 1,
        name: "Test Workflow",
        repo: TEST_REPO,
        state: "active",
        path: ".github/workflows/compute.yml",
      });
    });

    it("should detect 10 consecutive failures from bot actor", async () => {
      const runs = Array.from({ length: 12 }, (_, i) => ({
        conclusion: "failure",
        actor: "ubiquity-os[bot]",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow");

      expect(failure).not.toBeNull();
      expect(failure?.consecutiveFailures).toBe(12);
      expect(failure?.workflowName).toBe("Test Workflow");
    });

    it("should detect failures from ubiquity-os-dev[bot]", async () => {
      const runs = Array.from({ length: 10 }, (_, i) => ({
        conclusion: "failure",
        actor: "ubiquity-os-dev[bot]",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow");

      expect(failure).not.toBeNull();
      expect(failure?.consecutiveFailures).toBe(10);
    });

    it("should stop counting at a successful run", async () => {
      const runs = [
        { conclusion: "failure", actor: "ubiquity-os[bot]", daysAgo: 0 },
        { conclusion: "failure", actor: "ubiquity-os[bot]", daysAgo: 1 },
        { conclusion: "failure", actor: "ubiquity-os[bot]", daysAgo: 2 },
        { conclusion: "success", actor: "ubiquity-os[bot]", daysAgo: 3 },
        { conclusion: "failure", actor: "ubiquity-os[bot]", daysAgo: 4 },
        { conclusion: "failure", actor: "ubiquity-os[bot]", daysAgo: 5 },
      ];
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow");

      // Only 3 consecutive failures before the success, which is below threshold
      expect(failure).toBeNull();
    });

    it("should return null when failures are below threshold", async () => {
      const runs = Array.from({ length: 5 }, (_, i) => ({
        conclusion: "failure",
        actor: "ubiquity-os[bot]",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow");

      expect(failure).toBeNull();
    });

    it("should ignore runs from non-bot actors", async () => {
      const runs = Array.from({ length: 15 }, (_, i) => ({
        conclusion: "failure",
        actor: "some-user",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow");

      expect(failure).toBeNull();
    });

    it("should return null when no workflow runs exist", async () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow");

      expect(failure).toBeNull();
    });

    it("should use custom threshold when provided", async () => {
      const runs = Array.from({ length: 5 }, (_, i) => ({
        conclusion: "failure",
        actor: "ubiquity-os[bot]",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failure = await api.checkWorkflowForConsecutiveFailures(TEST_REPO, 1, "Test Workflow", 5);

      expect(failure).not.toBeNull();
      expect(failure?.consecutiveFailures).toBe(5);
    });
  });

  describe("issueExists", () => {
    it("should return true when issue with title exists", async () => {
      workflowDb.issues.create({
        id: 1,
        repo: TEST_REPO,
        title: ISSUE_TITLE,
        body: "Test body",
        state: "open",
        labels: [],
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const doesExist = await api.issueExists(TEST_REPO, ISSUE_TITLE);

      expect(doesExist).toBe(true);
    });

    it("should return false when issue does not exist", async () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const doesExist = await api.issueExists(TEST_REPO, ISSUE_TITLE);

      expect(doesExist).toBe(false);
    });
  });

  describe("createIssue", () => {
    it("should create an issue in the repository", async () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      await api.createIssue(TEST_REPO, "Test Issue", "Test body", ["bug"]);

      const issues = workflowDb.issues.getAll();
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe("Test Issue");
      expect(issues[0].body).toBe("Test body");
    });
  });
});

describe("Workflow Checker", () => {
  describe("checkRepository", () => {
    it("should return failures for workflows with consecutive failures", async () => {
      workflowDb.workflows.create({
        id: 1,
        name: "Failing Workflow",
        repo: TEST_REPO,
        state: "active",
        path: ".github/workflows/compute.yml",
      });

      const runs = Array.from({ length: 12 }, (_, i) => ({
        conclusion: "failure",
        actor: "ubiquity-os[bot]",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failures = await checkRepository(api, TEST_REPO);

      expect(failures).toHaveLength(1);
      expect(failures[0].workflowName).toBe("Failing Workflow");
      expect(failures[0].consecutiveFailures).toBe(12);
    });

    it("should return empty array when no workflows have failures", async () => {
      workflowDb.workflows.create({
        id: 1,
        name: "Healthy Workflow",
        repo: TEST_REPO,
        state: "active",
        path: ".github/workflows/compute.yml",
      });

      const runs = Array.from({ length: 5 }, (_, i) => ({
        conclusion: "success",
        actor: "ubiquity-os[bot]",
        daysAgo: i,
      }));
      createWorkflowRuns(1, TEST_REPO, runs);

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failures = await checkRepository(api, TEST_REPO);

      expect(failures).toHaveLength(0);
    });
  });

  describe("createIssueForFailures", () => {
    it("should create an issue when failures are found", async () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failures = [
        {
          workflowName: "CI",
          workflowId: 1,
          consecutiveFailures: 15,
          lastFailureUrl: "https://github.com/test/actions/runs/1",
        },
      ];

      const isCreated = await createIssueForFailures(api, TEST_REPO, failures);

      expect(isCreated).toBe(true);
      const issues = workflowDb.issues.getAll();
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe(ISSUE_TITLE);
      expect(issues[0].body).toContain("CI");
      expect(issues[0].body).toContain("15");
    });

    it("should not create duplicate issues", async () => {
      workflowDb.issues.create({
        id: 1,
        repo: TEST_REPO,
        title: ISSUE_TITLE,
        body: "Existing issue",
        state: "open",
        labels: [],
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failures = [
        {
          workflowName: "CI",
          workflowId: 1,
          consecutiveFailures: 15,
          lastFailureUrl: "https://github.com/test/actions/runs/1",
        },
      ];

      const isCreated = await createIssueForFailures(api, TEST_REPO, failures);

      expect(isCreated).toBe(false);
      const issues = workflowDb.issues.getAll();
      expect(issues).toHaveLength(1);
    });

    it("should include admin tags in issue body", async () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const failures = [
        {
          workflowName: "CI",
          workflowId: 1,
          consecutiveFailures: 10,
          lastFailureUrl: "https://github.com/test/actions/runs/1",
        },
      ];

      await createIssueForFailures(api, TEST_REPO, failures);

      const issues = workflowDb.issues.getAll();
      expect(issues[0].body).toContain("@0x4007");
      expect(issues[0].body).toContain("@gentlementlegen");
    });
  });
});

describe("Environment Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw error when GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;

    const { validateEnv } = await import("../src/types/env");

    expect(() => validateEnv()).toThrow();
  });

  it("should return token when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "test-token-123";

    const { validateEnv } = await import("../src/types/env");
    const env = validateEnv();

    expect(env.GITHUB_TOKEN).toBe("test-token-123");
  });
});

describe("GitHubApi Failure Details", () => {
  describe("getFailureDetails", () => {
    it("should fetch failed jobs and log excerpt for a workflow run", async () => {
      // Create a failed job with steps
      workflowDb.jobs.create({
        id: 101,
        run_id: 12345,
        repo: TEST_REPO,
        name: "Build Job",
        conclusion: "failure",
        html_url: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/12345/jobs/101`,
        steps: [
          { name: "Checkout", number: 1, conclusion: "success" },
          { name: "Install dependencies", number: 2, conclusion: "failure" },
          { name: "Build", number: 3, conclusion: "skipped" },
        ],
      });

      // Create job logs
      workflowDb.jobLogs.create({
        job_id: 101,
        repo: TEST_REPO,
        content: "Error: npm install failed\nCannot find module 'something'\nexit code 1",
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const details = await api.getFailureDetails(TEST_REPO, 12345, "Test Workflow", 1);

      expect(details.repo).toBe(TEST_REPO);
      expect(details.workflowName).toBe("Test Workflow");
      expect(details.runId).toBe(12345);
      expect(details.failedJobs).toHaveLength(1);
      expect(details.failedJobs[0].jobName).toBe("Build Job");
      expect(details.failedJobs[0].failedSteps).toHaveLength(1);
      expect(details.failedJobs[0].failedSteps[0].name).toBe("Install dependencies");
      expect(details.logExcerpt).toContain("npm install failed");
    });

    it("should return empty failedJobs when no jobs failed", async () => {
      workflowDb.jobs.create({
        id: 102,
        run_id: 12346,
        repo: TEST_REPO,
        name: "Success Job",
        conclusion: "success",
        html_url: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/12346/jobs/102`,
        steps: [{ name: "Checkout", number: 1, conclusion: "success" }],
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const details = await api.getFailureDetails(TEST_REPO, 12346, "Test Workflow", 1);

      expect(details.failedJobs).toHaveLength(0);
      expect(details.logExcerpt).toBeUndefined();
    });

    it("should handle multiple failed jobs", async () => {
      workflowDb.jobs.create({
        id: 103,
        run_id: 12347,
        repo: TEST_REPO,
        name: "Build Job",
        conclusion: "failure",
        html_url: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/12347/jobs/103`,
        steps: [{ name: "Build", number: 1, conclusion: "failure" }],
      });

      workflowDb.jobs.create({
        id: 104,
        run_id: 12347,
        repo: TEST_REPO,
        name: "Test Job",
        conclusion: "failure",
        html_url: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/12347/jobs/104`,
        steps: [{ name: "Run tests", number: 1, conclusion: "failure" }],
      });

      workflowDb.jobLogs.create({
        job_id: 103,
        repo: TEST_REPO,
        content: "Build failed with error",
      });

      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const details = await api.getFailureDetails(TEST_REPO, 12347, "Test Workflow", 1);

      expect(details.failedJobs).toHaveLength(2);
      // Log excerpt should be from the first failed job
      expect(details.logExcerpt).toContain("Build failed");
    });
  });

  describe("extractRelevantLogLines", () => {
    it("should extract error lines with context", () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const logContent = [
        "Line 1: Starting build",
        "Line 2: Installing packages",
        "Line 3: Compiling source",
        "Line 4: Error: Cannot find module 'missing-package'",
        "Line 5: Build failed",
        "Line 6: Cleaning up",
      ].join("\n");

      const extracted = api.extractRelevantLogLines(logContent);

      expect(extracted).toContain("Error: Cannot find module");
      expect(extracted).toContain("Installing packages"); // Context before
      expect(extracted).toContain("Cleaning up"); // Context after
    });

    it("should handle multiple error patterns", () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const logContent = ["Step 1: Setup", "npm ERR! Missing script", "fatal: not a git repository", "Process completed with exit code 1"].join("\n");

      const extracted = api.extractRelevantLogLines(logContent);

      expect(extracted).toContain("npm ERR!");
      expect(extracted).toContain("fatal:");
      expect(extracted).toContain("exit code 1");
    });

    it("should return last lines when no error patterns match", () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const logContent = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}: Some output`).join("\n");

      const extracted = api.extractRelevantLogLines(logContent);

      // Should return last 100 lines
      expect(extracted).toContain("Line 150");
      expect(extracted).toContain("Line 51");
      expect(extracted).not.toContain("Line 49:");
    });

    it("should handle stack trace patterns", () => {
      const api = new GitHubApi(TEST_TOKEN, TEST_ORG);
      const logContent = [
        "Running tests",
        "TypeError: undefined is not a function",
        "    at Object.<anonymous> (/src/index.ts:42:10)",
        "    at Module._compile (node:internal/modules/cjs/loader:1256:14)",
        "Test failed",
      ].join("\n");

      const extracted = api.extractRelevantLogLines(logContent);

      expect(extracted).toContain("undefined is not a function");
      expect(extracted).toContain("at Object.<anonymous>");
    });
  });
});

describe("Workflow Checker", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should include log excerpt in issue body", async () => {
    workflowDb.jobs.create({
      id: 202,
      run_id: 2,
      repo: TEST_REPO,
      name: "Test",
      conclusion: "failure",
      html_url: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/2/jobs/202`,
      steps: [{ name: "Run tests", number: 1, conclusion: "failure" }],
    });

    workflowDb.jobLogs.create({
      job_id: 202,
      repo: TEST_REPO,
      content: "Error: Test suite failed\nExpected 1 but got 2\nexit code 1",
    });

    const api = new GitHubApi(TEST_TOKEN, TEST_ORG);

    const failures = [
      {
        workflowName: "Tests",
        workflowId: 2,
        consecutiveFailures: 10,
        lastFailureUrl: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/2`,
        lastFailureRunId: 2,
      },
    ];

    await createIssueForFailures(api, TEST_REPO, failures);

    const issues = workflowDb.issues.getAll();
    expect(issues).toHaveLength(1);
    expect(issues[0].body).toContain("Relevant Log Excerpt");
    expect(issues[0].body).toContain("Test suite failed");
  });

  it("should handle failures without lastFailureRunId gracefully", async () => {
    const api = new GitHubApi(TEST_TOKEN, TEST_ORG);

    const failures = [
      {
        workflowName: "Legacy",
        workflowId: 3,
        consecutiveFailures: 10,
        lastFailureUrl: `https://github.com/${TEST_ORG}/${TEST_REPO}/actions/runs/3`,
        // No lastFailureRunId
      },
    ];

    await createIssueForFailures(api, TEST_REPO, failures);

    const issues = workflowDb.issues.getAll();
    expect(issues).toHaveLength(1);
    expect(issues[0].body).toContain("Legacy");
    expect(issues[0].body).toContain("10");
  });
});
