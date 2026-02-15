import { Router } from "express";
import Database from "better-sqlite3";

export function createConnectorsRouter(db: Database.Database): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const configs = db.prepare("SELECT * FROM connector_configs ORDER BY type").all();
    res.json(configs.map((c: any) => ({
      ...c,
      credentials: c.credentials ? "configured" : null,
      enabled: Boolean(c.enabled),
    })));
  });

  router.put("/:type", (req, res) => {
    const { type } = req.params;
    const { credentials, settings, enabled } = req.body;

    db.prepare(
      `INSERT OR REPLACE INTO connector_configs (type, credentials, settings, enabled)
       VALUES (?, ?, ?, ?)`
    ).run(
      type,
      credentials ? JSON.stringify(credentials) : null,
      settings ? JSON.stringify(settings) : null,
      enabled ? 1 : 0
    );

    res.json({ success: true });
  });

  return router;
}
