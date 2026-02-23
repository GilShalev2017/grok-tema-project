# TEMA Collections Demo

A comprehensive artwork collection management system with multi-source import capabilities, AI-powered enrichment, and modern web interface.

## 🚀 Features

### **Multi-Source Import**
- **Met Museum API** - Import from world-renowned museum collection
- **Google Drive** - OAuth 2.0 integration for personal image collections
- **CSV Upload** - Bulk import with image support and smart upsert

### **AI-Powered Enrichment**
- **Visual Analysis** - GPT-4 Vision for automatic keyword generation
- **Intelligent Caching** - 24-hour cache for AI results to optimize costs
- **Metadata Enhancement** - Automatic tagging and categorization

### **Collection Management**
- **Pagination** - Efficient handling of large collections
- **Search & Filter** - Advanced filtering capabilities
- **CRUD Operations** - Complete collection lifecycle management
- **Bulk Operations** - Mass import, update, and deletion

## 🏗️ Architecture

### **Backend Stack**
```
├── Express.js (REST API)
├── Prisma ORM (SQLite)
├── TypeScript (Type Safety)
├── Node.js (Runtime)
└── Multer (File Uploads)
```

### **Frontend Stack**
```
├── React.js (UI Components)
├── Vite (Build Tool)
├── TypeScript (Type Safety)
├── Axios (HTTP Client)
└── Tailwind CSS (Styling)
```

### **External Integrations**
```
├── Met Museum API (Artwork Data)
├── Google Drive API (File Storage)
├── OpenAI GPT-4 Vision (AI Analysis)
└── CSV Parser (Data Import)
```

## 📦 Installation

### **Prerequisites**
- Node.js 18+
- npm or yarn
- Git

### **Setup**
```bash
# Clone repository
git clone <repository-url>
cd tema-collections-demo

# Install dependencies
npm install

# Environment setup
cp .env.example .env
# Edit .env with your API keys

# Database setup
npx prisma generate
npx prisma db push

# Start development server
npm run dev
```

### **Environment Variables**
```env
# OpenAI API Key
OPENAI_API_KEY=your_openai_key_here

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Frontend URL (for OAuth callbacks)
FRONTEND_URL=http://localhost:5173

# API Configuration
PORT=3001
NODE_ENV=development
```

## 🚀 Quick Start

### **1. Start Application**
```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

### **2. Access the Application**
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api-docs

### **3. Import Your First Collection**
1. Navigate to the Import page
2. Choose import method (Met Museum, Google Drive, or CSV)
3. Follow the guided import process
4. View your collection in the Gallery

## 📚 API Documentation

### **Core Endpoints**

#### **Collection Management**
```http
GET    /api/items              # Get paginated collection
GET    /api/items/:id          # Get specific artwork
DELETE /api/items/:id          # Delete artwork
DELETE /api/clear             # Clear entire collection
```

#### **Import Operations**
```http
POST   /api/import/met         # Import from Met Museum
POST   /api/import/drive       # Import from Google Drive
POST   /api/import/csv         # Import from CSV file
GET    /api/import/drive/auth  # Get Google OAuth URL
GET    /api/import/drive/callback # Google OAuth callback
```

#### **AI & Data**
```http
POST   /api/enrich/:id        # AI enrichment
GET    /api/departments       # Met Museum departments
```

### **Response Format**
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully",
  "stats": {
    "new": 10,
    "updated": 5,
    "skipped": 2
  }
}
```

## 🔧 Configuration

### **Caching Strategy**
- **Met Museum Cache**: 1 hour TTL for object data
- **AI Results Cache**: 24 hours TTL for keywords
- **Department Cache**: 1 hour TTL for department data

### **File Upload Limits**
- **CSV Files**: Max 10MB
- **Image Files**: Max 10MB each, up to 100 files
- **Supported Formats**: CSV, JPEG, PNG, GIF, WebP

### **Pagination Defaults**
- **Default Page Size**: 100 items
- **Maximum Page Size**: 1000 items
- **Supported Range**: 1-1000 items per page

## 🛠️ Development

### **Available Scripts**
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run test         # Run tests
npm run lint         # Code linting
npm run type-check   # TypeScript validation
```

### **Project Structure**
```
src/
├── components/         # React components
├── pages/            # Page components
├── services/         # Business logic
├── routes/           # API routes
├── lib/              # Utilities and helpers
├── types/            # TypeScript definitions
├── prisma/           # Database schema and migrations
└── uploads/          # File upload storage
```

### **Database Schema**
```sql
CollectionItem {
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
}
```

## 🔐 Security

### **Authentication**
- **Google OAuth 2.0** for Drive access
- **Token-based** authentication for API access
- **Secure token** storage and refresh

### **Data Validation**
- **Input sanitization** on all endpoints
- **File type validation** for uploads
- **SQL injection prevention** via Prisma ORM
- **XSS protection** in frontend

### **Rate Limiting**
- **API rate limits** implemented
- **File upload limits** enforced
- **Cache-based optimization** to reduce external API calls

## 🚀 Deployment

### **Environment Setup**
```bash
# Production environment variables
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://yourdomain.com
```

### **Database Setup**
```bash
# Generate Prisma client
npx prisma generate

# Deploy database schema
npx prisma db push

# (Optional) Seed database
npx prisma db seed
```

### **Docker Deployment**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## 📈 Performance

### **Optimization Features**
- **Dual-layer caching** for API responses
- **Parallel processing** for bulk operations
- **Lazy loading** for large collections
- **Image optimization** and compression
- **Database indexing** on key fields

### **Monitoring**
- **Request logging** with structured format
- **Error tracking** and reporting
- **Performance metrics** collection
- **Cache hit/miss** statistics

## 🤝 Contributing

### **Development Workflow**
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request
5. Code review and merge

### **Code Standards**
- **TypeScript** for type safety
- **ESLint** for code quality
- **Prettier** for formatting
- **Husky** for pre-commit hooks

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### **Common Issues**
- **Google OAuth**: Ensure redirect URLs match
- **File uploads**: Check file size limits
- **AI enrichment**: Verify OpenAI API key
- **Database**: Run migrations after updates

### **Getting Help**
- **Documentation**: Check this README first
- **Issues**: Create GitHub issue with details
- **Discussions**: Use GitHub Discussions
- **Email**: support@yourdomain.com

---

**Built with ❤️ for art enthusiasts and collectors**
