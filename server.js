const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const productsRouter = require("./routes/products");
const ordersRouter = require("./routes/orders");
const adminOrdersRouter = require("./routes/adminOrders");
const deviceVerificationRouter = require("./routes/deviceVerification");
const returnsRouter = require("./routes/returns");
const customerReturnsRouter = require("./routes/customerReturns");

const app = express();

const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = rawFrontendUrl
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/$/, "");
      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(normalizedOrigin) ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

const healthCheck = (req, res) => {
  res.json({
    status: "ok",
    message: "DAVID COMMUNICATIONS API is running.",
    timestamp: new Date().toISOString(),
  });
};

app.get("/", healthCheck);
app.get("/api", healthCheck);

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin/orders", adminOrdersRouter);
app.use("/api/admin/devices", deviceVerificationRouter);
app.use("/api/admin/returns", returnsRouter);
app.use("/api/customer/returns", customerReturnsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  res.status(500).json({
    error: "An unexpected server error occurred.",
  });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DAVID COMMUNICATIONS API running on port ${PORT}`);
  });
}

module.exports = app;
