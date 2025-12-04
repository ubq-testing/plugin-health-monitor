export interface WorkflowInfo {
  id: number;
  name: string;
  path: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
  actor: {
    login: string;
  } | null;
}

export interface WorkflowFailureInfo {
  workflowName: string;
  workflowId: number;
  consecutiveFailures: number;
  lastFailureUrl: string;
  lastFailureRunId?: number;
}

export interface RepoFailures {
  repo: string;
  failures: WorkflowFailureInfo[];
}

export interface Repository {
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
}

// Failure details types
export interface FailedStep {
  name: string;
  number: number;
  conclusion: string;
}

export interface JobFailureDetails {
  jobId: number;
  jobName: string;
  conclusion: string;
  failedSteps: FailedStep[];
  htmlUrl: string;
}

export interface WorkflowFailureDetails {
  repo: string;
  workflowName: string;
  workflowId: number;
  runId: number;
  runUrl: string;
  failedJobs: JobFailureDetails[];
  logExcerpt?: string;
}

// AI Analysis types
export interface FailureAnalysis {
  repo: string;
  workflowName: string;
  runId: number;
  runUrl: string;
  summary: string;
  rootCause: string;
  errorMessages: string[];
  affectedFiles: string[];
  fixSpecification: string;
  suggestedActions: string[];
  analyzedAt: string;
}
