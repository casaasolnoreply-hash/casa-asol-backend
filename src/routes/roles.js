const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requirePermission, isDeveloper } = require("../middleware/authorize");
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

// Cualquiera de los permisos que necesita ver la lista de roles: quien
// gestiona roles en sí, quien gestiona usuarios (selector de "Nuevo
// usuario") y quien solo VE usuarios (necesita la etiqueta del rol de
// cada cuenta, aunque sea en modo solo lectura) — por eso esta ruta
// acepta cualquiera de los tres, no solo "gestionarRoles" como el
// resto de este archivo.
const canSeeRoles = async (req, res, next) => {
  if (isDeveloper(req)) return next();
  try {
    const role = await Role.findByName(req.admin?.role);
    if (role?.permissions?.manageUsers || role?.permissions?.gestionarRoles || role?.permissions?.verUsuarios) return next();
    return res.status(403).json({ error: "No tienes permiso para esta acción" });
  } catch {
    return res.status(500).json({ error: "Error del servidor" });
  }
};

// GET /api/roles/public — roles que se pueden elegir en el formulario
// público "Solicitar acceso" (no incluye admin/desarrollador).
router.get("/public", async (_req, res) => {
  try {
    res.json(await Role.findSelfRequestable());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/roles — lista completa con permisos, para el panel de
// usuarios y el de roles. "removable" (calculado, no se guarda) marca
// qué roles se pueden borrar desde el panel — cualquiera menos
// "desarrollador", que siempre tiene acceso total y nunca se toca.
router.get("/", auth, canSeeRoles, async (req, res) => {
  try {
    const roles = await Role.findAll();
    // "desarrollador" nunca aparece para nadie más que otra cuenta
    // desarrollador — oculto por completo, igual que en GET /api/users.
    const visible = isDeveloper(req) ? roles : roles.filter((r) => r.name !== "desarrollador");
    res.json(visible.map((r) => ({ ...r, removable: r.name !== "desarrollador" })));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/roles — crea un rol nuevo, operativo completo: permisos
// normales (mismo default que cualquier rol operativo simple),
// Actividades (categorías compartidas) e Informes (plantilla
// genérica) — ver attentionFields.js/reportFields.js "dynamicRoles".
// Requiere "gestionarRoles", igual que PUT.
router.post("/", auth, requirePermission("gestionarRoles"), async (req, res) => {
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

// DELETE /api/roles/:name — cualquier rol menos "desarrollador" (acceso
// total, nunca se borra) y solo si ninguna cuenta lo tiene asignado.
// Incluye los roles de fábrica (ROLE_DEFINITIONS): si se borra uno,
// Role.markDeleted lo registra en deleted_roles para que seedRoles()
// no lo vuelva a crear en el próximo arranque.
router.delete("/:name", auth, requirePermission("gestionarRoles"), async (req, res) => {
  try {
    const { name } = req.params;
    if (name === "desarrollador") {
      return res.status(400).json({ error: "El rol desarrollador no se puede eliminar: siempre tiene acceso total" });
    }
    if (!(await Role.exists(name))) return res.status(404).json({ error: "Rol no encontrado" });

    const userCount = await Role.countUsers(name);
    if (userCount > 0) {
      return res.status(409).json({ error: `Hay ${userCount} cuenta(s) con este rol — reasígnalas antes de eliminarlo` });
    }

    await Role.remove(name);
    await Role.markDeleted(name);
    attentionFields.removeDynamicRole(name);
    reportFields.removeDynamicRole(name);

    const prefixes = (await getData("roleCodePrefixes")) || {};
    delete prefixes[name];
    await setData("roleCodePrefixes", prefixes);

    res.json({ ok: true });
  } catch (err) {
    // Violación de llave foránea: queda historial real detrás de este
    // rol (actividades, informes, códigos de informe generados —
    // report_sequences nunca se borra, ver schema.js — o solicitudes
    // de acceso que lo pidieron).
    if (err.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: este rol ya tiene historial asociado (actividades, informes o solicitudes de acceso)" });
    }
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/roles/:name — otorgar/quitar permisos y/o cambiar la
// etiqueta/descripción de un rol. Requiere "gestionarRoles"
// (desarrollador siempre lo tiene por fullAccess) — el rol
// "desarrollador" en sí nunca se edita, siempre tiene acceso total.
router.put("/:name", auth, requirePermission("gestionarRoles"), async (req, res) => {
  try {
    const { name } = req.params;
    if (name === "desarrollador") {
      return res.status(400).json({ error: "El rol desarrollador no se edita: siempre tiene acceso total" });
    }

    const role = await Role.findByName(name);
    if (!role) return res.status(404).json({ error: "Rol no encontrado" });

    let updated = role;

    if (req.body?.label !== undefined || req.body?.description !== undefined) {
      const label = req.body.label !== undefined ? req.body.label.trim() : role.label;
      if (!label) return res.status(400).json({ error: "El rol necesita una etiqueta" });
      const description = req.body.description !== undefined ? req.body.description.trim() : role.description;
      updated = await Role.updateLabel(name, label, description);
    }

    if (req.body?.permissions !== undefined) {
      const incoming = req.body.permissions;
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

      updated = await Role.updatePermissions(name, permissions);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
