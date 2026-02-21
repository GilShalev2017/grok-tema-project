import { Router } from "express";
import { CollectionService } from "../services/collection.service";
import { PrismaClient } from "@prisma/client"; // ← add this
import prisma from "../lib/prisma"; // adjus
import multer from "multer";
import {
  generateGoogleAuthUrl,
  exchangeCodeForTokens,
} from "../lib/google-auth";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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




// ════════════════════════════════════════════════════════════════════════════
// MULTER CONFIGURATION — Handles both CSV and Images
// ════════════════════════════════════════════════════════════════════════════

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads/artworks");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log("[MULTER] Created upload directory:", uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep original filename for easier CSV matching
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV and common image formats
    if (file.fieldname === "csv") {
      if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
        cb(null, true);
      } else {
        cb(new Error("Only CSV files are allowed for the csv field"));
      }
    } else if (file.fieldname === "images") {
      const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only image files (jpg, png, gif, webp) are allowed"));
      }
    } else {
      cb(new Error("Unexpected field"));
    }
  },
});

// ════════════════════════════════════════════════════════════════════════════
// CSV IMPORT ROUTE — Handles BOTH scenarios automatically
// ════════════════════════════════════════════════════════════════════════════

router.post(
  "/import/csv",
  upload.fields([
    { name: "csv", maxCount: 1 },
    { name: "images", maxCount: 100 }, // Allow up to 100 images
  ]),
  async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const csvFile = files["csv"]?.[0];
      const imageFiles = files["images"];

      console.log("[CSV IMPORT ROUTE] CSV file:", csvFile?.originalname);
      console.log("[CSV IMPORT ROUTE] Image files:", imageFiles?.length || 0);

      if (!csvFile) {
        console.error("[CSV IMPORT ROUTE] No CSV file in request");
        return res.status(400).json({ error: "No CSV file uploaded" });
      }

      // Pass both CSV and images to service
      // Service will automatically detect if images are needed
      const result = await service.importFromCSVUpsert(csvFile, imageFiles);

      console.log(
        "[CSV IMPORT ROUTE] Success! New:",
        result.newCount,
        "Updated:",
        result.updatedCount
      );

      res.json({
        success: true,
        items: result.items,
        stats: {
          new: result.newCount,
          updated: result.updatedCount,
          removed: 0,
        },
        message: `Successfully processed ${result.items.length} artworks (${result.newCount} new, ${result.updatedCount} updated)`,
      });
    } catch (err: any) {
      console.error("[CSV IMPORT ROUTE] Error:", err);
      console.error("[CSV IMPORT ROUTE] Stack:", err.stack);

      res.status(500).json({
        error: "CSV import failed",
        message: err.message || "Unknown error occurred",
      });
    }
  }
);
export default router;
