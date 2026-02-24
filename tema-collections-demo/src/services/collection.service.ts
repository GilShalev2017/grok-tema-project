/**
 * Collection Service
 *
 * Core business logic for managing artwork collections.
 * Handles imports from Met Museum, Google Drive, CSV files,
 * AI enrichment, and database operations.
 *
 * Features:
 * - Multi-source import (Met API, Google Drive, CSV)
 * - AI-powered artwork enrichment using OpenAI Vision
 * - Intelligent caching for performance optimization
 * - Bulk operations with proper error handling
 * - Image processing and URL management
 *
 * @author Your Name
 * @version 1.0.0
 * @since 2024-02-23
 */

import axios from "axios";
import OpenAI from "openai";
import NodeCache from "node-cache";
import crypto from "crypto";
import Papa from "papaparse";
import { v4 as uuidv4 } from "uuid";
import prisma from "../lib/prisma";
import * as fs from "fs";
import { getOAuth2Client } from "../lib/google-auth";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ════════════════════════════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Performance optimization through intelligent caching:
 * - Met Cache: 1 hour TTL for museum object data
 * - AI Cache: 24 hours TTL for AI-generated keywords
 * - Reduces API calls and improves response times
 */
const metCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 }); // 1 hour for Met objects
const aiCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 }); // 24 hours for AI results

/**
 * OpenAI client configuration for AI enrichment
 * Uses GPT-4 Vision model for artwork analysis
 */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("[SERVICE] CollectionService initialized successfully");

/**
 * CSV row interface for type-safe parsing
 * Supports comprehensive artwork metadata fields
 */
interface CSVRow {
  id?: string;
  title?: string;
  artist?: string;
  year?: string;
  imageUrl?: string;
  description?: string;
  department?: string;
  culture?: string;
  classification?: string;
  medium?: string;
  dimensions?: string;
  credit?: string;
  tags?: string;
}

export class CollectionService {
  // ════════════════════════════════════════════════════════════════════════════
  // MET MUSEUM API IMPORT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Imports artworks from the Metropolitan Museum of Art API
   *
   * Features:
   * - Parallel API calls for performance
   * - Intelligent filtering (public domain, images only)
   * - Caching to reduce API load
   * - Bulk database operations
   * - Comprehensive error handling
   *
   * @param searchTerm - Free text search query (default: "*")
   * @param departmentIds - Array of department IDs for filtering
   * @returns Import results with statistics and items
   * @throws {Error} If API calls fail or database operations error
   */
  async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
    const normalizedSearchTerm = searchTerm.trim() || "*";

    console.log(
      `\n[IMPORT] Initializing search for: "${normalizedSearchTerm}"`,
    );
    console.log(
      `[IMPORT] Target Departments: ${departmentIds.length > 0 ? departmentIds.join(", ") : "All"}`,
    );

    let countSkippedCopyright = 0;
    let countSkippedNoImage = 0;
    let countFetchFailed = 0;

    try {
      const searchTasks =
        departmentIds.length > 0
          ? departmentIds.map((id) =>
              axios.get(
                "https://collectionapi.metmuseum.org/public/collection/v1/search",
                {
                  params: {
                    q: normalizedSearchTerm,
                    hasImages: true,
                    departmentId: id,
                  },
                  timeout: 15000,
                },
              ),
            )
          : [
              axios.get(
                "https://collectionapi.metmuseum.org/public/collection/v1/search",
                {
                  params: { q: normalizedSearchTerm, hasImages: true },
                  timeout: 15000,
                },
              ),
            ];

      const searchResponses = await Promise.all(searchTasks);
      const uniqueObjectIDs = [
        ...new Set(searchResponses.flatMap((res) => res.data.objectIDs ?? [])),
      ];

      // --- DEBUG LOGS ---
      console.log(
        `[IMPORT] API found ${uniqueObjectIDs.length} total results for "${normalizedSearchTerm}"`,
      );

      const limitedIds = uniqueObjectIDs.slice(0, 80);
      console.log(`[IMPORT] Processing top ${limitedIds.length} items...`);

      if (limitedIds.length === 0) {
        return {
          stats: { new: 0, updated: 0, removed: 0, skipped: 0 },
          message: "No items matched your search criteria.",
        };
      }

      const fetchPromises = limitedIds.map(async (id) => {
        const cacheKey = `met-object-${id}`;
        let data = metCache.get<any>(cacheKey);

        if (!data) {
          try {
            const objRes = await axios.get(
              `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
              { timeout: 10000 },
            );
            data = objRes.data;
            metCache.set(cacheKey, data);
          } catch (err) {
            countFetchFailed++;
            return null;
          }
        }

        if (!data.isPublicDomain) {
          countSkippedCopyright++;
          return null;
        }
        const primaryImg = data.primaryImage || data.primaryImageSmall;
        if (!primaryImg) {
          countSkippedNoImage++;
          return null;
        }

        return {
          externalId: String(data.objectID),
          title: data.title || "Untitled",
          artist: data.artistDisplayName || "Unknown Artist",
          year:
            data.objectBeginDate ||
            (data.objectDate ? parseInt(data.objectDate, 10) : null),
          description: data.medium || data.culture || null,
          imageUrl: primaryImg,
          additionalImages: data.additionalImages?.join(",") || null,
          metadata: JSON.stringify(data),
          museumId: "met",
        };
      });

      const itemsToUpsert = (await Promise.all(fetchPromises)).filter(
        (item): item is NonNullable<typeof item> => item !== null,
      );

      let importedCount = 0;
      let updatedCount = 0;

      const savedItems = await Promise.all(
        itemsToUpsert.map(async (item) => {
          try {
            const result = await prisma.collectionItem.upsert({
              where: { externalId: item.externalId },
              update: { ...item, updatedAt: new Date() },
              create: item,
            });

            if (result.createdAt.getTime() === result.updatedAt.getTime())
              importedCount++;
            else updatedCount++;

            return result;
          } catch (err) {
            return null;
          }
        }),
      );

      // --- FINAL DEBUG LOG ---
      console.log(
        `[IMPORT] Completed. New: ${importedCount}, Updated: ${updatedCount}, Skipped: ${countSkippedCopyright + countSkippedNoImage + countFetchFailed}\n`,
      );

      return {
        items: savedItems.filter((i) => i !== null),
        stats: {
          new: importedCount,
          updated: updatedCount,
          removed: 0,
          skipped:
            countSkippedCopyright + countSkippedNoImage + countFetchFailed,
        },
        message: `Successfully processed ${limitedIds.length} items from The Met.`,
      };
    } catch (err: any) {
      console.error("[IMPORT] Critical Error:", err.message);
      throw new Error(err.message);
    }
  }
  // ════════════════════════════════════════════════════════════════════════════
  // AI ENRICHMENT WITH VISION ANALYSIS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Enriches artwork metadata using AI-powered visual analysis
   *
   * Process:
   * 1. Generate MD5 hash of image URL for cache key
   * 2. Check cache for existing keywords
   * 3. If cached, return existing data
   * 4. If not cached, analyze with OpenAI GPT-4 Vision
   * 5. Extract 8-12 specific, descriptive keywords
   * 6. Cache results for 24 hours
   *
   * @param itemId - UUID of the artwork to enrich
   * @returns Updated artwork with AI-generated keywords
   * @throws {Error} If artwork not found or AI service fails
   */
  async enrichWithAI(itemId: string) {
    console.log(`[ENRICH] Enriching item ${itemId}`);

    const item = await prisma.collectionItem.findUnique({
      where: { id: itemId },
    });
    if (!item || !item.imageUrl) {
      console.log(`[ENRICH] Item ${itemId} not found or no image URL`);
      return item;
    }

    // Cache key based on image URL (stable across runs)
    const imageHash = crypto
      .createHash("md5")
      .update(item.imageUrl)
      .digest("hex");
    const aiCacheKey = `ai-${imageHash}`;

    // Check cache
    let keywordsStr = aiCache.get<string>(aiCacheKey);
    if (keywordsStr) {
      console.log(`[AI] Cache hit for ${item.title}`);
      return prisma.collectionItem.update({
        where: { id: itemId },
        data: { aiKeywords: keywordsStr },
      });
    }

    // No cache → call OpenAI
    let keywords: string[] = [];

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert art historian. Analyze the artwork titled "${item.title || "Untitled"}" by ${item.artist || "unknown"}.
                Return **exactly 8-12 unique, specific, descriptive keywords** (no generics like "art" or "painting").
                Focus on: visual elements, colors, style period, composition, mood, subjects, technique.
                **IMPORTANT: Return ONLY a raw JSON array with no markdown formatting, no code blocks, no explanations.**
                Example format: ["sepia photograph", "formal attire", "mustache", "railway station", "19th century portrait"]`,
              },
              {
                type: "image_url",
                image_url: { url: item.imageUrl },
              },
            ],
          },
        ],
        max_tokens: 220,
        temperature: 0.35,
      });

      let content = response.choices[0]?.message?.content ?? "[]";

      // Strip markdown code blocks if present
      content = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      console.log(`[AI] Raw response for ${item.title}:`, content);

      keywords = JSON.parse(content);
      if (!Array.isArray(keywords)) keywords = [];
      keywords = [...new Set(keywords)]; // dedupe
    } catch (err: any) {
      console.error(`[AI] Failed for ${item.title}:`, err.message);
      keywords = ["historical", "portrait", "sepia", "formal"];
    }

    keywordsStr = keywords.join(",");

    // Cache it
    aiCache.set(aiCacheKey, keywordsStr);

    return prisma.collectionItem.update({
      where: { id: itemId },
      data: { aiKeywords: keywordsStr },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DATABASE OPERATIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Retrieves paginated collection items with formatted data
   *
   * Features:
   * - Efficient pagination with metadata
   * - Data transformation for frontend compatibility
   * - Proper sorting by creation date
   * - Array parsing for stored CSV data
   *
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 100)
   * @returns Paginated items with metadata
   */
  async getAllItems(page: number = 1, limit: number = 100) {
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const totalCount = await prisma.collectionItem.count();

    // Get items for current page
    const items = await prisma.collectionItem.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    const formattedItems = items.map((item: any) => ({
      ...item,
      additionalImages: item.additionalImages
        ? item.additionalImages.split(",")
        : [],
      metadata: item.metadata ? JSON.parse(item.metadata) : null,
      aiKeywords: item.aiKeywords ? item.aiKeywords.split(",") : [],
    }));

    return {
      items: formattedItems,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Retrieves Met Museum departments with caching
   *
   * Caching strategy:
   * - Cache departments for 1 hour
   * - Reduces API calls for frequently accessed data
   * - Graceful fallback on API failures
   *
   * @returns Array of department objects
   */
  async getDepartments() {
    const cacheKey = "met-departments";

    const cached = metCache.get(cacheKey);
    if (cached) {
      console.log("[DEPARTMENTS] Cache hit");
      return cached;
    }

    try {
      const response = await axios.get(
        "https://collectionapi.metmuseum.org/public/collection/v1/departments",
        { timeout: 8000 },
      );

      const departments = response.data.departments || [];
      metCache.set(cacheKey, departments);

      console.log(`[DEPARTMENTS] Fetched ${departments.length} departments`);
      return departments;
    } catch (err: any) {
      console.error("[DEPARTMENTS SERVICE] Error:", err.message);
      // Return empty array instead of crashing
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CSV IMPORT OPERATIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Advanced CSV import with upsert capability and image handling
   *
   * Features:
   * - Smart upsert (update existing, create new)
   * - Intelligent image URL resolution
   * - Support for both online URLs and uploaded files
   * - Comprehensive data validation and cleaning
   * - Automatic file cleanup after processing
   * - Detailed logging and error handling
   *
   * Image URL Resolution:
   * 1. If URL starts with "http" → use as-is
   * 2. If filename → match with uploaded files
   * 3. If no match found → set to null
   *
   * @param csvFile - CSV file with artwork metadata
   * @param imageFiles - Optional uploaded image files
   * @returns Import results with statistics
   */
  async importFromCSV(
    csvFile: Express.Multer.File,
    imageFiles?: Express.Multer.File[],
  ): Promise<{ items: any[]; newCount: number; updatedCount: number }> {
    console.log("[CSV IMPORT] Starting import...");
    console.log("[CSV IMPORT] CSV file path:", csvFile.path); // ← Now has path, not buffer
    console.log("[CSV IMPORT] Images provided:", imageFiles?.length || 0);

    try {
      // ════════════════════════════════════════════════════════════════════
      // READ CSV FILE FROM DISK (not from buffer)
      // ════════════════════════════════════════════════════════════════════
      const csvText = fs.readFileSync(csvFile.path, "utf-8"); // ← CHANGED!
      console.log("[CSV IMPORT] CSV size:", csvText.length, "characters");

      // ════════════════════════════════════════════════════════════════════
      // Create image filename → URL mapping
      // ════════════════════════════════════════════════════════════════════
      const imageUrlMap = new Map<string, string>();

      if (imageFiles && imageFiles.length > 0) {
        imageFiles.forEach((file) => {
          // Images are saved to /uploads/artworks/
          const publicUrl = `/uploads/artworks/${file.filename}`;
          imageUrlMap.set(file.originalname, publicUrl);
          console.log(
            "[CSV IMPORT] Mapped image:",
            file.originalname,
            "→",
            publicUrl,
          );
        });
      }

      return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
          complete: async (results) => {
            try {
              console.log("[CSV IMPORT] Parsed rows:", results.data.length);

              let newCount = 0;
              let updatedCount = 0;
              const processedItems: any[] = [];

              for (const row of results.data as CSVRow[]) {
                const externalId = row.id?.trim() || uuidv4();
                const title = row.title?.trim() || "Untitled";
                const artist = row.artist?.trim() || null;
                const year = row.year ? parseInt(row.year) : null;
                const description = row.description?.trim() || null;
                const department = row.department?.trim() || null;
                const culture = row.culture?.trim() || null;
                const classification =
                  row.classification?.trim() || department || "General";
                const medium = row.medium?.trim() || description || "Unknown";
                const dimensions = row.dimensions?.trim() || "Unknown";
                const credit = row.credit?.trim() || "Custom CSV Import";

                // Parse tags
                const tagsList = row.tags
                  ? row.tags
                      .split(/[,;]/)
                      .map((t: string) => t.trim())
                      .filter(Boolean)
                  : [];

                // ══════════════════════════════════════════════════════════
                // SMART IMAGE URL HANDLING
                // ══════════════════════════════════════════════════════════
                let finalImageUrl = row.imageUrl?.trim() || null;

                if (finalImageUrl) {
                  if (finalImageUrl.startsWith("http")) {
                    // Online URL - use as-is
                    console.log("[CSV IMPORT] Using online URL for:", title);
                  } else {
                    // Local filename - find uploaded image
                    const uploadedImageUrl = imageUrlMap.get(finalImageUrl);

                    if (uploadedImageUrl) {
                      finalImageUrl = uploadedImageUrl;
                      console.log(
                        "[CSV IMPORT] Using uploaded image for:",
                        title,
                        "→",
                        finalImageUrl,
                      );
                    } else {
                      console.warn(
                        "[CSV IMPORT] Image not found for:",
                        title,
                        "- expected:",
                        finalImageUrl,
                      );
                      finalImageUrl = null;
                    }
                  }
                }

                // Create metadata
                const metadata = {
                  objectID: parseInt(externalId.replace(/\D/g, "")) || 0,
                  department: department || "Unknown",
                  title: title,
                  culture: culture || "Unknown",
                  medium: medium,
                  classification: classification,
                  artistDisplayName: artist || "Unknown Artist",
                  artistDisplayBio: artist
                    ? `${artist} (${culture || "Unknown"})`
                    : "",
                  artistNationality: culture || "Unknown",
                  objectDate: year ? year.toString() : "Unknown",
                  objectBeginDate: year || 0,
                  objectEndDate: year || 0,
                  period: year && year < 1900 ? "Historical" : "Modern",
                  dimensions: dimensions,
                  creditLine: credit,
                  objectURL: finalImageUrl || "",
                  primaryImage: finalImageUrl || "",
                  additionalImages: [],
                  isPublicDomain: true,
                  tags: tagsList.map((tag: string) => ({
                    term: tag,
                    AAT_URL: "",
                    Wikidata_URL: "",
                  })),
                  importSource: "csv",
                  importDate: new Date().toISOString(),
                };

                // Check if exists
                const existing = await prisma.collectionItem.findUnique({
                  where: { externalId },
                });

                if (existing) {
                  // UPDATE
                  console.log(
                    "[CSV IMPORT] Updating existing item:",
                    externalId,
                  );

                  const updated = await prisma.collectionItem.update({
                    where: { externalId },
                    data: {
                      title,
                      artist,
                      year,
                      imageUrl: finalImageUrl,
                      description,
                      metadata: JSON.stringify(metadata),
                      updatedAt: new Date(),
                    },
                  });

                  processedItems.push(updated);
                  updatedCount++;
                } else {
                  // INSERT
                  console.log("[CSV IMPORT] Creating new item:", externalId);

                  const created = await prisma.collectionItem.create({
                    data: {
                      id: uuidv4(),
                      museumId: "custom",
                      externalId,
                      title,
                      artist,
                      year,
                      imageUrl: finalImageUrl,
                      description,
                      aiKeywords: tagsList.join(", "),
                      additionalImages: null,
                      metadata: JSON.stringify(metadata),
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  });

                  processedItems.push(created);
                  newCount++;
                }
              }

              console.log(
                "[CSV IMPORT] Success! New:",
                newCount,
                "Updated:",
                updatedCount,
              );

              // ════════════════════════════════════════════════════════════
              // CLEANUP: Delete uploaded CSV file after processing
              // ════════════════════════════════════════════════════════════
              try {
                fs.unlinkSync(csvFile.path);
                console.log("[CSV IMPORT] Cleaned up CSV file");
              } catch (err) {
                console.warn("[CSV IMPORT] Could not delete CSV:", err);
              }

              resolve({
                items: processedItems,
                newCount,
                updatedCount,
              });
            } catch (error) {
              console.error("[CSV IMPORT] Error processing CSV:", error);
              reject(error);
            }
          },
          error: (error: { message: any }) => {
            console.error("[CSV IMPORT] Papa parse error:", error);
            reject(new Error(`CSV parsing failed: ${error.message}`));
          },
        });
      });
    } catch (error) {
      console.error("[CSV IMPORT] Top-level error:", error);
      throw error;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GOOGLE DRIVE INTEGRATION
  // ════════════════════════════════════════════════════════════════════════════

  async downloadDriveImageToLocal(
    drive: any,
    fileId: string,
    filename: string,
  ): Promise<string> {
    try {
      const uploadDir = path.join(__dirname, "../../uploads/artworks");

      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, filename);
      const dest = fs.createWriteStream(filePath);

      // Download raw binary from Google Drive API
      const response = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" },
      );

      await new Promise<void>((resolve, reject) => {
        response.data.on("end", resolve).on("error", reject).pipe(dest);
      });

      const publicUrl = `/uploads/artworks/${filename}`;
      return publicUrl;
    } catch (err) {
      console.error(
        "[DRIVE-DOWNLOAD ERROR] Failed to download Drive image:",
        fileId,
        err,
      );
      return "";
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // COLLECTION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Imports image files from Google Drive folder
   *
   * Process:
   * 1. Validate folder ID and access token
   * 2. Authenticate with Google Drive API
   * 3. List all files in specified folder
   * 4. Filter for image files only
   * 5. Generate high-quality preview URLs
   * 6. Create database records
   *
   * Image URL Strategy:
   * - Uses Google's high-resolution preview URLs
   * - Format: https://lh3.googleusercontent.com/d/{fileId}=w1000
   * - Ensures consistent, reliable image access
   *
   * @param folderId - Google Drive folder ID
   * @param accessToken - OAuth 2.0 access token
   * @returns Import results with statistics
   * @throws {Error} For invalid folder ID, auth failures, or API errors
   */
  async importFromDrive(folderId: string, accessToken: string) {
    if (!folderId || folderId === "undefined" || folderId === "null") {
      throw new Error("Invalid Folder ID received by backend.");
    }

    console.log(">>> [DRIVE SERVICE] Initializing with Folder ID:", folderId);

    const auth = getOAuth2Client();
    auth.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: "v3", auth });

    try {
      const response = await drive.files.list({
        q: `'${folderId}' in parents AND trashed = false`,
        fields: "files(id, name, mimeType)",
      });

      const files = response.data.files || [];
      console.log(
        `>>> [DRIVE SERVICE] Found ${files.length} files in Google Drive.`,
      );

      const results = [];
      let newCount = 0;
      let updatedCount = 0;

      for (const file of files) {
        if (!file.mimeType?.startsWith("image/")) continue;

        // Use Drive API to get image bytes
        const safeFilename = file.name
          ? file.name.replace(/\s+/g, "_")
          : `${file.id}.jpg`;

        const localImageUrl = await this.downloadDriveImageToLocal(
          drive,
          file.id!,
          safeFilename,
        );

        if (!localImageUrl) {
          console.warn(`[DRIVE IMPORT] Failed to download: ${file.name}`);
          continue;
        }

        // Save item using the LOCAL URL
        const newItem = await prisma.collectionItem.upsert({
          where: { externalId: file.id! },
          update: {
            title: file.name || "Untitled",
            imageUrl: localImageUrl,
            updatedAt: new Date(),
          },
          create: {
            externalId: file.id!,
            title: file.name || "Untitled",
            imageUrl: localImageUrl,
          },
        });

        if (newItem.createdAt.getTime() === newItem.updatedAt.getTime()) {
          newCount++;
        } else {
          updatedCount++;
        }

        results.push(newItem);
      }

      return {
        success: true,
        items: results,
        stats: { new: newCount, updated: updatedCount },
      };
    } catch (error: any) {
      console.error(">>> [DRIVE SERVICE] API ERROR:", error.message);

      if (error.code === 404) {
        throw new Error(`Folder ID '${folderId}' was not found.`);
      }

      if (error.code === 401 || error.code === 403) {
        throw new Error("Google Authentication expired. Please reconnect.");
      }

      throw error;
    }
  }

  /**
   * Clears entire collection (destructive operation)
   *
   * @warning This operation cannot be undone
   * @returns Deletion statistics
   * @throws {Error} If database operation fails
   */
  async clearCollection() {
    try {
      const result = await prisma.collectionItem.deleteMany({});
      console.log(`[SERVICE] Deleted ${result.count} items from collection.`);
      return {
        success: true,
        count: result.count,
        message: "Collection cleared successfully.",
      };
    } catch (error: any) {
      console.error("[SERVICE] Error clearing collection:", error);
      throw new Error("Failed to clear collection: " + error.message);
    }
  }

  /**
   * Deletes specific artwork by UUID
   *
   * @param id - Artwork UUID to delete
   * @returns Deletion confirmation
   * @throws {Error} If artwork not found or deletion fails
   */
  async deleteArtwork(id: string) {
    try {
      await prisma.collectionItem.delete({
        where: { id },
      });
      return { success: true, message: "Artwork deleted successfully" };
    } catch (error: any) {
      console.error(`[SERVICE] Error deleting artwork ${id}:`, error);
      throw new Error("Failed to delete artwork");
    }
  }
}
