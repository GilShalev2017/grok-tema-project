import { Router } from "express";
import { CollectionService } from "../services/collection.service";
import { PrismaClient } from "@prisma/client"; // ← add this
import prisma from "../lib/prisma"; // adjus

const router = Router();
const service = new CollectionService();

router.post("/import/met", async (req, res) => {
  try {
    console.log("[IMPORT ROUTE] Request body:", req.body);
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
    console.log("[ENRICH ROUTE] Request params:", req.params);
    const item = await service.enrichWithAI(req.params.id);
    res.json(item);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Enrichment failed" });
  }
});

router.get("/items", async (req, res) => {
  try {
    // Parse pagination parameters with defaults
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    
    // Validate parameters
    if (page < 1) {
      return res.status(400).json({ error: "Page must be >= 1" });
    }
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({ error: "Limit must be between 1 and 1000" });
    }
    
    const result = await service.getAllItems(page, limit);
    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

router.get("/departments", async (_req, res) => {
  try {
    const departments = await service.getDepartments();
    res.json(departments);
  } catch (err: any) {
    console.error("[DEPARTMENTS ROUTE] Error:", err);
    res.status(500).json({
      error: "Failed to fetch departments",
      message: err.message || "Unknown error",
    });
  }
});

export default router;
