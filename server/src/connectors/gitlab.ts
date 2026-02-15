// server/src/connectors/gitlab.ts
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";
import type { Connector } from "./types.js";

export interface GitLabMergeRequestData {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  source_branch: string;
  author: { name: string };
}

export class GitLabConnector implements Connector {
  name = "gitlab";
  icon = "gitlab";

  private baseUrl: string = "https://gitlab.com";
  private token: string | null = null;

  configure(baseUrl: string, token: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  transformMergeRequests(mrs: GitLabMergeRequestData[]): KanbanItem[] {
    return mrs.map((mr) => ({
      source_id: `gitlab:${mr.id}`,
      source_type: "gitlab" as const,
      title: `MR !${mr.iid}: ${mr.title}`,
      body: mr.description ?? null,
      metadata: {
        url: mr.web_url,
        source_branch: mr.source_branch,
        author: mr.author.name,
        iid: mr.iid,
      },
    }));
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.token) {
      throw new Error(
        "GitLab not configured. Call configure(baseUrl, token) first.",
      );
    }

    const response = await fetch(
      `${this.baseUrl}/api/v4/merge_requests?reviewer_username=me&state=opened&scope=all`,
      {
        headers: {
          "PRIVATE-TOKEN": this.token,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    const mrs: GitLabMergeRequestData[] = await response.json();
    return this.transformMergeRequests(mrs);
  }

  async executeAction(
    item: KanbanItem,
    action: ActionPayload,
  ): Promise<ActionResult> {
    if (!this.token) {
      throw new Error(
        "GitLab not configured. Call configure(baseUrl, token) first.",
      );
    }

    const mrId = item.source_id.replace("gitlab:", "");
    const iid = item.metadata.iid as number;
    const projectPath = this.extractProjectPath(item.metadata.url as string);

    if (!projectPath) {
      return {
        success: false,
        message: "Could not determine project path from MR URL",
      };
    }

    const encodedProject = encodeURIComponent(projectPath);

    switch (action.type) {
      case "post_review_comment": {
        const body = action.body as string;
        if (!body) {
          return { success: false, message: "Comment body is required" };
        }

        const response = await fetch(
          `${this.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${iid}/notes`,
          {
            method: "POST",
            headers: {
              "PRIVATE-TOKEN": this.token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ body }),
          },
        );

        if (!response.ok) {
          return {
            success: false,
            message: `Failed to post comment: ${response.statusText}`,
          };
        }

        return { success: true, message: "Review comment posted on MR" };
      }

      case "approve": {
        const response = await fetch(
          `${this.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${iid}/approve`,
          {
            method: "POST",
            headers: {
              "PRIVATE-TOKEN": this.token,
            },
          },
        );

        if (!response.ok) {
          return {
            success: false,
            message: `Failed to approve MR: ${response.statusText}`,
          };
        }

        return { success: true, message: "Merge request approved" };
      }

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.type}`,
        };
    }
  }

  private extractProjectPath(webUrl: string): string | null {
    try {
      const url = new URL(webUrl);
      // URL format: /group/project/-/merge_requests/N
      const pathParts = url.pathname.split("/-/");
      if (pathParts.length < 2) return null;
      // Remove leading slash
      return pathParts[0].replace(/^\//, "");
    } catch {
      return null;
    }
  }
}
