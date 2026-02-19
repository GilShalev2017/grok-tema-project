import { PrismaClient } from "@prisma/client";
import axios from "axios";
import OpenAI from "openai";
import NodeCache from "node-cache";
import crypto from "crypto";
import { Express } from "express";
import Papa from "papaparse";

// Singleton Prisma
import prisma from "../lib/prisma";

// Caches
const metCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 }); // 1 hour for Met objects
const aiCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 }); // 24 hours for AI results

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("[SERVICE] File loaded successfully");

// Helper function to parse CSV data
function parseCSV(csvText: string): any[] {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim()
  });
  
  if (result.errors.length > 0) {
    console.error("[CSV PARSE] Errors:", result.errors);
    throw new Error(`CSV parsing failed: ${result.errors.map(e => e.message).join(', ')}`);
  }
  
  return result.data;
}

export class CollectionService {
  // ==================== MET IMPORT (with image filter + cache) ====================
  // async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
  //   const params: any = {
  //     hasImages: true,
  //     q: searchTerm.trim() || "*",
  //   };

  //   // Add departments only if provided
  //   if (departmentIds.length > 0) {
  //     params.departmentId = departmentIds.join("|");
  //   }

  //   try {
  //     const searchRes = await axios.get(
  //       "https://collectionapi.metmuseum.org/public/collection/v1/search",
  //       { params, timeout: 15000 },
  //     );

  //     const objectIDs = searchRes.data.objectIDs ?? [];
  //     console.log(
  //       `[IMPORT] Met returned ${objectIDs.length} items for q="${params.q}"` +
  //         (departmentIds.length ? `, departments=${params.departmentId}` : ""),
  //     );

  //     if (objectIDs.length === 0) {
  //       return { imported: 0, message: "No items found for this search" };
  //     }

  //     const items: any[] = [];
  //     const limitedIds = objectIDs.slice(0, 80); // adjustable limit

  //     let dbgItemsWithoutImageCounter = 0;

  //     for (const id of limitedIds) {
  //       const cacheKey = `met-object-${id}`;
  //       let data = metCache.get<any>(cacheKey);

  //       if (!data) {
  //         try {
  //           const objRes = await axios.get(
  //             `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
  //             { timeout: 10000 },
  //           );
  //           data = objRes.data;
  //           metCache.set(cacheKey, data);
  //         } catch (err) {
  //           console.warn(`[IMPORT] Failed to fetch object ${id}`);
  //           continue;
  //         }
  //       }

  //       // Strict image filter
  //       const primaryImg = data.primaryImage || data.primaryImageSmall;

  //       if (!primaryImg) {
  //         dbgItemsWithoutImageCounter++;
  //         continue;
  //       }

  //       items.push({
  //         externalId: String(data.objectID),
  //         title: data.title || "Untitled",
  //         artist: data.artistDisplayName || null,
  //         year: data.objectDate ? parseInt(data.objectDate, 10) : null,
  //         description: data.medium || data.culture || null,
  //         imageUrl: primaryImg,
  //         additionalImages: data.additionalImages?.join(",") || null,
  //         metadata: data ? JSON.stringify(data) : null,
  //         aiKeywords: null,
  //         museumId: "met",
  //       });
  //     }

  //     console.log(`found ${dbgItemsWithoutImageCounter} items without image!`);

  //     let importedCount = 0;
  //     let updatedCount = 0;

  //     if (items.length > 0) {
  //       // Process items individually with upsert to handle duplicates
  //       for (const item of items) {
  //         try {
  //           const result = await prisma.collectionItem.upsert({
  //             where: {
  //               externalId: item.externalId,
  //             },
  //             update: {
  //               title: item.title,
  //               artist: item.artist,
  //               year: item.year,
  //               description: item.description,
  //               imageUrl: item.imageUrl,
  //               additionalImages: item.additionalImages,
  //               metadata: item.metadata,
  //               updatedAt: new Date(),
  //             },
  //             create: item,
  //           });

  //           if (
  //             result.createdAt.toISOString() === result.updatedAt.toISOString()
  //           ) {
  //             importedCount++;
  //           } else {
  //             updatedCount++;
  //           }
  //         } catch (err) {
  //           console.warn(
  //             `[IMPORT] Failed to upsert item ${item.externalId}:`,
  //             err,
  //           );
  //         }
  //       }

  //       console.log(
  //         `[IMPORT] Saved ${importedCount} new items, updated ${updatedCount} existing items`,
  //       );
  //     }

  //     return {
  //       imported: importedCount,
  //       updated: updatedCount,
  //       totalProcessed: limitedIds.length,
  //       totalFound: objectIDs.length,
  //       searchTerm: params.q,
  //       departments: departmentIds.length ? departmentIds : null,
  //     };
  //   } catch (err: any) {
  //     console.error("[IMPORT] Critical error:", err.message);
  //     throw err;
  //   }
  // }

  //Gemini 1
  // async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
  //   const normalizedSearchTerm = searchTerm.trim() || "*";

  //   try {
  //     // 1. FETCH SEARCH IDs (Handle multiple departments)
  //     // The Met API /search endpoint only supports ONE departmentId per call.
  //     // We run searches in parallel for each department provided.
  //     const searchTasks =
  //       departmentIds.length > 0
  //         ? departmentIds.map((id) =>
  //             axios.get(
  //               "https://collectionapi.metmuseum.org/public/collection/v1/search",
  //               {
  //                 params: {
  //                   q: normalizedSearchTerm,
  //                   hasImages: true,
  //                   departmentId: id,
  //                 },
  //                 timeout: 15000,
  //               },
  //             ),
  //           )
  //         : [
  //             axios.get(
  //               "https://collectionapi.metmuseum.org/public/collection/v1/search",
  //               {
  //                 params: { q: normalizedSearchTerm, hasImages: true },
  //                 timeout: 15000,
  //               },
  //             ),
  //           ];

  //     const searchResponses = await Promise.all(searchTasks);

  //     // Merge all objectIDs and remove duplicates using a Set
  //     const allObjectIDs = searchResponses.flatMap(
  //       (res) => res.data.objectIDs ?? [],
  //     );
  //     const uniqueObjectIDs = [...new Set(allObjectIDs)];

  //     const limitedIds = uniqueObjectIDs.slice(0, 80); // API limit is ~80 requests per second

  //     console.log(
  //       `[IMPORT] Met found ${uniqueObjectIDs.length} unique items. Processing first ${limitedIds.length}...`,
  //     );

  //     if (limitedIds.length === 0) {
  //       return { imported: 0, message: "No items found for this search" };
  //     }

  //     // 2. FETCH OBJECT DETAILS IN PARALLEL
  //     // This is significantly faster than a sequential for-loop.
  //     const fetchPromises = limitedIds.map(async (id) => {
  //       const cacheKey = `met-object-${id}`;
  //       let data = metCache.get<any>(cacheKey);

  //       if (!data) {
  //         try {
  //           const objRes = await axios.get(
  //             `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
  //             { timeout: 10000 },
  //           );
  //           data = objRes.data;
  //           metCache.set(cacheKey, data);
  //         } catch (err) {
  //           console.warn(`[IMPORT] Failed to fetch details for object ${id}`);
  //           return null;
  //         }
  //       }

  //       // Filter: Ensure we have a primary image
  //       const primaryImg = data.primaryImage || data.primaryImageSmall;
  //       if (!primaryImg) return null;

  //       // Map to your internal schema
  //       return {
  //         externalId: String(data.objectID),
  //         title: data.title || "Untitled",
  //         artist: data.artistDisplayName || "Unknown Artist",
  //         // Using objectBeginDate is more reliable for a 'year' integer than parsing a string
  //         year:
  //           data.objectBeginDate ||
  //           (data.objectDate ? parseInt(data.objectDate, 10) : null),
  //         description: data.medium || data.culture || null,
  //         imageUrl: primaryImg,
  //         additionalImages: data.additionalImages?.join(",") || null,
  //         metadata: data ? JSON.stringify(data) : null,
  //         aiKeywords: null,
  //         museumId: "met",
  //       };
  //     });

  //     // Wait for all HTTP requests to finish and filter out nulls (failed or no-image items)
  //     const itemsToUpsert = (await Promise.all(fetchPromises)).filter(
  //       (item): item is NonNullable<typeof item> => item !== null,
  //     );

  //     // 3. DATABASE UPSERT (Handle duplicates and updates)
  //     let importedCount = 0;
  //     let updatedCount = 0;

  //     const dbOperations = itemsToUpsert.map(async (item) => {
  //       try {
  //         const result = await prisma.collectionItem.upsert({
  //           where: { externalId: item.externalId },
  //           update: {
  //             title: item.title,
  //             artist: item.artist,
  //             year: item.year,
  //             description: item.description,
  //             imageUrl: item.imageUrl,
  //             additionalImages: item.additionalImages,
  //             metadata: item.metadata,
  //             updatedAt: new Date(),
  //           },
  //           create: item,
  //         });

  //         // Check if this was a create or an update
  //         if (result.createdAt.getTime() === result.updatedAt.getTime()) {
  //           importedCount++;
  //         } else {
  //           updatedCount++;
  //         }
  //       } catch (err) {
  //         console.warn(`[IMPORT] Database error for item ${item.externalId}`);
  //       }
  //     });

  //     await Promise.all(dbOperations);

  //     console.log(
  //       `[IMPORT] Success: ${importedCount} imported, ${updatedCount} updated.`,
  //     );

  //     return {
  //       imported: importedCount,
  //       updated: updatedCount,
  //       totalProcessed: limitedIds.length,
  //       totalFound: uniqueObjectIDs.length,
  //       searchTerm: normalizedSearchTerm,
  //       departments: departmentIds,
  //     };
  //   } catch (err: any) {
  //     console.error("[IMPORT] Critical error during Met import:", err.message);
  //     throw err;
  //   }
  // }

  //Gemini 2.5 Flash
  // async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
  //   const normalizedSearchTerm = searchTerm.trim() || "*";

  //   let countSkippedCopyright = 0;
  //   let countSkippedNoImage = 0;
  //   let countFetchFailed = 0;

  //   try {
  //     // 1. Fetch IDs based on Search + Department (AND logic)
  //     const searchTasks =
  //       departmentIds.length > 0
  //         ? departmentIds.map((id) =>
  //             axios.get(
  //               "https://collectionapi.metmuseum.org/public/collection/v1/search",
  //               {
  //                 params: {
  //                   q: normalizedSearchTerm,
  //                   hasImages: true,
  //                   departmentId: id,
  //                 },
  //                 timeout: 15000,
  //               },
  //             ),
  //           )
  //         : [
  //             axios.get(
  //               "https://collectionapi.metmuseum.org/public/collection/v1/search",
  //               {
  //                 params: { q: normalizedSearchTerm, hasImages: true },
  //                 timeout: 15000,
  //               },
  //             ),
  //           ];

  //     const searchResponses = await Promise.all(searchTasks);
  //     const uniqueObjectIDs = [
  //       ...new Set(searchResponses.flatMap((res) => res.data.objectIDs ?? [])),
  //     ];
  //     const limitedIds = uniqueObjectIDs.slice(0, 80);

  //     if (limitedIds.length === 0) {
  //       return {
  //         stats: { new: 0, updated: 0, removed: 0, skipped: 0 },
  //         message: "No items matched your search criteria.",
  //       };
  //     }

  //     // 2. Fetch and Map Details
  //     const fetchPromises = limitedIds.map(async (id) => {
  //       const cacheKey = `met-object-${id}`;
  //       let data = metCache.get<any>(cacheKey);

  //       if (!data) {
  //         try {
  //           const objRes = await axios.get(
  //             `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
  //             { timeout: 10000 },
  //           );
  //           data = objRes.data;
  //           metCache.set(cacheKey, data);
  //         } catch (err) {
  //           countFetchFailed++;
  //           return null;
  //         }
  //       }

  //       if (!data.isPublicDomain) {
  //         countSkippedCopyright++;
  //         return null;
  //       }
  //       const primaryImg = data.primaryImage || data.primaryImageSmall;
  //       if (!primaryImg) {
  //         countSkippedNoImage++;
  //         return null;
  //       }

  //       return {
  //         externalId: String(data.objectID),
  //         title: data.title || "Untitled",
  //         artist: data.artistDisplayName || "Unknown Artist",
  //         year:
  //           data.objectBeginDate ||
  //           (data.objectDate ? parseInt(data.objectDate, 10) : null),
  //         description: data.medium || data.culture || null,
  //         imageUrl: primaryImg,
  //         additionalImages: data.additionalImages?.join(",") || null,
  //         metadata: JSON.stringify(data),
  //         museumId: "met",
  //       };
  //     });

  //     const itemsToUpsert = (await Promise.all(fetchPromises)).filter(
  //       (item): item is NonNullable<typeof item> => item !== null,
  //     );

  //     // 3. Database Upsert
  //     let importedCount = 0;
  //     let updatedCount = 0;

  //     const savedItems = await Promise.all(
  //       itemsToUpsert.map(async (item) => {
  //         try {
  //           const result = await prisma.collectionItem.upsert({
  //             where: { externalId: item.externalId },
  //             update: { ...item, updatedAt: new Date() },
  //             create: item,
  //           });

  //           if (result.createdAt.getTime() === result.updatedAt.getTime())
  //             importedCount++;
  //           else updatedCount++;

  //           return result;
  //         } catch (err) {
  //           return null;
  //         }
  //       }),
  //     );

  //     // 4. Return the structure the UI expects
  //     return {
  //       items: savedItems.filter((i) => i !== null),
  //       stats: {
  //         new: importedCount,
  //         updated: updatedCount,
  //         removed: 0, // Met API doesn't tell us what to remove
  //         skipped:
  //           countSkippedCopyright + countSkippedNoImage + countFetchFailed,
  //       },
  //       message: `Successfully processed ${limitedIds.length} items from The Met.`,
  //     };
  //   } catch (err: any) {
  //     console.error("[IMPORT] Critical Error:", err.message);
  //     throw new Error(err.message);
  //   }
  // }

  //Gemini 2.5 Flash
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

  // ==================== CSV IMPORT ====================

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

  // Backend: src/services/collection.service.ts

  async importFromCSV(csvFile: Express.Multer.File) {
    if (!csvFile) {
      throw new Error("No CSV file provided");
    }
    
    const csvText = csvFile.buffer.toString();
    const rows = parseCSV(csvText); // Use papaparse or csv-parser

    const items = rows.map((row) => ({
      id: row.id,
      museumId: "custom",
      externalId: row.id,
      title: row.title,
      artist: row.artist,
      year: parseInt(row.year),
      imageUrl: row.imageUrl,
      description: row.description,
      department: row.department || "Unknown",
      tags: row.tags ? row.tags.split(",") : [],
      // ... map other fields
    }));

    await prisma.collectionItem.createMany({ data: items });
    return items;
  }
}
