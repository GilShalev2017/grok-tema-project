# Google Drive Integration Cheat Sheet

**Complete Implementation Guide for TEMA Collections Demo**

## 🎯 Overview

The Google Drive integration allows users to import images directly from their Google Drive folders into the artwork collection. This implementation uses OAuth 2.0 for secure authentication and the Google Drive API v3 for file access.

## 🔐 OAuth 2.0 Flow

### **1. Authorization URL Generation**
```typescript
// Endpoint: GET /api/import/drive/auth
// File: src/routes/collection.routes.ts (lines 143-154)

/**
 * Generates Google OAuth 2.0 authorization URL
 * Creates consent URL with required scopes for Drive access
 */
router.get("/import/drive/auth", (req, res) => {
  const url = generateGoogleAuthUrl();
  res.json({ url });
});
```

**Implementation Details:**
- Uses `google.auth.OAuth2Client` from Google APIs
- Scopes: `https://www.googleapis.com/auth/drive.readonly`
- Redirect URI: Configured in Google Cloud Console
- State parameter: Optional folder ID passing

### **2. User Authorization**
```
User Flow:
1. User clicks "Import from Google Drive"
2. Frontend calls GET /api/import/drive/auth
3. Receives authorization URL
4. User is redirected to Google consent screen
5. User grants Drive access permissions
6. Google redirects back with authorization code
```

### **3. Callback Handling**
```typescript
// Endpoint: GET /api/import/drive/callback
// File: src/routes/collection.routes.ts (lines 171-187)

/**
 * Handles OAuth callback from Google
 * Exchanges authorization code for access token
 * Optionally performs automatic import
 */
router.get("/import/drive/callback", async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const tokens = await exchangeCodeForTokens(code as string);
    const result = await service.importFromDrive(
      state as string,  // Folder ID from state
      tokens.access_token!
    );
    
    // Redirect back to frontend with success
    res.redirect(`${process.env.FRONTEND_URL}/import?status=success`);
  } catch (error) {
    res.redirect(`${process.env.FRONTEND_URL}/import?status=error`);
  }
});
```

**Key Features:**
- **Code Exchange**: Converts auth code to access token
- **State Parameter**: Passes folder ID through OAuth flow
- **Automatic Import**: Can trigger import immediately after auth
- **Error Handling**: Graceful redirect on failure

### **4. Token Exchange Implementation**
```typescript
// File: src/lib/google-auth.ts

export async function exchangeCodeForTokens(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}
```

## 📁 Drive API Integration

### **1. Main Import Function**
```typescript
// Method: CollectionService.importFromDrive()
// File: src/services/collection.service.ts (lines 836-671)

async importFromDrive(folderId: string, accessToken: string) {
  // Validation
  if (!folderId || folderId === "undefined" || folderId === "null") {
    throw new Error("Invalid Folder ID received by backend.");
  }

  // OAuth Client Setup
  const auth = getOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth });

  // File Listing
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, webContentLink, thumbnailLink)",
  });

  // Process files...
}
```

### **2. File Query Parameters**
```typescript
// Google Drive API Query
q: `'${folderId}' in parents and trashed = false`

// Breakdown:
// '${folderId}' in parents  -> Files in specified folder
// and trashed = false      -> Exclude deleted files
```

**Supported Fields:**
- `id` - Unique file identifier
- `name` - Original filename
- `mimeType` - File type (image/*, application/*, etc.)
- `webContentLink` - Direct download URL
- `thumbnailLink` - Google-generated thumbnail

### **3. Image Processing**
```typescript
// File Filtering and URL Generation
for (const file of files) {
  // Only process image files
  if (file.mimeType?.startsWith("image/")) {
    
    // Generate high-quality preview URL
    const directImageUrl = `https://lh3.googleusercontent.com/d/${file.id}=w1000`;
    
    // Create database record
    const newItem = await prisma.collectionItem.create({
      data: {
        title: file.name || "Untitled",
        imageUrl: directImageUrl,
        externalId: file.id!,
      },
    });
    
    results.push(newItem);
  }
}
```

## 🔗 URL Generation Strategy

### **Direct Preview URLs**
```typescript
// High-resolution preview URL format
const directImageUrl = `https://lh3.googleusercontent.com/d/${file.id}=w1000`;

// Alternative sizes:
// w400  - Small preview (400px width)
// w800  - Medium preview (800px width)
// w1000 - Large preview (1000px width)
// w2000 - Extra large (2000px width)
```

**Why Use Preview URLs:**
- **Reliability**: More stable than download links
- **Performance**: Optimized for web display
- **No Authentication**: Publicly accessible
- **Consistent Format**: Predictable URL structure

### **URL Parameters**
```
https://lh3.googleusercontent.com/d/{FILE_ID}=w{WIDTH}

Parameters:
- FILE_ID: Google Drive file identifier
- w{WIDTH}: Image width in pixels
- Additional options: =s{SIZE} for square crops
```

## 🛡️ Security Implementation

### **1. OAuth Configuration**
```typescript
// File: src/lib/google-auth.ts

const oauth2Client = new google.auth.OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: `${process.env.FRONTEND_URL}/auth/callback`,
});
```

### **2. Token Management**
```typescript
// Secure token handling
auth.setCredentials({ access_token: accessToken });

// Token is NOT stored permanently
// Session-based authentication
// Tokens expire after 1 hour
```

### **3. Permission Scopes**
```typescript
// Minimal required scope
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Why readonly:
- Principle of least privilege
- Can only read files, not modify
- User data protection
- Audit compliance
```

## 📊 Error Handling

### **1. Folder ID Validation**
```typescript
// Comprehensive validation
if (!folderId || 
    folderId === "undefined" || 
    folderId === "null" || 
    folderId.length === 0) {
  throw new Error("Invalid Folder ID received by backend.");
}
```

### **2. API Error Codes**
```typescript
// Google Drive API error handling
if (error.code === 404) {
  throw new Error(
    `Folder ID '${folderId}' was not found. Please ensure folder is shared.`
  );
}

if (error.code === 401 || error.code === 403) {
  throw new Error(
    "Google Authentication expired or invalid permissions. Please reconnect."
  );
}
```

### **3. Common Error Scenarios**
```
Error Type                | Cause                          | Solution
--------------------------|--------------------------------|----------
Invalid Folder ID        | Wrong/missing folder ID        | Verify folder sharing
Permission Denied        | OAuth scope insufficient          | Re-authenticate
Quota Exceeded         | API rate limit exceeded          | Implement retry logic
File Not Found          | File deleted or moved          | Refresh folder listing
Network Error           | Connection issues              | Retry with backoff
```

## 🎨 Frontend Integration

### **1. Import Flow**
```typescript
// Client-side implementation
export async function importFromDrive(
  folderId: string,
  accessToken: string
): Promise<DriveImportResponse> {
  const { data } = await api.post<DriveImportResponse>("/import/drive", {
    folderId,
    accessToken,
  });
  return data;
}
```

### **2. OAuth URL Generation**
```typescript
export async function getGoogleAuthUrl(): Promise<string> {
  const { data } = await api.get<{ url: string }>("/import/drive/auth");
  return data.url;
}
```

### **3. User Experience Flow**
```
1. User clicks "Connect Google Drive"
2. App opens Google OAuth in new window
3. User grants permissions
4. Window closes, app processes callback
5. User selects folder to import
6. Import begins with progress indicator
7. Results displayed with success/error status
```

## 🔧 Configuration

### **1. Google Cloud Console Setup**
```
Required Settings:
1. Create new project
2. Enable Google Drive API
3. Configure OAuth 2.0 Client
4. Set authorized redirect URIs
5. Add application homepage
6. Verify domain (production)

Redirect URI Format:
{FRONTEND_URL}/auth/callback
Example: http://localhost:5173/auth/callback
```

### **2. Environment Variables**
```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Application URLs
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

### **3. Production Considerations**
```env
# Production Environment
FRONTEND_URL=https://yourdomain.com
GOOGLE_CLIENT_ID=production_client_id
GOOGLE_CLIENT_SECRET=production_client_secret

# Security Headers
NODE_ENV=production
```

## 📈 Performance Optimization

### **1. API Rate Limits**
```typescript
// Google Drive API quotas
- Queries per second: 100
- Queries per day: 1,000,000,000
- File size limit: 100GB per file
- Concurrent requests: 10
```

### **2. Caching Strategy**
```typescript
// Cache Google Drive folder listings
const driveCache = new NodeCache({ 
  stdTTL: 300,  // 5 minutes
  checkperiod: 60 
});

// Cache key based on folder ID
const cacheKey = `drive-folder-${folderId}`;
```

### **3. Batch Processing**
```typescript
// Process files in batches to avoid timeouts
const BATCH_SIZE = 50;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await processBatch(batch);
}
```

## 🧪 Testing

### **1. Unit Tests**
```typescript
// Mock Google Drive API
jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(() => ({
      files: {
        list: jest.fn().mockResolvedValue({
          data: { files: mockFiles }
        })
      }
    }))
  }
}));
```

### **2. Integration Tests**
```typescript
// Test OAuth flow
describe('Google Drive OAuth', () => {
  it('should generate authorization URL', async () => {
    const response = await request(app)
      .get('/api/import/drive/auth')
      .expect(200);
    
    expect(response.body.url).toContain('accounts.google.com');
  });
});
```

### **3. End-to-End Tests**
```typescript
// Test complete import flow
it('should import images from Google Drive', async () => {
  const mockAccessToken = 'valid_access_token';
  const mockFolderId = 'test_folder_id';
  
  const result = await service.importFromDrive(mockFolderId, mockAccessToken);
  
  expect(result.success).toBe(true);
  expect(result.items).toHaveLength(3);
});
```

## 🚨 Troubleshooting

### **1. Common Issues**
```
Issue: "redirect_uri_mismatch"
Cause: Redirect URI not configured in Google Console
Fix: Add exact frontend URL to authorized redirect URIs

Issue: "invalid_client"
Cause: Wrong client ID or secret
Fix: Verify environment variables match Google Console

Issue: "access_denied"
Cause: User denied permission
Fix: Explain permissions needed and retry

Issue: "folder_not_found"
Cause: Folder ID incorrect or not shared
Fix: Verify folder sharing settings
```

### **2. Debug Logging**
```typescript
// Comprehensive logging
console.log(">>> [DRIVE SERVICE] Initializing with Folder ID:", folderId);
console.log(">>> [DRIVE SERVICE] Found", files.length, "files");
console.log(">>> [DRIVE SERVICE] Processing image:", file.name);
```

### **3. Monitoring**
```typescript
// Track import metrics
const metrics = {
  totalFiles: files.length,
  imageFiles: imageFiles.length,
  importedItems: results.length,
  processingTime: Date.now() - startTime,
  errors: errorCount
};
```

## 📚 API Reference

### **Google Drive API v3**
```typescript
// Core methods used
drive.files.list(params)     // List folder contents
drive.files.get(params)      // Get file metadata
drive.files.export(params)    // Export file content
```

### **Query Parameters**
```typescript
// Search query syntax
q: `'${folderId}' in parents and trashed = false`

// Available operators
in parents           // Child of specified folder
trashed = false     // Not in trash
mimeType = 'image/*' // Filter by type
name contains 'photo' // Filename search
```

### **Response Structure**
```typescript
interface DriveFile {
  id: string;                    // Unique identifier
  name: string;                  // Original filename
  mimeType: string;              // File type
  size: string;                 // File size in bytes
  createdTime: string;           // Creation timestamp
  modifiedTime: string;          // Last modified
  webContentLink?: string;       // Download URL
  thumbnailLink?: string;         // Thumbnail URL
  parents: string[];             // Parent folder IDs
}
```

## 🔮 Future Enhancements

### **1. Advanced Features**
- **Folder Browsing**: Navigate subfolders
- **File Selection**: Choose specific files
- **Progress Tracking**: Real-time import progress
- **Delta Sync**: Import only new/changed files
- **Batch Operations**: Multiple folder imports

### **2. Performance Improvements**
- **Webhook Integration**: Real-time sync
- **Background Processing**: Queue large imports
- **Compression**: Optimize image sizes
- **CDN Integration**: Faster image delivery

### **3. User Experience**
- **Drag & Drop**: Direct folder import
- **Preview Gallery**: Image thumbnails before import
- **Import History**: Track previous imports
- **Undo Functionality**: Revert imports

---

**🎯 This cheat sheet covers the complete Google Drive integration implementation. Use it as your reference for development, debugging, and enhancement planning.**
