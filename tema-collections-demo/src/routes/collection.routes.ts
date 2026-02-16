import { Router } from "express";
import { CollectionService } from "../services/collection.service";
import { PrismaClient } from "@prisma/client"; // ← add this
import prisma from "../lib/prisma"; // adjus

const router = Router();
const service = new CollectionService();

router.post("/import/met", async (req, res) => {
  try {
    const { searchTerm = "*", departmentIds = [] } = req.body;
    const result = await service.importFromMet(searchTerm, departmentIds);
    res.json(result);
  } catch (err: any) {
    console.error("[IMPORT ROUTE] Error:", err);
    res.status(500).json({
      error: "Import failed",
      message: err.message || "Unknown error",
    });
  }
});

router.post("/enrich/:id", async (req, res) => {
  try {
    const item = await service.enrichWithAI(req.params.id);
    res.json(item);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Enrichment failed" });
  }
});

router.get("/items", async (_req, res) => {
  try {
    const items = await service.getAllItems(); // ← use service method
    res.json(items);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

export default router;
