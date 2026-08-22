const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requireRole } = require("../middleware/authorize");
const { getData, setData } = require("../config/db");

const VALID_KEYS = ["content", "stats", "programa", "team", "nav", "sections"];

// GET /api/data/:key  — lectura pública
router.get("/:key", async (req, res) => {
  try {
    const { key } = req.params;
    if (!VALID_KEYS.includes(key)) {
      return res.status(400).json({ error: "Clave no válida" });
    }
    const value = await getData(key);
    res.json({ key, value });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/data/:key  — editar contenido del sitio: solo desarrollador
router.put("/:key", auth, requireRole("desarrollador"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!VALID_KEYS.includes(key)) {
      return res.status(400).json({ error: "Clave no válida" });
    }
    if (req.body.value === undefined) {
      return res.status(400).json({ error: "Campo 'value' requerido" });
    }
    await setData(key, req.body.value);
    res.json({ ok: true, key });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
