// import { PrismaClient } from "@prisma/client";
// import axios from "axios";
// import OpenAI from "openai";

// import prisma from "../lib/prisma"; // adjus
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// export class CollectionService {
//   async importFromMet(departmentIds: string[] = []) {
//     const params: any = {
//       hasImages: true,
//       q: "*", // broad search; change to a keyword like "painting" for testing if needed
//     };

//     if (departmentIds.length) {
//       params.departmentId = departmentIds.join("|");
//     }

//     try {
//       const searchRes = await axios.get(
//         "https://collectionapi.metmuseum.org/public/collection/v1/search",
//         { params, timeout: 15000 },
//       );

//       const objectIDs = searchRes.data.objectIDs ?? [];
//       console.log(`Met API returned ${objectIDs.length} potential object IDs`);

//       if (objectIDs.length === 0) {
//         return { imported: 0, message: "No items found" };
//       }

//       const items = [];
//       const limitedIds = objectIDs.slice(0, 50); // increase if you want more, but keep reasonable for dev

//       for (const id of limitedIds) {
//         try {
//           const objRes = await axios.get(
//             `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
//             { timeout: 10000 },
//           );
//           const data = objRes.data;

//           // Strict filter: only include if there's a usable primary image
//           const primaryImg = data.primaryImage || data.primaryImageSmall;
//           if (!primaryImg) {
//             continue; // skip items without image
//           }

//           items.push({
//             externalId: String(data.objectID),
//             title: data.title || "Untitled",
//             artist: data.artistDisplayName || null,
//             year: data.objectDate ? parseInt(data.objectDate, 10) : null,
//             description: data.medium || data.culture || null,
//             imageUrl: primaryImg, // prefer primaryImage (higher res)
//             additionalImages: data.additionalImages?.join(",") || null,
//             metadata: data ? JSON.stringify(data) : null,
//             aiKeywords: null,
//             museumId: "met",
//           });
//         } catch (objErr: any) {
//           console.warn(`Failed to fetch object ${id}: ${objErr.message}`);
//         }
//       }

//       if (items.length > 0) {
//         await prisma.collectionItem.createMany({ data: items });
//         console.log(`Successfully imported ${items.length} items WITH images`);
//       }

//       return {
//         imported: items.length,
//         totalProcessed: limitedIds.length,
//         totalAvailable: objectIDs.length,
//       };
//     } catch (err: any) {
//       console.error("Met import error:", err.message);
//       throw err;
//     }
//   }

//   async enrichWithAI(itemId: string) {
//     const item = await prisma.collectionItem.findUnique({
//       where: { id: itemId },
//     });
//     if (!item || !item.imageUrl) return item;

//     let keywords: string[] = [];

//     try {
//       const response = await openai.chat.completions.create({
//         model: "gpt-4o",
//         messages: [
//           {
//             role: "user",
//             content: [
//               {
//                 type: "text",
//                 text: `You are an art historian analyzing this artwork titled "${item.title || "Untitled"}" by ${item.artist || "unknown artist"}.
//               Describe the main visual elements, colors, style, composition, mood, and subjects in detail.
//               Return **exactly 8-12 unique, specific keywords** as a JSON array of strings (no duplicates, no explanations).
//               Focus on distinctive features to differentiate from similar works.`,
//               },
//               {
//                 type: "image_url",
//                 image_url: { url: item.imageUrl },
//               },
//             ],
//           },
//         ],
//         max_tokens: 200,
//         temperature: 0.4, // lower = more consistent & factual
//       });

//       const content = response.choices[0]?.message?.content ?? "[]";
//       keywords = JSON.parse(content);
//       if (!Array.isArray(keywords)) keywords = [];
//       keywords = [...new Set(keywords)]; // force uniqueness
//     } catch (err: any) {
//       console.error("AI enrichment failed:", err.message);
//       keywords = ["art", "painting", "historical", "portrait", "culture"];
//     }

//     const keywordsStr = keywords.join(",");
//     return prisma.collectionItem.update({
//       where: { id: itemId },
//       data: { aiKeywords: keywordsStr },
//     });
//   }

//   async getAllItems() {
//     console.log("Fetching all items");
//     const items = await prisma.collectionItem.findMany({
//       take: 50,
//       orderBy: { createdAt: "desc" },
//     });

//     // Optional: parse back to arrays/objects when returning
//     return items.map((item: any) => ({
//       ...item,
//       additionalImages: item.additionalImages
//         ? item.additionalImages.split(",")
//         : [],
//       metadata: item.metadata ? JSON.parse(item.metadata) : null,
//       aiKeywords: item.aiKeywords ? item.aiKeywords.split(",") : [],
//     }));
//   }

//   // CSV import remains mock for now — same logic
//   async importFromCSV(filePath: string) {
//     const mockItems = [
//       {
//         externalId: "csv-001",
//         title: "Portrait of a Lady",
//         artist: "Unknown",
//         year: 1780,
//         description: "Example item imported via CSV",
//         imageUrl: "/uploads/example.jpg",
//         additionalImages: null,
//         metadata: null,
//         aiKeywords: null,
//         museumId: "demo",
//       },
//     ];

//     await prisma.collectionItem.createMany({
//       data: mockItems,
//       //skipDuplicates: true,
//     });

//     return { imported: mockItems.length };
//   }
// }
// src/services/collection.service.ts
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import OpenAI from "openai";
import NodeCache from "node-cache";
import crypto from "crypto";

// Singleton Prisma
import prisma from "../lib/prisma";

// Caches
const metCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 }); // 1 hour for Met objects
const aiCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 }); // 24 hours for AI results

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class CollectionService {
  // ==================== MET IMPORT (with image filter + cache) ====================
  async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
    const params: any = {
      hasImages: true,
      q: searchTerm.trim() || "*",
    };

    // Add departments only if provided
    if (departmentIds.length > 0) {
      params.departmentId = departmentIds.join("|");
    }

    try {
      const searchRes = await axios.get(
        "https://collectionapi.metmuseum.org/public/collection/v1/search",
        { params, timeout: 15000 },
      );

      const objectIDs = searchRes.data.objectIDs ?? [];
      console.log(
        `[IMPORT] Met returned ${objectIDs.length} items for q="${params.q}"` +
          (departmentIds.length ? `, departments=${params.departmentId}` : ""),
      );

      if (objectIDs.length === 0) {
        return { imported: 0, message: "No items found for this search" };
      }

      const items: any[] = [];
      const limitedIds = objectIDs.slice(0, 80); // adjustable limit

      for (const id of limitedIds) {
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
            console.warn(`[IMPORT] Failed to fetch object ${id}`);
            continue;
          }
        }

        // Strict image filter
        const primaryImg = data.primaryImage || data.primaryImageSmall;
        if (!primaryImg) continue;

        items.push({
          externalId: String(data.objectID),
          title: data.title || "Untitled",
          artist: data.artistDisplayName || null,
          year: data.objectDate ? parseInt(data.objectDate, 10) : null,
          description: data.medium || data.culture || null,
          imageUrl: primaryImg,
          additionalImages: data.additionalImages?.join(",") || null,
          metadata: data ? JSON.stringify(data) : null,
          aiKeywords: null,
          museumId: "met",
        });
      }

      let importedCount = 0;
      if (items.length > 0) {
        const result = await prisma.collectionItem.createMany({
          data: items,
          //skipDuplicates: true, // if your SQLite supports it — otherwise remove
        });
        importedCount = result.count;
        console.log(`[IMPORT] Saved ${importedCount} new items`);
      }

      return {
        imported: importedCount,
        totalProcessed: limitedIds.length,
        totalFound: objectIDs.length,
        searchTerm: params.q,
        departments: departmentIds.length ? departmentIds : null,
      };
    } catch (err: any) {
      console.error("[IMPORT] Critical error:", err.message);
      throw err;
    }
  }
  // ==================== AI ENRICHMENT (with cache per image) ====================
  async enrichWithAI(itemId: string) {
    const item = await prisma.collectionItem.findUnique({
      where: { id: itemId },
    });
    if (!item || !item.imageUrl) return item;

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
                Return only a JSON array. Examples: ["sepia photograph", "formal attire", "mustache", "railway station", "19th century portrait"]`,
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

      const content = response.choices[0]?.message?.content ?? "[]";
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

  // ==================== GET ALL ITEMS (with parsed arrays) ====================
  async getAllItems() {
    const items = await prisma.collectionItem.findMany({
      take: 100, // increased for better demo
      orderBy: { createdAt: "desc" },
    });

    return items.map((item: any) => ({
      ...item,
      additionalImages: item.additionalImages
        ? item.additionalImages.split(",")
        : [],
      metadata: item.metadata ? JSON.parse(item.metadata) : null,
      aiKeywords: item.aiKeywords ? item.aiKeywords.split(",") : [],
    }));
  }

  // ==================== CSV IMPORT (mock) ====================
  async importFromCSV(filePath: string) {
    const mockItems = [
      {
        externalId: "csv-001",
        title: "Portrait of a Lady",
        artist: "Unknown",
        year: 1780,
        description: "Example CSV import",
        imageUrl: "https://picsum.photos/id/1015/800/600", // placeholder with image
        additionalImages: null,
        metadata: null,
        aiKeywords: null,
        museumId: "demo",
      },
    ];

    await prisma.collectionItem.createMany({ data: mockItems });
    return { imported: mockItems.length };
  }
}
