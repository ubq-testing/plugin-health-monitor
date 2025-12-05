import { OpenAiAdapter } from "../adapters/openai";
import { logger } from "../utils";
import { FailureAnalysis, WorkflowFailureDetails } from "../types/workflow";

const SYSTEM_PROMPT = `You are a CI/CD failure analysis expert. Your task is to analyze GitHub Actions workflow failures and create actionable fix specifications.

When analyzing failures, you should:
1. Identify the root cause of the failure
2. Extract the key error messages
3. Provide a concise summary
4. Create a specification that GitHub Copilot can use to fix the issue

NEVER reveal any sensitive information such as API keys, tokens, or secrets if any are present as plaintext in the logs. They shouldn't be, but DO NOT mention them in your analysis if they are.

Output your analysis in the following JSON format:
{
  "summary": "Brief one-line summary of the failure",
  "rootCause": "Identified root cause of the failure",
  "errorMessages": ["Array of key error messages extracted"],
  "affectedFiles": ["Array of file paths that likely need changes"],
  "fixSpecification": "Detailed specification for Copilot to fix the issue. Include specific code changes, configuration updates, or dependency fixes needed.",
  "suggestedActions": ["Array of specific actions to take"]
}

Be concise but thorough. Focus on actionable information.`;

export class FailureAnalyzer {
  private _llm: OpenAiAdapter;

  constructor(llm?: OpenAiAdapter) {
    this._llm = llm || new OpenAiAdapter();
  }

  async analyzeFailure(failure: WorkflowFailureDetails): Promise<FailureAnalysis | null> {
    const prompt = this._buildAnalysisPrompt(failure);

    logger.debug("Analyzing workflow failure", {
      repo: failure.repo,
      workflow: failure.workflowName,
      runId: failure.runId,
    });

    const response = await this._llm.complete(SYSTEM_PROMPT, prompt);
    if (!response) {
      logger.warn("Failed to get LLM analysis for workflow failure");
      return null;
    }

    try {
      const analysis = this._parseAnalysisResponse(response);
      return {
        ...analysis,
        repo: failure.repo,
        workflowName: failure.workflowName,
        runId: failure.runId,
        runUrl: failure.runUrl,
        analyzedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error("Failed to parse LLM analysis response", { err, response });
      return null;
    }
  }

  private _buildAnalysisPrompt(failure: WorkflowFailureDetails): string {
    const sections: string[] = [
      `## Workflow Failure Analysis Request`,
      ``,
      `**Repository:** ${failure.repo}`,
      `**Workflow:** ${failure.workflowName}`,
      `**Run ID:** ${failure.runId}`,
      `**Run URL:** ${failure.runUrl}`,
      ``,
    ];

    if (failure.failedJobs.length > 0) {
      sections.push(`## Failed Jobs`);
      for (const job of failure.failedJobs) {
        sections.push(``);
        sections.push(`### Job: ${job.jobName}`);
        sections.push(`- **Conclusion:** ${job.conclusion}`);

        if (job.failedSteps.length > 0) {
          sections.push(`- **Failed Steps:**`);
          for (const step of job.failedSteps) {
            sections.push(`  - Step ${step.number}: ${step.name} (${step.conclusion})`);
          }
        }
      }
      sections.push(``);
    }

    if (failure.logExcerpt) {
      sections.push(`## Log Excerpt (Relevant Error Output)`);
      sections.push("```");
      sections.push(failure.logExcerpt);
      sections.push("```");
    }

    sections.push(``);
    sections.push(`Please analyze this failure and provide a fix specification in JSON format.`);

    return sections.join("\n");
  }

  private _parseAnalysisResponse(response: string): Omit<FailureAnalysis, "repo" | "workflowName" | "runId" | "runUrl" | "analyzedAt"> {
    // Extract JSON from response (handle markdown code blocks, including nested ones)
    let jsonStr = response.trim();

    // Check if response starts with a markdown code block
    if (jsonStr.startsWith("```")) {
      // Find the opening code fence (```json or just ```)
      const openingMatch = /^```(?:json)?\s*\n?/.exec(jsonStr);
      if (openingMatch) {
        // Remove the opening fence
        jsonStr = jsonStr.slice(openingMatch[0].length);

        // Find the closing fence - it must be at the end and on its own line
        // This handles nested code blocks by only matching the final closing fence
        const closingMatch = /\n?```\s*$/.exec(jsonStr);
        if (closingMatch) {
          jsonStr = jsonStr.slice(0, closingMatch.index);
        }
      }
    }

    const parsed = JSON.parse(jsonStr.trim());

    return {
      summary: parsed.summary || "Unknown failure",
      rootCause: parsed.rootCause || "Unable to determine root cause",
      errorMessages: Array.isArray(parsed.errorMessages) ? parsed.errorMessages : [],
      affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : [],
      fixSpecification: parsed.fixSpecification || "Manual investigation required",
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
    };
  }

  formatAnalysisForIssue(analysis: FailureAnalysis): string {
    const sections: string[] = [`## 🔍 AI Failure Analysis`, ``, `**Summary:** ${analysis.summary}`, ``, `### Root Cause`, analysis.rootCause, ``];

    if (analysis.errorMessages.length > 0) {
      sections.push(`### Key Error Messages`);
      for (const msg of analysis.errorMessages) {
        sections.push(`- \`${msg}\``);
      }
      sections.push(``);
    }

    if (analysis.affectedFiles.length > 0) {
      sections.push(`### Affected Files`);
      for (const file of analysis.affectedFiles) {
        sections.push(`- \`${file}\``);
      }
      sections.push(``);
    }

    sections.push(`### 🤖 Fix Specification (for Copilot)`);
    sections.push("```");
    sections.push(analysis.fixSpecification);
    sections.push("```");
    sections.push(``);

    if (analysis.suggestedActions.length > 0) {
      sections.push(`### Suggested Actions`);
      for (const action of analysis.suggestedActions) {
        sections.push(`- [ ] ${action}`);
      }
      sections.push(``);
    }

    sections.push(`---`);
    sections.push(`*Analysis generated at ${analysis.analyzedAt}*`);

    return sections.join("\n");
  }
}
