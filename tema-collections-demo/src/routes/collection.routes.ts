import { Router } from "express";
import { CollectionService } from "../services/collection.service";
import { PrismaClient } from "@prisma/client"; // ← add this
import prisma from "../lib/prisma"; // adjus
import multer from "multer";
import {
  generateGoogleAuthUrl,
  exchangeCodeForTokens,
} from "../lib/google-auth";

const router = Router();
const service = new CollectionService();

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

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
      return res
        .status(400)
        .json({ error: "Limit must be between 1 and 1000" });
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




router.post("/import/csv", upload.single("csv"), async (req, res) => {
  try {
    const csvFile = req.file;
    if (!csvFile) {
      return res.status(400).json({ error: "No CSV file uploaded" });
    }
    const items = await service.importFromCSV(csvFile);
    res.json({
      success: true,
      items,
      stats: { new: items.length, updated: 0, removed: 0 },
    });
  } catch (err) {
    res.status(500).json({ error: "CSV import failed" });
  }
});


router.get("/drive/auth", async (req, res) => {
  // Implement Google OAuth flow
  const authUrl = generateGoogleAuthUrl();
  res.redirect(authUrl);
});

router.get("/drive/callback", async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error) {
      console.error("[OAUTH] Error from Google:", error);
      return res
        .status(400)
        .json({ error: "OAuth authorization failed", details: error });
    }

    if (!code) {
      return res.status(400).json({ error: "No authorization code provided" });
    }

    const tokens = await exchangeCodeForTokens(code as string);

    // TODO: Store tokens securely (database, session, etc.)
    console.log("[OAUTH] Successfully obtained tokens");

    // Redirect back to frontend with success
    res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:5173"}?auth=success`,
    );
  } catch (err: any) {
    console.error("[OAUTH] Callback error:", err);
    res.status(500).json({
      error: "OAuth callback failed",
      message: err.message,
    });
  }
});

export default router;
