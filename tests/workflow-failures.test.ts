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
      });
      workflowDb.workflows.create({
        id: 2,
        name: "Deploy",
        repo: TEST_REPO,
        state: "active",
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
