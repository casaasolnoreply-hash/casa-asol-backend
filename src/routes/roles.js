const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requireRole } = require("../middleware/authorize");
const Role   = require("../models/Role");
const { getData, setData } = require("../config/db");
const { ROLE_DEFINITIONS, PERMISSION_KEYS, SCOPED_PERMISSION_KEYS, OPERATIONAL_DEFAULTS } = require("../config/roles.seed");
const attentionFields = require("../config/attentionFields");
const reportFields     = require("../config/reportFields");

const FIXED_ROLE_NAMES = new Set(ROLE_DEFINITIONS.map((r) => r.name));
const VALID_ROLE_NAME = /^[a-z][a-z0-9_]{1,29}$/;

// El nombre interno (name) se deriva del label si no se manda uno
// explícito — mismo criterio que slugify() en ActivityTypesTab.jsx.
const slugify = (text) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// GET /api/roles/public — roles que se pueden elegir en el formulario
// público "Solicitar acceso" (no incluye admin/desarrollador).
router.get("/public", async (_req, res) => {
  try {
    res.json(await Role.findSelfRequestable());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/roles — lista completa con permisos, para el panel de usuarios.
// "removable" (calculado, no se guarda) marca los roles creados desde
// el panel — los de fábrica (ROLE_DEFINITIONS) nunca se pueden borrar.
router.get("/", auth, requireRole("admin", "desarrollador"), async (_req, res) => {
  try {
    const roles = await Role.findAll();
    res.json(roles.map((r) => ({ ...r, removable: !FIXED_ROLE_NAMES.has(r.name) })));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/roles — crea un rol nuevo, operativo completo: permisos
// normales (mismo default que cualquier rol operativo simple),
// Actividades (categorías compartidas) e Informes (plantilla
// genérica) — ver attentionFields.js/reportFields.js "dynamicRoles".
// Exclusivo de desarrollador, igual que PUT.
router.post("/", auth, requireRole("desarrollador"), async (req, res) => {
  try {
    const label = (req.body?.label || "").trim();
    if (!label) return res.status(400).json({ error: "El rol necesita una etiqueta" });

    const name = (req.body?.name || "").trim().toLowerCase() || slugify(label);
    const description = (req.body?.description || "").trim();
    const selfRequestable = !!req.body?.selfRequestable;

    if (!VALID_ROLE_NAME.test(name)) {
      return res.status(400).json({ error: "No se pudo generar un nombre interno válido a partir de esa etiqueta — usa letras y números" });
    }
    if (FIXED_ROLE_NAMES.has(name) || await Role.exists(name)) {
      return res.status(400).json({ error: `Ya existe un rol con el nombre interno "${name}"` });
    }

    let codePrefix = (req.body?.codePrefix || "").trim().toUpperCase();
    const usedPrefixes = new Set(reportFields.getUsedCodePrefixes().filter(Boolean));
    if (codePrefix) {
      if (!/^[A-Z]{2,5}$/.test(codePrefix)) {
        return res.status(400).json({ error: "El prefijo debe tener de 2 a 5 letras" });
      }
      if (usedPrefixes.has(codePrefix)) {
        return res.status(400).json({ error: `El prefijo "${codePrefix}" ya lo usa otro rol` });
      }
    } else {
      const base = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "ROL";
      codePrefix = base;
      let n = 2;
      while (usedPrefixes.has(codePrefix)) { codePrefix = `${base}${n}`; n++; }
    }

    const role = await Role.create({ name, label, description, permissions: OPERATIONAL_DEFAULTS, selfRequestable });

    const prefixes = (await getData("roleCodePrefixes")) || {};
    prefixes[name] = codePrefix;
    await setData("roleCodePrefixes", prefixes);

    attentionFields.addDynamicRole({ name, label });
    reportFields.addDynamicRole({ name, label, codePrefix });

    res.status(201).json({ ...role, removable: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// DELETE /api/roles/:name — solo roles creados desde el panel (nunca
// los de fábrica) y solo si ninguna cuenta lo tiene asignado.
router.delete("/:name", auth, requireRole("desarrollador"), async (req, res) => {
  try {
    const { name } = req.params;
    if (FIXED_ROLE_NAMES.has(name)) {
      return res.status(400).json({ error: "Este rol viene con el sistema y no se puede eliminar" });
    }
    if (!(await Role.exists(name))) return res.status(404).json({ error: "Rol no encontrado" });

    const userCount = await Role.countUsers(name);
    if (userCount > 0) {
      return res.status(409).json({ error: `Hay ${userCount} cuenta(s) con este rol — reasígnalas antes de eliminarlo` });
    }

    await Role.remove(name);
    attentionFields.removeDynamicRole(name);
    reportFields.removeDynamicRole(name);

    const prefixes = (await getData("roleCodePrefixes")) || {};
    delete prefixes[name];
    await setData("roleCodePrefixes", prefixes);

    res.json({ ok: true });
  } catch (err) {
    // Violación de llave foránea: quedan actividades o informes
    // guardados con este rol (attentions.role/reports.role), o ya se
    // generó al menos un código de informe (report_sequences nunca se
    // borra, para no reutilizar un número — ver schema.js) — en
    // cualquier caso, hay historial real detrás de este rol.
    if (err.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: este rol ya tiene actividades, informes o códigos de informe generados" });
    }
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
    // Escalables: true (todos), false (ninguno) o un arreglo de
    // nombres de rol (algunos) — a diferencia de los de arriba, NO
    // se fuerzan a booleano porque un arreglo es un valor válido.
    for (const key of SCOPED_PERMISSION_KEYS) {
      const v = incoming[key];
      if (v === undefined) continue;
      if (typeof v === "boolean") permissions[key] = v;
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) permissions[key] = v;
    }

    const updated = await Role.updatePermissions(name, permissions);
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
