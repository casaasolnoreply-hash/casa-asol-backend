const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { pool } = require("../config/db");

const canViewMessages = requirePermission("viewMessages");

// GET /api/messages  — requiere permiso "viewMessages" (lo otorga desarrollador)
router.get("/", auth, canViewMessages, async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM messages ORDER BY date DESC");
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/messages  — público (formularios de contacto y voluntariado)
router.post("/", async (req, res) => {
  try {
    const { type, name, email, subject, phone, area, message } = req.body;

    if (!type || !name || !email) {
      return res.status(400).json({ error: "type, name y email son obligatorios" });
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (type, name, email, subject, phone, area, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [type, name, email, subject || null, phone || null, area || null, message || null]
    );

    res.status(201).json({ id: rows[0].id });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/messages/:id/read
router.put("/:id/read", auth, canViewMessages, async (req, res) => {
  try {
    await pool.query("UPDATE messages SET read = TRUE WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/messages/read-all
router.put("/read-all", auth, canViewMessages, async (_req, res) => {
  try {
    await pool.query("UPDATE messages SET read = TRUE");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// DELETE /api/messages/:id
router.delete("/:id", auth, canViewMessages, async (req, res) => {
  try {
    await pool.query("DELETE FROM messages WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
