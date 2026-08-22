const jwt  = require("jsonwebtoken");
const { PUBLIC_KEY } = require("../config/keys");
const User = require("../models/User");

// Rutas permitidas aunque el usuario tenga mustChangePassword=true —
// necesita poder ver quién es y cambiar su contraseña antes de que
// se le habilite el resto de la aplicación.
const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = ["/api/auth/me", "/api/auth/profile"];

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" });
  }

  const token = header.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"] });
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  // El token solo prueba "quién firmó esto en algún momento" — el
  // estado real (¿sigue activo?, ¿le cambiaron el rol?) se revisa
  // contra la base en cada request. Así, desactivar una cuenta o
  // cambiarle el rol surte efecto de inmediato, no hasta que el
  // token expire (hasta 8h después) ni depende de que el usuario
  // vuelva a cargar /me.
  try {
    const user = await User.findById(decoded.id);
    if (!user || !user.active) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    const path = req.originalUrl.split("?")[0];
    if (user.must_change_password && !ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.includes(path)) {
      return res.status(403).json({ error: "Debes cambiar tu contraseña antes de continuar", code: "PASSWORD_CHANGE_REQUIRED" });
    }

    req.admin = { id: user.id, user: user.username, role: user.role, mustChangePassword: user.must_change_password };
    next();
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
};
