import type { AgentRunnerSuggestion } from "../agentRuntime";
import type { TaskRepository } from "../data/taskRepository";
import type { AgentActionSource } from "./actions";

export async function enqueueAgentRunnerSuggestions(
  repository: Pick<TaskRepository, "createAgentPendingActionFromTool">,
  suggestions: AgentRunnerSuggestion[],
  sourceForSuggestion: (suggestion: AgentRunnerSuggestion) => AgentActionSource,
) {
  await Promise.all(suggestions.map((suggestion) =>
    repository.createAgentPendingActionFromTool(
      suggestion.action,
      sourceForSuggestion(suggestion),
    ),
  ));
}
