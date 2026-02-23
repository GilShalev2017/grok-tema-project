import "dotenv/config";
import express from "express";
import cors from "cors";              
import collectionRoutes from "./routes/collection.routes.js";
import path from "path";

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',          
    'http://localhost:5174',
    'http://localhost:3000',          
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,                
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
