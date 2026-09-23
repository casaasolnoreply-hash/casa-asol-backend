require("dotenv").config();

const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const morgan    = require("morgan");
const { initDB, migrateDB, seedRoles, seedAdmin } = require("./config/db");
const { PRIVATE_KEY, PUBLIC_KEY } = require("./config/keys");

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  console.error("\n[ERROR] Faltan JWT_PRIVATE_KEY / JWT_PUBLIC_KEY en backend/.env");
  console.error("        Ver backend/.env.example para el comando que genera el par de llaves.\n");
  process.exit(1);
}

const authRoutes     = require("./routes/auth");
const dataRoutes     = require("./routes/data");
const messagesRoutes = require("./routes/messages");
const uploadRoutes   = require("./routes/upload");
const usersRoutes    = require("./routes/users");
const rolesRoutes    = require("./routes/roles");
const beneficiariesRoutes = require("./routes/beneficiaries");
const reportsRoutes       = require("./routes/reports");
const attentionsRoutes    = require("./routes/attentions");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Seguridad: cabeceras HTTP ────────────────────────────
app.use(helmet());

// ── CORS ────────────────────────────────────────────────
// Se normaliza cada origen (sin espacios, sin "/" final) para que un
// espacio o salto de línea de más al pegarlo en el dashboard del
// hosting no rompa la comparación exacta.
const normalizeOrigin = (o) => o.trim().replace(/\/+$/, "");
const allowed = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes(normalizeOrigin(origin))) return cb(null, true);
    cb(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
}));

// ── Middlewares ──────────────────────────────────────────
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

// ── Rutas ───────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/data",     dataRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/upload",   uploadRoutes);
app.use("/api/users",    usersRoutes);
app.use("/api/roles",    rolesRoutes);
app.use("/api/beneficiaries", beneficiariesRoutes);
app.use("/api/reports",       reportsRoutes);
app.use("/api/attentions",    attentionsRoutes);

// ── Health check ─────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true, env: process.env.NODE_ENV || "development" }));

// ── 404 ──────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// ── Error handler ────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || "Error interno del servidor" });
});

// ── Arranque: primero BD, luego servidor ─────────────────
let dbWasReset = false;

initDB()
  .then((didReset) => { dbWasReset = didReset; })
  .then(migrateDB)
  .then(seedRoles)
  .then(seedAdmin)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n[OK] Backend Casa ASOL corriendo en http://localhost:${PORT}`);
      console.log(`     CORS orígenes permitidos: ${JSON.stringify(allowed)}`);
      console.log(`     PostgreSQL: ${process.env.DATABASE_URL?.split("@")[1] || "no configurado"}`);
      console.log(`     Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME || "no configurado"}`);
      console.log(`     Base de datos: ${dbWasReset ? "RECIÉN RESETEADA (RESET_DB=true)" : "sin cambios (RESET_DB=false)"}`);
      console.log();
    });
  })
  .catch((err) => {
    console.error("\n[ERROR] No se pudo conectar con la base de datos:");
    console.error(`        ${err.message}`);
    console.error("        Verifica DATABASE_URL en backend/.env\n");
    process.exit(1);
  });

module.exports = app;
