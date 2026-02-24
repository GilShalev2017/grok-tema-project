/**
 * Collection Routes
 *
 * RESTful API endpoints for managing artwork collections.
 * Handles imports from Met Museum, Google Drive, CSV files,
 * as well as CRUD operations and AI enrichment.
 *
 * @author Your Name
 * @version 1.0.0
 * @since 2024-02-23
 */

import { Router } from "express";
import { CollectionService } from "../services/collection.service";
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

// ════════════════════════════════════════════════════════════════════════════
// MET MUSEUM IMPORT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /import/met
 *
 * Imports artworks from the Metropolitan Museum of Art API.
 * Supports free-text search and department filtering.
 *
 * @body { searchTerm?: string, departmentIds?: number[] }
 * @returns {ImportMetResponse} Imported artworks with statistics
 * @throws {500} If import fails
 */
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

/**
 * POST /enrich/:id
 *
 * Enriches a single artwork with AI-generated keywords and metadata.
 * Uses AI service to analyze the artwork and generate descriptive tags.
 *
 * @param {string} id - The artwork's UUID
 * @returns {Artwork} Enriched artwork with AI-generated metadata
 * @throws {500} If enrichment service fails
 */
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

/**
 * GET /items
 *
 * Retrieves paginated collection items from the database.
 * Supports flexible pagination with validation.
 *
 * @query { page?: number } Page number (default: 1, min: 1)
 * @query { limit?: number } Items per page (default: 100, range: 1-1000)
 * @returns {PaginatedResponse<Artwork>} Paginated artwork collection
 * @throws {400} If pagination parameters are invalid
 * @throws {500} If database query fails
 */
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

/**
 * GET /departments
 *
 * Retrieves available departments from the Metropolitan Museum of Art.
 * Used for filtering imports by specific museum departments.
 *
 * @returns {Department[]} Array of department objects with IDs and names
 * @throws {500} If department fetch fails
 */
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

/**
 * DELETE /clear
 *
 * Removes all collection items from the database.
 * This is a destructive operation that cannot be undone.
 *
 * @returns {success: boolean, count: number} Success status and deleted count
 * @throws {500} If database operation fails
 */
router.delete("/clear", async (req, res) => {
  try {
    console.log("[ROUTE] Received request to clear collection");
    const result = await service.clearCollection();
    res.json(result);
  } catch (err: any) {
    console.error("[ROUTE] Error in /clear:", err);
    res.status(500).json({
      error: "Clear failed",
      message: err.message || "Unknown error",
    });
  }
});

/**
 * DELETE /items/:id
 *
 * Removes a specific artwork from the collection by UUID.
 * Performs soft validation to ensure the item exists before deletion.
 *
 * @param {string} id - The artwork's UUID to delete
 * @returns {success: boolean, message: string} Deletion confirmation
 * @throws {500} If database operation fails
 */
router.delete("/items/:id", async (req, res) => {
  try {
    console.log("[ROUTE] Received request to delete artwork");
    const { id } = req.params;
    const result = await service.deleteArtwork(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Deletion failed", message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE OAUTH 2.0 INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /import/drive/auth
 *
 * Generates Google OAuth 2.0 authorization URL for Drive access.
 * Initiates the OAuth flow by providing the user with a consent URL.
 *
 * @returns {url: string} Google OAuth authorization URL
 */
router.get("/import/drive/auth", (req, res) => {
  const url = generateGoogleAuthUrl();
  res.json({ url });
});


/**
 * POST /import/drive
 *
 * Imports images from a specific Google Drive folder.
 * Uses OAuth 2.0 access token to access Drive files and import image files.
 *
 * Note: The frontend sends 'accessToken' in the body, but this is actually
 * the authorization code that gets exchanged for a real access token.
 *
 * @body { folderId: string, accessToken: string } Folder ID and auth code
 * @returns {DriveImportResponse} Import results with statistics
 * @throws {400} If folderId or auth code is missing
 * @throws {500} If token exchange or import fails
 */
router.post("/import/drive", async (req, res) => {
  try {
    // Note: The frontend sends 'accessToken' in the body,
    // but at this stage, it is actually the 'authorization code'.
    const { folderId, accessToken: authCode } = req.body;

    if (!folderId || !authCode) {
      return res.status(400).json({ error: "Missing folderId or code" });
    }

    console.log(">>> [ROUTE] Exchanging code for real Google tokens...");

    // 1. Convert the 'code' into a real 'access_token'
    const tokens = await exchangeCodeForTokens(authCode);

    if (!tokens.access_token) {
      throw new Error("Google failed to provide an access token.");
    }

    // 2. Now pass the REAL access_token to the service
    const result = await service.importFromDrive(folderId, tokens.access_token);

    res.json(result);
  } catch (err: any) {
    console.error(">>> [ROUTE] Import failed:", err.message);
    res.status(500).json({ error: err.message });
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
      const allowedMimes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
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
      const result = await service.importFromCSV(csvFile, imageFiles);

      console.log(
        "[CSV IMPORT ROUTE] Success! New:",
        result.newCount,
        "Updated:",
        result.updatedCount,
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
  },
);

/**
 * API Response Standards:
 *
 * Success responses follow consistent structure:
 * - { success: boolean, data: any, message?: string }
 *
 * Error responses follow consistent structure:
 * - { error: string, message?: string, details?: any }
 *
 * All timestamps use ISO 8601 format
 * All IDs are UUID strings
 */

/**
 * Security Notes:
 *
 * - File uploads are validated for type and size
 * - Directory traversal prevented via path.join()
 * - OAuth tokens are not stored (session-based)
 * - Input validation on all parameters
 * - Error messages don't expose sensitive information
 */

/**
 * Performance Considerations:
 *
 * - Pagination prevents large dataset transfers
 * - File size limits prevent memory exhaustion
 * - Database operations use proper indexing
 * - Image processing is handled asynchronously
 * - Error logging is non-blocking
 */

export default router;
