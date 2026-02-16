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

  async getDiff(worktreePath: string): Promise<{
    files: { path: string; status: string; additions: number; deletions: number; diff: string }[];
    stats: { totalFiles: number; totalAdditions: number; totalDeletions: number };
  }> {
    // Find the merge base to diff against
    let mergeBase = "";
    try {
      const { stdout: baseOut } = await execFileAsync(
        "git",
        ["-C", worktreePath, "merge-base", "HEAD", "origin/main"],
        { timeout: 5000 },
      );
      mergeBase = baseOut.trim();
    } catch {
      // Fallback: diff against HEAD~1 or empty tree
      try {
        const { stdout: parentOut } = await execFileAsync(
          "git",
          ["-C", worktreePath, "rev-parse", "HEAD~1"],
          { timeout: 5000 },
        );
        mergeBase = parentOut.trim();
      } catch {
        // Single commit or empty — use empty tree
        mergeBase = "4b825dc642cb6eb9a060e54bf899d69f82559884";
      }
    }

    // Get numstat for file stats
    const { stdout: numstatOut } = await execFileAsync(
      "git",
      ["-C", worktreePath, "diff", "--numstat", mergeBase, "HEAD"],
      { timeout: 10000 },
    );

    // Also include uncommitted working changes
    const { stdout: workingNumstat } = await execFileAsync(
      "git",
      ["-C", worktreePath, "diff", "--numstat"],
      { timeout: 10000 },
    );

    // Get unified diff
    const { stdout: diffOut } = await execFileAsync(
      "git",
      ["-C", worktreePath, "diff", mergeBase, "HEAD"],
      { timeout: 10000 },
    );

    const { stdout: workingDiff } = await execFileAsync(
      "git",
      ["-C", worktreePath, "diff"],
      { timeout: 10000 },
    );

    // Parse numstat lines
    const fileMap = new Map<string, { additions: number; deletions: number }>();
    const parseNumstat = (output: string) => {
      for (const line of output.trim().split("\n")) {
        if (!line) continue;
        const [add, del, filePath] = line.split("\t");
        if (!filePath) continue;
        const existing = fileMap.get(filePath) || { additions: 0, deletions: 0 };
        existing.additions += add === "-" ? 0 : Number(add);
        existing.deletions += del === "-" ? 0 : Number(del);
        fileMap.set(filePath, existing);
      }
    };
    parseNumstat(numstatOut);
    parseNumstat(workingNumstat);

    // Parse unified diff into per-file diffs
    const combinedDiff = (diffOut + "\n" + workingDiff).trim();
    const fileDiffs = new Map<string, string>();
    if (combinedDiff) {
      const parts = combinedDiff.split(/^diff --git /m).filter(Boolean);
      for (const part of parts) {
        const headerLine = part.split("\n")[0];
        const match = headerLine.match(/b\/(.+)$/);
        if (match) {
          fileDiffs.set(match[1], "diff --git " + part);
        }
      }
    }

    // Build result
    const files = Array.from(fileMap.entries()).map(([filePath, stats]) => {
      let status = "modified";
      if (stats.additions > 0 && stats.deletions === 0) status = "added";
      if (stats.additions === 0 && stats.deletions > 0) status = "deleted";
      return {
        path: filePath,
        status,
        additions: stats.additions,
        deletions: stats.deletions,
        diff: fileDiffs.get(filePath) || "",
      };
    });

    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      files,
      stats: { totalFiles: files.length, totalAdditions, totalDeletions },
    };
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
