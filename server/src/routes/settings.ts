import { Router } from "express";
import type { SettingsRepo } from "../db/settings-repo.js";

export function createSettingsRouter(settingsRepo: SettingsRepo): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      confidence_threshold: settingsRepo.get("confidence_threshold", 80),
      poll_interval_ms: settingsRepo.get("poll_interval_ms", 5 * 60 * 1000),
    });
  });

  router.patch("/", (req, res) => {
    const { confidence_threshold, poll_interval_ms } = req.body;
    if (confidence_threshold !== undefined) settingsRepo.set("confidence_threshold", confidence_threshold);
    if (poll_interval_ms !== undefined) settingsRepo.set("poll_interval_ms", poll_interval_ms);
    res.json({ success: true });
  });

  return router;
}
