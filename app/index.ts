// Core framework
import express, { Application } from "express";

// Enable Cross-Origin Resource Sharing (CORS)
import cors from "cors";

// Routes
import currencyRoutes from "./routes/currencyMod.ts";

// DB (update path if different)
import { db } from "../db/index.ts";

// Create an Express application instance
const app: Application = express();

// -----------------------
// Middleware
// -----------------------

app.use(express.json());

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// -----------------------
// Routes
// -----------------------

app.use("/api", currencyRoutes(db));

// Export app
export default app;
