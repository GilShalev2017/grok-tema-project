import { PrismaClient } from "@prisma/client";
import axios from "axios";
import OpenAI from "openai";
import NodeCache from "node-cache";
import crypto from "crypto";
import { Express } from "express";
import Papa from "papaparse";
import { v4 as uuidv4 } from "uuid";
// Singleton Prisma
import prisma from "../lib/prisma";
import * as fs from "fs";

// Caches
const metCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 }); // 1 hour for Met objects
const aiCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 }); // 24 hours for AI results

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("[SERVICE] File loaded successfully");

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
  async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
    const normalizedSearchTerm = searchTerm.trim() || "*";

    // --- DEBUG LOGS ---
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
  // ==================== AI ENRICHMENT (with cache per image) ====================
  async enrichWithAI(itemId: string) {
    console.log(`[ENRICH] Enriching item ${itemId}`);

    const item = await prisma.collectionItem.findUnique({
      where: { id: itemId },
      //where: { id: 'accd6378-7883-4fc9-bfbb-d479c232924e' },
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

  // ==================== GET ALL ITEMS (with pagination) ====================
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

  // ==================== CSV IMPORT ====================
  /**
   * Import artworks from CSV file
   * @param csvFile - Multer file object containing CSV data
   * @param imageFiles - Optional array of uploaded image files (not used yet)
   */
  async importFromCSV(
    csvFile: Express.Multer.File,
    imageFiles?: Express.Multer.File[],
  ): Promise<any[]> {
    console.log("[CSV IMPORT] Starting import...");
    console.log("[CSV IMPORT] File size:", csvFile.size, "bytes");

    try {
      // Step 1: Convert buffer to string
      const csvText = fs.readFileSync(csvFile.path, "utf-8");
      console.log("[CSV IMPORT] CSV text preview:", csvText.substring(0, 200));

      // Step 2: Parse CSV using papaparse
      return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
          header: true, // First row is headers
          skipEmptyLines: true, // Ignore empty rows
          transformHeader: (header) => header.trim(), // Clean headers
          complete: async (results) => {
            try {
              console.log("[CSV IMPORT] Parsed rows:", results.data.length);
              console.log("[CSV IMPORT] First row sample:", results.data[0]);

              // Step 3: Transform CSV rows to database format
              const items = (results.data as any[]).map((row: any) => {
                // Clean and validate data
                const id = uuidv4();
                const externalId = row.id?.trim() || id;
                const title = row.title?.trim() || "Untitled";
                const artist = row.artist?.trim() || null;
                const year = row.year ? parseInt(row.year) : null;
                const imageUrl = row.imageUrl?.trim() || null;
                const description = row.description?.trim() || null;
                const department = row.department?.trim() || "Unknown";
                const culture = row.culture?.trim() || null;

                // Parse tags (comma-separated string to array)
                const tags = row.tags
                  ? row.tags
                      .split(",")
                      .map((t: string) => t.trim())
                      .filter(Boolean)
                  : [];

                console.log("[CSV IMPORT] Processing item:", {
                  id: externalId,
                  title,
                  artist,
                });

                return {
                  id,
                  museumId: "custom",
                  externalId,
                  title,
                  artist,
                  year,
                  imageUrl,
                  description,
                  aiKeywords: tags.join(", "), // Convert array to comma-separated string
                  additionalImages: "", // Empty string instead of array
                  metadata: JSON.stringify({}), // Convert object to JSON string
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
              });

              console.log("[CSV IMPORT] Transformed items:", items.length);
              console.log("[CSV IMPORT] Sample item:", items[0]);

              // Step 4: Save to database
              // IMPORTANT: Use createMany for bulk insert
              const result = await prisma.collectionItem.createMany({
                data: items,
              });

              console.log("[CSV IMPORT] Saved to DB:", result.count, "items");

              // Step 5: Return the items for the response
              // Note: createMany doesn't return the created items, so we fetch them
              const savedItems = await prisma.collectionItem.findMany({
                where: {
                  externalId: {
                    in: items.map((i) => i.externalId),
                  },
                },
                orderBy: {
                  createdAt: "desc",
                },
              });

              console.log(
                "[CSV IMPORT] Success! Retrieved:",
                savedItems.length,
                "items",
              );
              resolve(savedItems);
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

  async importFromCSVUpsert(
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
}
