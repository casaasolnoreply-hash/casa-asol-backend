const Role = require("../models/Role");

// "desarrollador" siempre tiene acceso total: pasa cualquier chequeo
// de rol o permiso sin necesidad de estar en la lista.
const isDeveloper = (req) => req.admin?.role === "desarrollador";

// requireRole("admin", "directora_tecnica", ...) — exige que el rol
// del token esté en la lista (o que sea desarrollador).
const requireRole = (...allowed) => (req, res, next) => {
  if (isDeveloper(req) || allowed.includes(req.admin?.role)) return next();
  return res.status(403).json({ error: "No tienes permiso para esta acción" });
};

// requirePermission("manageUsers") — exige que el rol tenga esa
// llave en `permissions` (ver config/roles.seed.js), o que sea
// desarrollador.
const requirePermission = (key) => async (req, res, next) => {
  if (isDeveloper(req)) return next();
  try {
    const role = await Role.findByName(req.admin?.role);
    if (role?.permissions?.[key]) return next();
    return res.status(403).json({ error: "No tienes permiso para esta acción" });
  } catch {
    return res.status(500).json({ error: "Error del servidor" });
  }
};

// ── Permisos "escalables" (ver SCOPED_PERMISSION_KEYS en
// config/roles.seed.js) ──────────────────────────────────────────
// El valor guardado en permissions[key] puede ser:
//   true          → "all"  (ve/actúa sobre todos los roles)
//   false/ausente → "none" (solo lo propio, nada de otros roles)
//   ["rolA","rolB"] → esos roles en concreto
// scopeValue() normaliza esos tres casos a un resultado uniforme
// que las rutas usan para filtrar sus consultas.
const scopeValue = (permissions, key) => {
  const v = permissions?.[key];
  if (v === true) return "all";
  if (Array.isArray(v)) return v;
  return "none";
};

// Para rutas que necesitan el alcance de un permiso escalable sin
// bloquear la petición ellas mismas (p.ej. para decidir qué roles
// incluir en una consulta). desarrollador y admin ven "all" siempre
// — admin lo tiene sembrado explícito en roles.seed.js, así que esto
// solo es un atajo para desarrollador.
const getScope = async (req, key) => {
  if (isDeveloper(req)) return "all";
  const role = await Role.findByName(req.admin?.role);
  return scopeValue(role?.permissions, key);
};

// requireScoped("verInformes") — deja pasar si el alcance no es
// "none" (es decir, "all" o una lista con al menos un rol), y deja
// el resultado en req.permScope[key] para que la ruta filtre según
// corresponda. Bloquea solo cuando el alcance es realmente "none".
const requireScoped = (key) => async (req, res, next) => {
  const scope = await getScope(req, key).catch(() => null);
  if (scope === null) return res.status(500).json({ error: "Error del servidor" });
  if (scope === "none") return res.status(403).json({ error: "No tienes permiso para esta acción" });
  req.permScope = { ...(req.permScope || {}), [key]: scope };
  return next();
};

module.exports = { requireRole, requirePermission, isDeveloper, scopeValue, getScope, requireScoped };
