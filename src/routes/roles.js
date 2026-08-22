const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requireRole } = require("../middleware/authorize");
const Role   = require("../models/Role");
const { PERMISSION_KEYS } = require("../config/roles.seed");

// GET /api/roles/public — roles que se pueden elegir en el formulario
// público "Solicitar acceso" (no incluye admin/desarrollador).
router.get("/public", async (_req, res) => {
  try {
    res.json(await Role.findSelfRequestable());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/roles — lista completa con permisos, para el panel de usuarios
router.get("/", auth, requireRole("admin", "desarrollador"), async (_req, res) => {
  try {
    res.json(await Role.findAll());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/roles/:name — otorgar/quitar permisos a un rol.
// Exclusivo de desarrollador: es la única cuenta que puede decidir
// qué puede ver o hacer cada rol.
router.put("/:name", auth, requireRole("desarrollador"), async (req, res) => {
  try {
    const { name } = req.params;
    if (name === "desarrollador") {
      return res.status(400).json({ error: "El rol desarrollador no se edita: siempre tiene acceso total" });
    }

    const role = await Role.findByName(name);
    if (!role) return res.status(404).json({ error: "Rol no encontrado" });

    const incoming = req.body?.permissions;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "'permissions' debe ser un objeto" });
    }

    const permissions = {};
    for (const key of PERMISSION_KEYS) {
      if (incoming[key] !== undefined) permissions[key] = !!incoming[key];
    }

    const updated = await Role.updatePermissions(name, permissions);
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
