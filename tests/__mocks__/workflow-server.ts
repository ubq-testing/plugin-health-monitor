import { setupServer } from "msw/node";
import { workflowHandlers } from "./workflow-handlers";

export const workflowServer = setupServer(...workflowHandlers);
