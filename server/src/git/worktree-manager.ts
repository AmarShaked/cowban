import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

export class WorktreeManager {
  async create(repoPath: string, cardId: number, title: string): Promise<WorktreeInfo> {
    const branchName = `kanban/${cardId}-${slugify(title)}`;
    const worktreeDir = path.resolve(repoPath, "..", "worktrees");
    const worktreePath = path.join(worktreeDir, `card-${cardId}`);

    // Create worktrees directory if needed
    if (!fs.existsSync(worktreeDir)) {
      fs.mkdirSync(worktreeDir, { recursive: true });
    }

    // If worktree already exists, reuse it
    if (fs.existsSync(worktreePath)) {
      return { worktreePath, branchName };
    }

    // Check if branch exists, delete if orphaned
    try {
      await execFileAsync("git", ["-C", repoPath, "rev-parse", "--verify", branchName], { timeout: 5000 });
      // Branch exists — try to reuse or delete
      await execFileAsync("git", ["-C", repoPath, "branch", "-D", branchName], { timeout: 5000 });
    } catch {
      // Branch doesn't exist, good
    }

    await execFileAsync(
      "git",
      ["-C", repoPath, "worktree", "add", worktreePath, "-b", branchName],
      { timeout: 10000 },
    );

    return { worktreePath, branchName };
  }

  async remove(worktreePath: string): Promise<void> {
    if (!fs.existsSync(worktreePath)) return;

    // Find the main repo from the worktree
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { timeout: 5000 },
      );
      const gitCommonDir = stdout.trim();
      const repoPath = path.resolve(gitCommonDir, "..");

      // Get branch name before removing
      const { stdout: branchOut } = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
        { timeout: 5000 },
      );
      const branchName = branchOut.trim();

      await execFileAsync("git", ["-C", repoPath, "worktree", "remove", worktreePath, "--force"], { timeout: 10000 });

      // Delete the branch
      if (branchName && branchName !== "HEAD") {
        try {
          await execFileAsync("git", ["-C", repoPath, "branch", "-D", branchName], { timeout: 5000 });
        } catch {
          // Branch may already be gone
        }
      }
    } catch (err) {
      console.error("Failed to remove worktree:", err);
      // Fallback: just delete the directory
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  async commit(worktreePath: string, message: string): Promise<void> {
    await execFileAsync("git", ["-C", worktreePath, "add", "-A"], { timeout: 10000 });

    // Check if there are changes to commit
    try {
      await execFileAsync("git", ["-C", worktreePath, "diff", "--cached", "--quiet"], { timeout: 5000 });
      // No changes — skip commit
    } catch {
      // There are staged changes — commit
      await execFileAsync("git", ["-C", worktreePath, "commit", "-m", message], { timeout: 10000 });
    }
  }

  async createPR(worktreePath: string, title: string, body: string): Promise<string> {
    // Push the branch
    const { stdout: branchOut } = await execFileAsync(
      "git",
      ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: 5000 },
    );
    const branchName = branchOut.trim();

    await execFileAsync("git", ["-C", worktreePath, "push", "-u", "origin", branchName], { timeout: 30000 });

    // Create PR
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "create", "--title", title, "--body", body, "--head", branchName],
      { cwd: worktreePath, timeout: 15000 },
    );

    // Return PR URL (last line of gh output)
    return stdout.trim().split("\n").pop() || "";
  }
}
