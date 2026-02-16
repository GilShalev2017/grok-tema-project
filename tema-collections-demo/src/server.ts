import "dotenv/config";
import express from "express";
import cors from "cors";                // ← add this
import collectionRoutes from "./routes/collection.routes.js";

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

app.use("/api", collectionRoutes);

app.get("/", (req, res) => {
  res.json({ message: "TEMA Collections API running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
