const router = require("express").Router();
const auth   = require("../middleware/auth");
const Attention   = require("../models/Attention");
const Beneficiary = require("../models/Beneficiary");
const Role   = require("../models/Role");
const {
  getAttentionFields, getConfiguredRoleNames, getCustomTypes, setCustomTypes, getKnownCategoryNames, getBuiltinKeys,
} = require("../config/attentionFields");
const { setData } = require("../config/db");
const { getScope, requireScoped, requirePermission } = require("../middleware/authorize");

// Antes esto era admin/desarrollador nada más. Ahora es el permiso
// "verImagenes" (ver config/roles.seed.js): quién puede ver/filtrar
// actividades e imágenes de OTROS roles, con el mismo alcance
// todos/algunos/ninguno que el resto de permisos escalables.
const canSeeRole = (scope, role) => scope === "all" || (Array.isArray(scope) && scope.includes(role));
const canCreate  = requireScoped("crearActividades");
const canManageTypes = requirePermission("gestionarTiposActividad");

const VALID_KEY = /^[a-z0-9_]+$/;

// Valida la forma de los tipos personalizados que manda el panel:
// arreglo plano de { categoryName, key, label, requiresBeneficiary }.
// `categoryName` no se valida contra nada más — si coincide con una
// categoría existente se suma ahí, si no, crea una nueva (ver
// attentionFields.js).
const validateCustomTypes = (items) => {
  if (!Array.isArray(items)) return "Debe ser una lista de tipos";
  const seenKeys = new Set();
  for (const t of items) {
    if (!t || typeof t.categoryName !== "string" || !t.categoryName.trim()) return "Cada tipo necesita una categoría";
    if (!t || typeof t.key !== "string" || !VALID_KEY.test(t.key)) {
      return `Llave inválida: "${t?.key}" (solo minúsculas, números y guion bajo)`;
    }
    if (typeof t.label !== "string" || !t.label.trim()) return `El tipo "${t.key}" necesita una etiqueta`;
    if (seenKeys.has(t.key)) return `La llave "${t.key}" está repetida`;
    if (getBuiltinKeys().has(t.key)) return `La llave "${t.key}" ya existe en un tipo del sistema`;
    seenKeys.add(t.key);
  }
  return null;
};

const validatePayload = (role, { attentionDate, type, beneficiaryId, participants }) => {
  const config = getAttentionFields(role);
  if (!config) return { error: `El rol "${role}" todavía no tiene expediente de atenciones configurado` };
  if (!attentionDate || isNaN(Date.parse(attentionDate))) return { error: "attentionDate es obligatoria y debe ser una fecha válida" };

  const typeDef = config.types.find((t) => t.key === type);
  if (!typeDef) return { error: "Tipo de atención inválido para este rol" };
  if (typeDef.requiresBeneficiary && !beneficiaryId && !participants?.length) {
    return { error: `"${typeDef.label}" necesita por lo menos un integrante` };
  }
  return null;
};

// Normaliza la lista de integrantes que manda el formulario: cada uno
// es un estudiante registrado ({ beneficiaryId }) o una persona suelta
// ({ fullName }) — nunca ambos, nunca ninguno.
const sanitizeParticipants = (raw) => {
  if (!Array.isArray(raw)) return { error: null, participants: undefined };
  const participants = [];
  for (const item of raw) {
    const beneficiaryId = item?.beneficiaryId ? parseInt(item.beneficiaryId, 10) : null;
    const fullName = typeof item?.fullName === "string" ? item.fullName.trim() : "";
    if (beneficiaryId) { participants.push({ beneficiaryId }); continue; }
    if (fullName) { participants.push({ fullName }); continue; }
    return { error: "Cada integrante necesita un estudiante o un nombre", participants: undefined };
  }
  return { error: null, participants };
};

// GET /api/attentions/custom-types — tipos de actividad agregados desde
// el panel (además de los que ya traía el código). Cualquier cuenta
// autenticada puede leerlos (los necesita para armar el selector), pero
// solo quien tenga "gestionarTiposActividad" puede guardarlos.
router.get("/custom-types", auth, (_req, res) => {
  res.json(getCustomTypes());
});

// GET /api/attentions/category-names — nombres de categoría ya usados
// (de código o personalizados), para sugerir en el panel al agregar un
// tipo nuevo.
router.get("/category-names", auth, (_req, res) => {
  res.json(getKnownCategoryNames());
});

// PUT /api/attentions/custom-types — reemplaza la lista completa de
// tipos personalizados (agregar, editar o borrar es mandar la lista ya
// modificada). No permite tocar los tipos que ya traía el código (ver
// validateCustomTypes / getBuiltinKeys).
router.put("/custom-types", auth, canManageTypes, async (req, res) => {
  try {
    const err = validateCustomTypes(req.body.types);
    if (err) return res.status(400).json({ error: err });

    await setData("activityCustomCategories", req.body.types);
    setCustomTypes(req.body.types);
    res.json(getCustomTypes());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/attentions/available-roles — qué roles llevan expediente,
// recortado al alcance de "verImagenes" del rol que consulta (más su
// propio rol, que siempre puede ver).
router.get("/available-roles", auth, async (req, res) => {
  try {
    const scope = await getScope(req, "verImagenes");
    const roles = await Role.findAll();
    const configured = getConfiguredRoleNames();
    res.json(
      roles
        .filter((r) => configured.includes(r.name))
        .filter((r) => r.name === req.admin.role || canSeeRole(scope, r.name))
        .map((r) => ({ name: r.name, label: r.label }))
    );
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/attentions/config/:role — tipos de atención de ese rol
router.get("/config/:role", auth, (req, res) => {
  const config = getAttentionFields(req.params.role);
  if (!config) return res.status(404).json({ error: "Este rol no tiene expediente configurado todavía" });
  res.json(config);
});

// GET /api/attentions/summary?role=&periodStart=&periodEnd=&granularity=
// Conteo por tipo (para autocalcular reports.statFields) y series
// agrupadas por día/semana/mes (para reports.monthlyFields). Ver
// reportFields.js — cada statField/monthlyField declara qué "sourceType"
// de aquí le corresponde.
router.get("/summary", auth, async (req, res) => {
  try {
    const scope = await getScope(req, "verImagenes");
    const role = req.query.role && canSeeRole(scope, req.query.role) ? req.query.role : req.admin.role;
    if (!getAttentionFields(role)) return res.status(404).json({ error: "Este rol no tiene expediente configurado todavía" });

    const { periodStart, periodEnd } = req.query;
    if (!periodStart || !periodEnd || isNaN(Date.parse(periodStart)) || isNaN(Date.parse(periodEnd))) {
      return res.status(400).json({ error: "periodStart y periodEnd son obligatorios y deben ser fechas válidas" });
    }
    const granularity = ["diario", "semanal", "mensual"].includes(req.query.granularity) ? req.query.granularity : "mensual";

    res.json(await Attention.summary(role, periodStart, periodEnd, granularity));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/attentions?beneficiaryId=X&role=Y — notas clínicas: cada
// rol solo ve las suyas (o las que pida explícitamente si es
// admin/desarrollador). No es un dato abierto como el catálogo base
// de estudiantes.
router.get("/", auth, async (req, res) => {
  try {
    const scope = await getScope(req, "verImagenes");
    const beneficiaryId = req.query.beneficiaryId ? parseInt(req.query.beneficiaryId, 10) : undefined;
    let filters;
    if (scope === "all") {
      filters = { role: req.query.role || undefined, beneficiaryId };
    } else if (Array.isArray(scope) && scope.length) {
      const roles = [...new Set([req.admin.role, ...scope])];
      filters = req.query.role && roles.includes(req.query.role)
        ? { role: req.query.role, beneficiaryId }
        : { roleIn: roles, beneficiaryId };
    } else {
      filters = { role: req.admin.role, beneficiaryId };
    }
    res.json(await Attention.findAll(filters));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/attentions
router.post("/", auth, canCreate, async (req, res) => {
  try {
    const scope = await getScope(req, "verImagenes");
    const role = req.body.role && canSeeRole(scope, req.body.role) ? req.body.role : req.admin.role;
    const beneficiaryId = req.body.beneficiaryId ? parseInt(req.body.beneficiaryId, 10) : null;

    const { error: participantsError, participants } = sanitizeParticipants(req.body.participants);
    if (participantsError) return res.status(400).json({ error: participantsError });

    const err = validatePayload(role, { ...req.body, beneficiaryId, participants });
    if (err) return res.status(400).json(err);

    if (beneficiaryId) {
      const beneficiary = await Beneficiary.findById(beneficiaryId);
      if (!beneficiary) return res.status(404).json({ error: "Estudiante no encontrado" });
    }
    for (const p of participants || []) {
      if (!p.beneficiaryId) continue;
      const beneficiary = await Beneficiary.findById(p.beneficiaryId);
      if (!beneficiary) return res.status(404).json({ error: "Uno de los estudiantes elegidos no existe" });
    }

    const created = await Attention.create({
      beneficiaryId, role, authorId: req.admin.id,
      attentionDate: req.body.attentionDate, type: req.body.type, notes: req.body.notes,
      images: Array.isArray(req.body.images) ? req.body.images : [],
      participants,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/attentions/:id — solo el autor o admin/desarrollador
router.put("/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Attention.findById(id);
    if (!existing) return res.status(404).json({ error: "Atención no encontrada" });
    if (existing.author_id !== req.admin.id && !canSeeRole(await getScope(req, "verImagenes"), existing.role)) {
      return res.status(403).json({ error: "No puedes editar la atención de otra persona" });
    }

    const { error: participantsError, participants } = sanitizeParticipants(req.body.participants);
    if (participantsError) return res.status(400).json({ error: participantsError });

    const err = validatePayload(existing.role, {
      attentionDate: req.body.attentionDate || existing.attention_date,
      type: req.body.type || existing.type,
      beneficiaryId: existing.beneficiary_id,
      participants: participants ?? existing.participants,
    });
    if (err) return res.status(400).json(err);

    for (const p of participants || []) {
      if (!p.beneficiaryId) continue;
      const beneficiary = await Beneficiary.findById(p.beneficiaryId);
      if (!beneficiary) return res.status(404).json({ error: "Uno de los estudiantes elegidos no existe" });
    }

    res.json(await Attention.update(id, { ...req.body, participants }));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// DELETE /api/attentions/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Attention.findById(id);
    if (!existing) return res.status(404).json({ error: "Atención no encontrada" });
    if (existing.author_id !== req.admin.id && !canSeeRole(await getScope(req, "verImagenes"), existing.role)) {
      return res.status(403).json({ error: "No puedes eliminar la atención de otra persona" });
    }

    await Attention.remove(id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
