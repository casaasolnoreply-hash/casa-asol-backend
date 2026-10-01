const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requireRole } = require("../middleware/authorize");
const { getData, setData } = require("../config/db");
const { translateValue, TRANSLATABLE_KEYS } = require("../services/contentTranslator");
const { isConfigured: deeplConfigured } = require("../services/deepl");

const VALID_KEYS = [
  "content", "stats", "programa", "team", "nav", "sections",
  "content_en", "content_de", "stats_en", "stats_de",
  "programa_en", "programa_de", "team_en", "team_de",
];

// Dispara en segundo plano, sin bloquear la respuesta al admin: traduce el
// valor recién guardado a EN y DE y lo deja en <key>_en / <key>_de. Si DeepL
// no está configurado o falla, solo se registra en consola — el contenido en
// español ya quedó guardado de todas formas, nunca se pierde por esto.
async function generateTranslations(key, value) {
  if (!TRANSLATABLE_KEYS.includes(key) || !deeplConfigured) return;
  for (const [targetLang, suffix] of [["EN", "en"], ["DE", "de"]]) {
    try {
      const translated = await translateValue(key, value, targetLang);
      if (translated != null) await setData(`${key}_${suffix}`, translated);
    } catch (err) {
      console.error(`[traducción] "${key}" → ${targetLang} falló:`, err.message);
    }
  }
}

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
    generateTranslations(key, req.body.value);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
