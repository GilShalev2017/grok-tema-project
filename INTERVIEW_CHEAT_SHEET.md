# TEMA Collections Demo - Interview Preparation Cheat Sheet

**Complete Technical Reference for All System Functionality**

## 🎯 System Overview

### **Core Architecture**
```
Frontend (React + TypeScript) ←→ Backend (Express + TypeScript)
                                   ↓
                            Database (SQLite + Prisma ORM)
                                   ↓
                    External APIs (Met Museum, Google Drive, OpenAI)
```

### **Key Features**
1. **Multi-Source Import** - Met Museum, Google Drive, CSV
2. **AI-Powered Enrichment** - GPT-4 Vision analysis
3. **Collection Management** - CRUD with pagination
4. **Smart Caching** - Performance optimization
5. **File Handling** - Upload, processing, storage

---

## 🏛️ Met Museum API Integration

### **1. Import Function**
```typescript
// Method: CollectionService.importFromMet()
// File: src/services/collection.service.ts (lines 92-242)

async importFromMet(searchTerm: string = "*", departmentIds: string[] = []) {
  // Parallel API calls for performance
  const searchTasks = departmentIds.length > 0
    ? departmentIds.map(id => axios.get(MET_API_URL, {
        params: { q: searchTerm, hasImages: true, departmentId: id },
        timeout: 15000
      }))
    : [axios.get(MET_API_URL, {
        params: { q: searchTerm, hasImages: true },
        timeout: 15000
      })];

  const searchResponses = await Promise.all(searchTasks);
  const uniqueObjectIDs = [...new Set(
    searchResponses.flatMap(res => res.data.objectIDs ?? [])
  )];

  // Process with caching and filtering
  const limitedIds = uniqueObjectIDs.slice(0, 80);
  // ... rest of implementation
}
```

### **2. API Endpoints**
```http
Base URL: https://collectionapi.metmuseum.org/public/collection/v1/

Search:  GET /search?q={term}&hasImages=true&departmentId={id}
Object:  GET /objects/{objectId}
Departments: GET /departments

Parameters:
- q: Search query (default "*" for all)
- hasImages: true/false (filter images only)
- departmentId: Department ID for filtering
```

### **3. Data Processing**
```typescript
// Intelligent filtering
if (!data.isPublicDomain) return null;  // Skip copyrighted
if (!primaryImg) return null;         // Skip no images

// Data transformation
return {
  externalId: String(data.objectID),
  title: data.title || "Untitled",
  artist: data.artistDisplayName || "Unknown Artist",
  year: data.objectBeginDate || parseInt(data.objectDate, 10),
  description: data.medium || data.culture || null,
  imageUrl: primaryImg,
  additionalImages: data.additionalImages?.join(",") || null,
  metadata: JSON.stringify(data),
  museumId: "met",
};
```

### **4. Caching Strategy**
```typescript
// 1-hour TTL for Met objects
const metCache = new NodeCache({ 
  stdTTL: 3600,    // 1 hour
  checkperiod: 300    // Check every 5 minutes
});

// Cache key pattern
const cacheKey = `met-object-${id}`;
```

---

## 🤖 AI Enrichment System

### **1. Vision Analysis**
```typescript
// Method: CollectionService.enrichWithAI()
// File: src/services/collection.service.ts (lines 262-347)

async enrichWithAI(itemId: string) {
  const item = await prisma.collectionItem.findUnique({
    where: { id: itemId }
  });

  // Generate cache key from image URL
  const imageHash = crypto.createHash("md5")
    .update(item.imageUrl)
    .digest("hex");
  const aiCacheKey = `ai-${imageHash}`;

  // Check cache first (24-hour TTL)
  let keywordsStr = aiCache.get<string>(aiCacheKey);
  if (keywordsStr) {
    return prisma.collectionItem.update({
      where: { id: itemId },
      data: { aiKeywords: keywordsStr }
    });
  }

  // Call OpenAI GPT-4 Vision
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: `Analyze artwork titled "${item.title}" by ${item.artist}.
                  Return 8-12 specific, descriptive keywords.
                  Focus on visual elements, colors, style, composition.
                  Return ONLY JSON array, no markdown.`
        },
        {
          type: "image_url",
          image_url: { url: item.imageUrl }  // ← Sends actual image!
        }
      ]
    }],
    max_tokens: 220,
    temperature: 0.35
  });
}
```

### **2. Prompt Engineering**
```typescript
// Optimized prompt for consistent results
const prompt = `You are an expert art historian. Analyze artwork titled "${title}" by ${artist}.
Return **exactly 8-12 unique, specific, descriptive keywords**.
Focus on: visual elements, colors, style period, composition, mood, subjects, technique.
**IMPORTANT: Return ONLY a raw JSON array with no markdown formatting.**
Example format: ["sepia photograph", "formal attire", "mustache", "railway station"]`;
```

### **3. Response Processing**
```typescript
// Clean and validate AI response
let content = response.choices[0]?.message?.content ?? "[]";

// Strip markdown code blocks
content = content
  .replace(/```json\n?/g, "")
  .replace(/```\n?/g, "")
  .trim();

// Parse and validate
let keywords = JSON.parse(content);
if (!Array.isArray(keywords)) keywords = [];
keywords = [...new Set(keywords)]; // Deduplicate

// Cache for 24 hours
aiCache.set(aiCacheKey, keywords.join(","));
```

### **4. Error Handling**
```typescript
try {
  // AI processing logic
} catch (err: any) {
  console.error(`[AI] Failed for ${item.title}:`, err.message);
  // Fallback keywords for resilience
  keywords = ["historical", "portrait", "sepia", "formal"];
}
```

---

## 📊 CSV Import System

### **1. Advanced Upsert Method**
```typescript
// Method: CollectionService.importFromCSVUpsert()
// File: src/services/collection.service.ts (lines 564-809)

async importFromCSVUpsert(
  csvFile: Express.Multer.File,
  imageFiles?: Express.Multer.File[]
): Promise<{ items: any[]; newCount: number; updatedCount: number }> {
  
  // Create image filename → URL mapping
  const imageUrlMap = new Map<string, string>();
  if (imageFiles?.length > 0) {
    imageFiles.forEach(file => {
      const publicUrl = `/uploads/artworks/${file.filename}`;
      imageUrlMap.set(file.originalname, publicUrl);
    });
  }

  // Parse CSV with Papa Parse
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: async (results) => {
        // Process each row
        for (const row of results.data as CSVRow[]) {
          const externalId = row.id?.trim() || uuidv4();
          
          // Smart image URL resolution
          let finalImageUrl = row.imageUrl?.trim() || null;
          if (finalImageUrl && !finalImageUrl.startsWith("http")) {
            const uploadedImageUrl = imageUrlMap.get(finalImageUrl);
            if (uploadedImageUrl) finalImageUrl = uploadedImageUrl;
          }

          // Check if exists (upsert logic)
          const existing = await prisma.collectionItem.findUnique({
            where: { externalId }
          });

          if (existing) {
            // Update existing record
            await prisma.collectionItem.update({
              where: { externalId },
              data: { title, artist, year, imageUrl: finalImageUrl, ... }
            });
            updatedCount++;
          } else {
            // Create new record
            await prisma.collectionItem.create({
              data: { id: uuidv4(), museumId: "custom", externalId, ... }
            });
            newCount++;
          }
        }
      }
    });
  });
}
```

### **2. CSV Interface**
```typescript
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
```

### **3. Image URL Resolution Logic**
```typescript
// Three-tier URL resolution
if (finalImageUrl) {
  if (finalImageUrl.startsWith("http")) {
    // Online URL - use as-is
    console.log("[CSV IMPORT] Using online URL for:", title);
  } else {
    // Local filename - match with uploaded files
    const uploadedImageUrl = imageUrlMap.get(finalImageUrl);
    if (uploadedImageUrl) {
      finalImageUrl = uploadedImageUrl;
      console.log("[CSV IMPORT] Using uploaded image for:", title);
    } else {
      console.warn("[CSV IMPORT] Image not found:", title);
      finalImageUrl = null;
    }
  }
}
```

### **4. File Cleanup**
```typescript
// Automatic cleanup after processing
try {
  fs.unlinkSync(csvFile.path);
  console.log("[CSV IMPORT] Cleaned up CSV file");
} catch (err) {
  console.warn("[CSV IMPORT] Could not delete CSV:", err);
}
```

---

## 🗄️ Database Operations

### **1. Pagination Implementation**
```typescript
// Method: CollectionService.getAllItems()
// File: src/services/collection.service.ts (lines 366-399)

async getAllItems(page: number = 1, limit: number = 100) {
  const skip = (page - 1) * limit;

  // Get total count for pagination metadata
  const totalCount = await prisma.collectionItem.count();

  // Get items for current page
  const items = await prisma.collectionItem.findMany({
    skip,
    take: limit,
    orderBy: { createdAt: "desc" }
  });

  // Format for frontend consumption
  const formattedItems = items.map((item: any) => ({
    ...item,
    additionalImages: item.additionalImages ? item.additionalImages.split(",") : [],
    metadata: item.metadata ? JSON.parse(item.metadata) : null,
    aiKeywords: item.aiKeywords ? item.aiKeywords.split(",") : []
  }));

  return {
    items: formattedItems,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalItems: totalCount,
      itemsPerPage: limit,
      hasNextPage: page < Math.ceil(totalCount / limit),
      hasPreviousPage: page > 1
    }
  };
}
```

### **2. Database Schema**
```sql
// Prisma Schema - prisma/schema.prisma
model CollectionItem {
  id               String   @id @default(uuid())
  museumId         String   @default("met")
  externalId       String   @unique
  title            String
  artist           String?
  year             Int?
  description      String?
  imageUrl         String?
  additionalImages String?
  metadata         String?
  aiKeywords       String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@map("collection_items")
}
```

### **3. Upsert Operations**
```typescript
// Create or update pattern
const result = await prisma.collectionItem.upsert({
  where: { externalId: item.externalId },
  update: { ...item, updatedAt: new Date() },
  create: item
});

// Check if new or updated
if (result.createdAt.getTime() === result.updatedAt.getTime()) {
  importedCount++;  // New item
} else {
  updatedCount++;    // Updated item
}
```

### **4. Bulk Operations**
```typescript
// Efficient bulk insert
const result = await prisma.collectionItem.createMany({
  data: items
});

// Bulk delete
const deleteResult = await prisma.collectionItem.deleteMany({});

// Single delete with error handling
try {
  await prisma.collectionItem.delete({
    where: { id }
  });
  return { success: true, message: "Artwork deleted successfully" };
} catch (error: any) {
  console.error(`[SERVICE] Error deleting artwork ${id}:`, error);
  throw new Error("Failed to delete artwork");
}
```

---

## 🚀 API Routes Architecture

### **1. Route Structure**
```typescript
// File: src/routes/collection.routes.ts

// Import endpoints
POST /api/import/met         // Met Museum import
POST /api/import/drive       // Google Drive import
POST /api/import/csv         // CSV import
GET  /api/import/drive/auth  // Google OAuth URL
GET  /api/import/drive/callback // Google OAuth callback

// Collection endpoints
GET    /api/items              // Paginated collection
GET    /api/items/:id          // Single item
DELETE /api/items/:id          // Delete item
DELETE /api/clear             // Clear collection

// AI endpoints
POST /api/enrich/:id          // AI enrichment

// Data endpoints
GET /api/departments          // Met departments
```

### **2. Error Handling Pattern**
```typescript
// Consistent error response format
try {
  // Route logic
  const result = await service.someMethod(params);
  res.json(result);
} catch (err: any) {
  console.error("[ROUTE] Error:", err.message);
  res.status(500).json({
    error: "Operation failed",
    message: err.message || "Unknown error"
  });
}
```

### **3. Request Validation**
```typescript
// Input validation example
router.get("/items", async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 100;

  // Validate parameters
  if (page < 1) {
    return res.status(400).json({ error: "Page must be >= 1" });
  }
  if (limit < 1 || limit > 1000) {
    return res.status(400).json({ 
      error: "Limit must be between 1 and 1000" 
    });
  }

  // Process request...
});
```

---

## 📁 File Upload System

### **1. Multer Configuration**
```typescript
// File: src/routes/collection.routes.ts (lines 236-282)

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads/artworks");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep original filename for CSV matching
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    // Validate file types
    if (file.fieldname === "csv") {
      if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
        cb(null, true);
      } else {
        cb(new Error("Only CSV files allowed"));
      }
    } else if (file.fieldname === "images") {
      const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only image files allowed"));
      }
    }
  }
});
```

### **2. Upload Route**
```typescript
router.post("/import/csv",
  upload.fields([
    { name: "csv", maxCount: 1 },
    { name: "images", maxCount: 100 }
  ]),
  async (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const csvFile = files["csv"]?.[0];
    const imageFiles = files["images"];

    if (!csvFile) {
      return res.status(400).json({ error: "No CSV file uploaded" });
    }

    const result = await service.importFromCSVUpsert(csvFile, imageFiles);
    res.json({
      success: true,
      items: result.items,
      stats: { new: result.newCount, updated: result.updatedCount, removed: 0 }
    });
  }
);
```

---

## 🎨 Frontend Integration

### **1. API Client**
```typescript
// File: src/api/client.ts

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 30000,
  headers: { "Content-Type": "application/json" }
});

// Request interceptor for auth
api.interceptors.request.use((config) => {
  // const token = localStorage.getItem('auth_token');
  // if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("[API Error]", {
      url: error.config?.url,
      status: error.response?.status,
      message: error.response?.data?.message
    });
    return Promise.reject(error);
  }
);
```

### **2. Import Functions**
```typescript
// Met Museum import
export async function importFromMet(
  searchTerm: string = "*",
  departmentIds: number[] = [],
  signal: AbortSignal
): Promise<ImportMetResponse> {
  const { data } = await api.post<ImportMetResponse>("/import/met", {
    searchTerm, departmentIds
  });
  return data;
}

// CSV import
export async function importFromCSV(
  csvFile: File,
  imageFiles?: FileList
): Promise<CSVImportResponse> {
  const formData = new FormData();
  formData.append("csv", csvFile);
  
  if (imageFiles) {
    Array.from(imageFiles).forEach(file => {
      formData.append("images", file);
    });
  }

  const { data } = await api.post<CSVImportResponse>("/import/csv", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return data;
}

// Google Drive import
export async function importFromDrive(
  folderId: string,
  accessToken: string
): Promise<DriveImportResponse> {
  const { data } = await api.post<DriveImportResponse>("/import/drive", {
    folderId, accessToken
  });
  return data;
}
```

### **3. Collection Management**
```typescript
// Paginated items
export const getItems = async (
  page: number = 1,
  limit: number = 100
): Promise<PaginatedResponse<Artwork>> => {
  const { data } = await api.get<PaginatedResponse<Artwork>>("/items", {
    params: { page, limit }
  });
  return data;
};

// AI enrichment
export async function enrichArtwork(id: string): Promise<Artwork> {
  const { data } = await api.post<Artwork>(`/enrich/${id}`);
  return data;
}

// Delete artwork
export async function deleteArtwork(id: string): Promise<void> {
  await api.delete(`/items/${id}`);
}
```

---

## 🏎️ Performance Optimizations

### **1. Dual-Layer Caching Strategy**

The system implements two distinct caching layers for optimal performance:

#### **Met Museum Cache (metCache)**
```typescript
const metCache = new NodeCache({ 
  stdTTL: 3600,    // 1 hour for Met objects
  checkperiod: 300   // Check expired keys every 5 minutes
});
```

**Usage Scenarios:**
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Object ID    │───→│   Cache Check   │───→│   Met API      │
│ (stable key)   │    │ (1hr TTL)      │    │ (rate limited) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         ↑                       ↓                       ↓
         │                  Cache Hit?            API Call
         │                       │                   │
         └───────────────Yes─────┘                   │
                                                │
                         Cache Miss?              │
                                │               │
                                ↓               │
                           Call Met API─────────────┘
                                │
                                ↓
                           Cache Result
```

**Real-World Scenarios:**

1. **Multiple Users Importing Same Artwork**
   ```
   User A imports "Starry Night" (ID: 436532)
   → Met API called, data cached for 1 hour
   → User B imports same artwork within hour
   → Cache hit! No API call, instant response
   ```

2. **Department Filtering with Overlap**
   ```
   User imports from Department 1 (Paintings)
   → Objects 1001-1100 cached
   
   User imports from Department 2 (Drawings)
   → Objects 1050-1150 requested
   → Objects 1050-1100 served from cache
   → Only 1100-1150 require API calls
   ```

3. **Search and Refine Workflow**
   ```
   User searches "Van Gogh" → 50 results
   → All 50 objects cached
   
   User refines to "Van Gogh landscape" → 20 results
   → All 20 served from cache (subset of previous)
   → Zero additional API calls
   ```

#### **AI Cache (aiCache)**
```typescript
const aiCache = new NodeCache({ 
  stdTTL: 86400,   // 24 hours for AI results
  checkperiod: 600   // Check expired keys every 10 minutes
});
```

**Usage Scenarios:**
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Image URL    │───→│   Cache Check   │───→│   OpenAI API   │
│ (MD5 hash)    │    │ (24hr TTL)      │    │ (costly)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         ↑                       ↓                       ↓
         │                  Cache Hit?            API Call
         │                       │                   │
         └───────────────Yes─────┘                   │
                                                │
                         Cache Miss?              │
                                │               │
                                ↓               │
                           Call OpenAI─────────────┘
                                │
                                ↓
                           Cache & Update DB
```

**Real-World Scenarios:**

1. **Multiple Enrichment Requests**
   ```
   Time 1: User enriches "Mona Lisa" image
   → OpenAI called, keywords generated, cached 24h
   → DB updated with AI keywords
   
   Time 2 (within 24h): Another item with same image URL
   → Cache hit! No OpenAI call
   → DB updated instantly with cached keywords
   ```

2. **Data Recovery Scenarios**
   ```
   Developer accidentally clears AI keywords from DB
   → Re-enrichment request
   → Cache hit! Keywords restored without API cost
   
   Production database rollback
   → Re-enrichment requests hit cache
   → Keywords restored without OpenAI calls
   ```

3. **Development & Testing**
   ```
   Developer resets database frequently during testing
   → Enrichment requests hit cache consistently
   → Zero OpenAI costs during development
   → Fast iteration cycles
   ```

### **2. Cache Performance Metrics**

#### **Hit Rate Tracking**
```typescript
const cacheStats = {
  met: { hits: 0, misses: 0 },
  ai: { hits: 0, misses: 0 },
  
  recordMetHit: () => cacheStats.met.hits++,
  recordMetMiss: () => cacheStats.met.misses++,
  recordAiHit: () => cacheStats.ai.hits++,
  recordAiMiss: () => cacheStats.ai.misses++,
  
  getMetHitRate: () => {
    const total = cacheStats.met.hits + cacheStats.met.misses;
    return total > 0 ? (cacheStats.met.hits / total * 100).toFixed(2) : 0;
  },
  
  getAiHitRate: () => {
    const total = cacheStats.ai.hits + cacheStats.ai.misses;
    return total > 0 ? (cacheStats.ai.hits / total * 100).toFixed(2) : 0;
  }
};
```

#### **Cost Optimization Analysis**
```
Without Caching:
- 100 Met objects × 10 requests = 1,000 API calls
- 100 AI enrichments × $0.01 = $1.00 per batch

With 80% Cache Hit Rate:
- 100 Met objects × 2 requests = 200 API calls (80% reduction)
- 100 AI enrichments × 20 = $0.20 per batch (80% savings)

Monthly Savings (1000 imports):
- Met API: 8,000 fewer calls
- AI costs: $800 savings
- Response time: 5x faster for cached items
```

### **3. Cache Invalidation Strategies**

#### **Time-Based Expiration**
```typescript
// Met objects: 1 hour (fresh data from museum)
// AI results: 24 hours (visual analysis doesn't change)
```

#### **Manual Cache Clearing**
```typescript
// Development utilities
const clearMetCache = () => metCache.flushAll();
const clearAiCache = () => aiCache.flushAll();
const clearAllCaches = () => {
  metCache.flushAll();
  aiCache.flushAll();
};
```

#### **Selective Cache Invalidation**
```typescript
// Clear specific items when needed
const invalidateMetObject = (objectId: string) => {
  metCache.del(`met-object-${objectId}`);
};

const invalidateAiResult = (imageUrl: string) => {
  const imageHash = crypto.createHash("md5").update(imageUrl).digest("hex");
  aiCache.del(`ai-${imageHash}`);
};
```

### **4. Database vs Cache Relationship**

```
                    ┌─────────────────────────────────────────┐
                    │         Data Flow Architecture        │
                    └─────────────────────────────────────────┘
    
    ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
    │   Cache        │    │   Business     │    │   Database     │
    │ (Fast, Temp)  │    │   Logic        │    │ (Persistent)   │
    └─────────────────┘    └──────────────────┘    └─────────────────┘
            ↑                       ↑                       ↑
            │                       │                       │
    Cache serves first        │               Database stores final
    for performance          │               results permanently
                            │
            └───────────────────┴───────────────────┘
                            │
                    Cache updates DB with results
```

**Key Benefits:**
- **Performance**: Instant cache hits vs API latency
- **Cost Reduction**: Fewer external API calls
- **Reliability**: Cache survives database issues
- **Scalability**: Handles high concurrent load
- **Development Speed**: Faster iteration during coding

---

## 🔐 Security Implementation

### **1. Input Validation**
```typescript
// Comprehensive input sanitization
const validateInput = {
  searchTerm: (term: string) => {
    if (typeof term !== 'string') throw new Error('Invalid search term');
    return term.trim().substring(0, 100); // Length limit
  },
  
  page: (p: string) => {
    const page = parseInt(p);
    if (isNaN(page) || page < 1) throw new Error('Invalid page number');
    return page;
  },
  
  folderId: (id: string) => {
    if (!id || id === 'undefined' || id === 'null') {
      throw new Error('Invalid folder ID');
    }
    return id;
  }
};
```

### **2. File Security**
```typescript
// File type validation
const allowedMimeTypes = {
  csv: ['text/csv', 'application/csv'],
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
};

// File size limits
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Secure filename handling
const secureFilename = (filename: string) => {
  return path.basename(filename).replace(/[^a-zA-Z0-9.-]/g, '_');
};
```

### **3. Error Sanitization**
```typescript
// Prevent information leakage in errors
const sanitizeError = (error: any) => {
  const message = error?.message || 'Unknown error occurred';
  
  // Remove sensitive information
  return message
    .replace(/password/gi, '***')
    .replace(/token/gi, '***')
    .replace(/secret/gi, '***');
};

// Consistent error responses
res.status(500).json({
  error: "Operation failed",
  message: sanitizeError(error)
});
```

---

## 🧪 Testing Strategy

### **1. Unit Tests**
```typescript
// Service layer testing
describe('CollectionService', () => {
  describe('importFromMet', () => {
    it('should import artworks with valid parameters', async () => {
      const result = await service.importFromMet('painting', [1]);
      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(greaterThan(0));
    });

    it('should handle API errors gracefully', async () => {
      jest.spyOn(axios, 'get').mockRejectedValue(new Error('API Error'));
      await expect(service.importFromMet()).rejects.toThrow();
    });
  });
});
```

### **2. Integration Tests**
```typescript
// API endpoint testing
describe('Import Routes', () => {
  it('POST /import/met should import artworks', async () => {
    const response = await request(app)
      .post('/import/met')
      .send({ searchTerm: 'monet', departmentIds: [1] })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.items).toBeDefined();
  });

  it('POST /import/csv should handle file uploads', async () => {
    const csvContent = 'title,artist\nMona Lisa,Leonardo da Vinci';
    const response = await request(app)
      .post('/import/csv')
      .attach('csv', Buffer.from(csvContent), 'test.csv')
      .expect(200);

    expect(response.body.stats.new).toBe(1);
  });
});
```

### **3. Mock Implementations**
```typescript
// Google Drive API mock
jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(() => ({
      files: {
        list: jest.fn().mockResolvedValue({
          data: { files: mockDriveFiles }
        })
      }
    }))
  }
}));

// OpenAI API mock
jest.mock('openai', () => ({
  default: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '["portrait", "oil painting"]' } }]
        })
      }
    }
  }))
}));
```

---

## 📊 Monitoring & Logging

### **1. Structured Logging**
```typescript
// Consistent log format
const logger = {
  import: (message: string, data?: any) => {
    console.log(`[IMPORT] ${message}`, data || '');
  },
  
  ai: (message: string, data?: any) => {
    console.log(`[AI] ${message}`, data || '');
  },
  
  error: (context: string, error: any) => {
    console.error(`[${context}] Error:`, {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};
```

### **2. Performance Metrics**
```typescript
// Request timing middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[PERF] ${req.method} ${req.path} - ${duration}ms`);
  });
  
  next();
});

// Cache hit tracking
const cacheStats = {
  hits: 0,
  misses: 0,
  
  recordHit: () => cacheStats.hits++,
  recordMiss: () => cacheStats.misses++,
  
  getHitRate: () => {
    const total = cacheStats.hits + cacheStats.misses;
    return total > 0 ? (cacheStats.hits / total * 100).toFixed(2) : 0;
  }
};
```

---

## 🚀 Deployment Considerations

### **1. Environment Configuration**
```env
# Production variables
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://yourdomain.com

# API Keys
OPENAI_API_KEY=prod_openai_key
GOOGLE_CLIENT_ID=prod_google_client_id
GOOGLE_CLIENT_SECRET=prod_google_client_secret

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

### **2. Docker Configuration**
```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:18-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### **3. Process Management**
```json
// package.json scripts
{
  "scripts": {
    "start": "node dist/server.js",
    "dev": "tsx src/server.ts",
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src --ext .ts,.tsx",
    "type-check": "tsc --noEmit"
  }
}
```

---

## 🎯 Key Interview Points

### **Technical Architecture**
- **Microservices-ready** modular design
- **Type-safe** TypeScript throughout
- **ORM-based** data access with Prisma
- **RESTful** API design principles
- **Event-driven** error handling

### **Performance Features**
- **Multi-layer caching** (Met API, AI results)
- **Parallel processing** for API calls
- **Database optimization** with proper indexing
- **Lazy loading** and pagination
- **Bulk operations** for efficiency

### **Security Practices**
- **Input validation** on all endpoints
- **File type restrictions** and size limits
- **OAuth 2.0** for third-party auth
- **Error sanitization** to prevent leaks
- **Principle of least privilege** for API scopes

### **Scalability Considerations**
- **Stateless design** for horizontal scaling
- **Database connection pooling** via Prisma
- **CDN-ready** image URL generation
- **Queue-ready** architecture for background jobs
- **Monitoring-friendly** structured logging

### **Code Quality**
- **Comprehensive error handling** with fallbacks
- **Type safety** with TypeScript interfaces
- **Test coverage** for critical paths
- **Documentation** with JSDoc standards
- **Consistent naming** and code organization

---

**🚀 This cheat sheet covers the complete technical implementation. Use it to demonstrate deep understanding of system architecture, best practices, and technical decision-making during your interview!**
