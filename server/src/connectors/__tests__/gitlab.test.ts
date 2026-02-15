// server/src/connectors/__tests__/gitlab.test.ts
import { describe, it, expect } from "vitest";
import { GitLabConnector } from "../gitlab.js";

describe("GitLabConnector", () => {
  it("transforms MRs to KanbanItems", () => {
    const connector = new GitLabConnector();
    const items = connector.transformMergeRequests([
      {
        id: 42,
        iid: 7,
        title: "Add dark mode",
        description: "Implements dark mode toggle",
        web_url: "https://gitlab.com/team/repo/-/merge_requests/7",
        source_branch: "feature/dark-mode",
        author: { name: "Alice" },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("gitlab:42");
    expect(items[0].title).toBe("MR !7: Add dark mode");
  });

  it("sets source_type to gitlab", () => {
    const connector = new GitLabConnector();
    const items = connector.transformMergeRequests([
      {
        id: 100,
        iid: 10,
        title: "Fix CI",
        description: "Fix broken pipeline",
        web_url: "https://gitlab.com/team/repo/-/merge_requests/10",
        source_branch: "fix/ci",
        author: { name: "Bob" },
      },
    ]);

    expect(items[0].source_type).toBe("gitlab");
  });

  it("includes metadata with url, branch, and author", () => {
    const connector = new GitLabConnector();
    const items = connector.transformMergeRequests([
      {
        id: 50,
        iid: 5,
        title: "Update readme",
        description: "Better docs",
        web_url: "https://gitlab.com/team/repo/-/merge_requests/5",
        source_branch: "docs/readme",
        author: { name: "Charlie" },
      },
    ]);

    expect(items[0].metadata).toEqual({
      url: "https://gitlab.com/team/repo/-/merge_requests/5",
      source_branch: "docs/readme",
      author: "Charlie",
      iid: 5,
    });
  });

  it("handles MRs with null description", () => {
    const connector = new GitLabConnector();
    const items = connector.transformMergeRequests([
      {
        id: 99,
        iid: 1,
        title: "Quick fix",
        description: null,
        web_url: "https://gitlab.com/team/repo/-/merge_requests/1",
        source_branch: "hotfix",
        author: { name: "Dave" },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].body).toBeNull();
  });

  it("transforms multiple MRs", () => {
    const connector = new GitLabConnector();
    const items = connector.transformMergeRequests([
      {
        id: 1,
        iid: 1,
        title: "First",
        description: "Desc 1",
        web_url: "https://gitlab.com/1",
        source_branch: "branch-1",
        author: { name: "A" },
      },
      {
        id: 2,
        iid: 2,
        title: "Second",
        description: "Desc 2",
        web_url: "https://gitlab.com/2",
        source_branch: "branch-2",
        author: { name: "B" },
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].source_id).toBe("gitlab:1");
    expect(items[1].source_id).toBe("gitlab:2");
  });

  it("has correct name and icon", () => {
    const connector = new GitLabConnector();
    expect(connector.name).toBe("gitlab");
    expect(connector.icon).toBe("gitlab");
  });
});
