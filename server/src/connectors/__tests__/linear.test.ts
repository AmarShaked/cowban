// server/src/connectors/__tests__/linear.test.ts
import { describe, it, expect } from "vitest";
import { LinearConnector } from "../linear.js";

describe("LinearConnector", () => {
  it("transforms linear issues to KanbanItems", () => {
    const connector = new LinearConnector();
    const items = connector.transformIssues([
      {
        id: "issue_1",
        identifier: "ENG-123",
        title: "Fix login bug",
        description: "Users can't log in",
        url: "https://linear.app/team/issue/ENG-123",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("linear:issue_1");
    expect(items[0].title).toBe("[ENG-123] Fix login bug");
  });

  it("sets source_type to linear", () => {
    const connector = new LinearConnector();
    const items = connector.transformIssues([
      {
        id: "issue_2",
        identifier: "ENG-456",
        title: "Refactor auth",
        description: "Clean up auth module",
        url: "https://linear.app/team/issue/ENG-456",
      },
    ]);

    expect(items[0].source_type).toBe("linear");
  });

  it("includes metadata with url and identifier", () => {
    const connector = new LinearConnector();
    const items = connector.transformIssues([
      {
        id: "issue_3",
        identifier: "ENG-789",
        title: "Add tests",
        description: "Increase coverage",
        url: "https://linear.app/team/issue/ENG-789",
      },
    ]);

    expect(items[0].metadata).toEqual({
      url: "https://linear.app/team/issue/ENG-789",
      identifier: "ENG-789",
    });
  });

  it("handles issues with null description", () => {
    const connector = new LinearConnector();
    const items = connector.transformIssues([
      {
        id: "issue_4",
        identifier: "ENG-000",
        title: "No description issue",
        description: undefined,
        url: "https://linear.app/team/issue/ENG-000",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].body).toBeNull();
  });

  it("transforms multiple issues", () => {
    const connector = new LinearConnector();
    const items = connector.transformIssues([
      {
        id: "a",
        identifier: "ENG-1",
        title: "First",
        description: "Desc 1",
        url: "https://linear.app/1",
      },
      {
        id: "b",
        identifier: "ENG-2",
        title: "Second",
        description: "Desc 2",
        url: "https://linear.app/2",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].source_id).toBe("linear:a");
    expect(items[1].source_id).toBe("linear:b");
  });

  it("has correct name and icon", () => {
    const connector = new LinearConnector();
    expect(connector.name).toBe("linear");
    expect(connector.icon).toBe("linear");
  });
});
