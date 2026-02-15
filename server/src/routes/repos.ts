import { Router } from "express";
import crypto from "crypto";
import { execFileSync } from "child_process";
import type { SettingsRepo } from "../db/settings-repo.js";

interface Repo {
  id: string;
  name: string;
  path: string;
}

export function createReposRouter(settingsRepo: SettingsRepo): Router {
  const router = Router();

  function getRepos(): Repo[] {
    return settingsRepo.get<Repo[]>("repos", []);
  }

  router.get("/", (_req, res) => {
    const repos = getRepos();
    const defaultRepoId = settingsRepo.get<string | null>("default_repo_id", null);
    res.json({ repos, default_repo_id: defaultRepoId });
  });

  router.post("/", (req, res) => {
    const { name, path } = req.body;
    if (!name || !path) {
      res.status(400).json({ error: "name and path are required" });
      return;
    }

    // Validate path is a git repo
    try {
      execFileSync("git", ["-C", path, "rev-parse", "--git-dir"], { timeout: 5000 });
    } catch {
      res.status(400).json({ error: "Path is not a valid git repository" });
      return;
    }

    const repos = getRepos();
    const repo: Repo = { id: crypto.randomUUID(), name, path };
    repos.push(repo);
    settingsRepo.set("repos", repos);
    res.status(201).json(repo);
  });

  router.delete("/:id", (req, res) => {
    const repos = getRepos();
    const filtered = repos.filter((r) => r.id !== req.params.id);
    if (filtered.length === repos.length) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }
    settingsRepo.set("repos", filtered);

    // Clear default if it was the deleted repo
    const defaultId = settingsRepo.get<string | null>("default_repo_id", null);
    if (defaultId === req.params.id) {
      settingsRepo.set("default_repo_id", null);
    }

    res.json({ success: true });
  });

  router.patch("/default", (req, res) => {
    const { repo_id } = req.body;
    settingsRepo.set("default_repo_id", repo_id ?? null);
    res.json({ success: true });
  });

  return router;
}
