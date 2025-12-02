export interface WorkflowInfo {
  id: number;
  name: string;
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

export interface Issue {
  id: number;
  title: string;
  state: string;
  html_url: string;
}
