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

module.exports = { requireRole, requirePermission, isDeveloper };
