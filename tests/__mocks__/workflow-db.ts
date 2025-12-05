// cSpell:disable
import { factory, nullable, primaryKey } from "@mswjs/data";

/**
 * Creates an object that can be used as a db to persist data within workflow failure tests
 */
export const workflowDb = factory({
  repos: {
    id: primaryKey(Number),
    name: String,
    full_name: String,
    owner: {
      login: String,
      id: Number,
    },
  },
  workflows: {
    id: primaryKey(Number),
    name: String,
    repo: String,
    state: String,
    path: String,
  },
  workflowRuns: {
    id: primaryKey(Number),
    workflow_id: Number,
    repo: String,
    name: String,
    conclusion: nullable(String),
    created_at: String,
    html_url: String,
    event: String,
    actor: nullable({
      login: String,
      id: Number,
    }),
  },
  issues: {
    id: primaryKey(Number),
    repo: String,
    title: String,
    body: String,
    state: String,
    labels: Array,
  },
  jobs: {
    id: primaryKey(Number),
    run_id: Number,
    repo: String,
    name: String,
    conclusion: nullable(String),
    html_url: String,
    steps: Array,
  },
  jobLogs: {
    job_id: primaryKey(Number),
    repo: String,
    content: String,
  },
});
