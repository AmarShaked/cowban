// server/src/connectors/linear.ts
import { LinearClient } from "@linear/sdk";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";
import type { Connector } from "./types.js";

export interface LinearIssueData {
  id: string;
  identifier: string;
  title: string;
  description: string | undefined;
  url: string;
}

export class LinearConnector implements Connector {
  name = "linear";
  icon = "linear";

  private client: LinearClient | null = null;

  setApiKey(key: string): void {
    this.client = new LinearClient({ apiKey: key });
  }

  transformIssues(issues: LinearIssueData[]): KanbanItem[] {
    return issues.map((issue) => ({
      source_id: `linear:${issue.id}`,
      source_type: "linear" as const,
      title: `[${issue.identifier}] ${issue.title}`,
      body: issue.description ?? null,
      metadata: {
        url: issue.url,
        identifier: issue.identifier,
      },
    }));
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.client) {
      throw new Error("Linear client not configured. Call setApiKey() first.");
    }

    const me = await this.client.viewer;
    const issues = await me.assignedIssues({
      filter: {
        state: { name: { eq: "Todo" } },
      },
    });

    const issueData: LinearIssueData[] = issues.nodes.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      url: issue.url,
    }));

    return this.transformIssues(issueData);
  }

  async executeAction(
    item: KanbanItem,
    action: ActionPayload,
  ): Promise<ActionResult> {
    if (!this.client) {
      throw new Error("Linear client not configured. Call setApiKey() first.");
    }

    const issueId = item.source_id.replace("linear:", "");

    switch (action.type) {
      case "add_comment": {
        const body = action.body as string;
        if (!body) {
          return { success: false, message: "Comment body is required" };
        }
        await this.client.createComment({ issueId, body });
        return { success: true, message: "Comment added to Linear issue" };
      }

      case "update_status": {
        const statusName = action.status as string;
        if (!statusName) {
          return { success: false, message: "Status name is required" };
        }

        const issue = await this.client.issue(issueId);
        const team = await issue.team;
        if (!team) {
          return { success: false, message: "Could not find team for issue" };
        }

        const states = await team.states();
        const targetState = states.nodes.find(
          (s) => s.name.toLowerCase() === statusName.toLowerCase(),
        );

        if (!targetState) {
          return {
            success: false,
            message: `Status "${statusName}" not found`,
          };
        }

        await this.client.updateIssue(issueId, { stateId: targetState.id });
        return {
          success: true,
          message: `Issue status updated to "${statusName}"`,
        };
      }

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.type}`,
        };
    }
  }
}
