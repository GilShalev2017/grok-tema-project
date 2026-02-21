import "dotenv/config";
import express from "express";
import cors from "cors";                // ← add this
import collectionRoutes from "./routes/collection.routes.js";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// ← Add CORS middleware here (before routes)
app.use(cors({
  origin: [
    'http://localhost:5173',          // Vite dev server
    'http://localhost:5174',
    'http://localhost:3000',          // if you open built index.html locally
    // add your production domain later, e.g. 'https://your-app.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,                    // if you use cookies/auth later
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use("/api", collectionRoutes);

app.get("/", (req, res) => {
  res.json({ message: "TEMA Collections API running" });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
