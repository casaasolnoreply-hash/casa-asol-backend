const router = require("express").Router();
const auth   = require("../middleware/auth");
const Attention   = require("../models/Attention");
const Beneficiary = require("../models/Beneficiary");
const Role   = require("../models/Role");
const { getAttentionFields, ATTENTION_FIELDS } = require("../config/attentionFields");

const canSeeAll = (role) => role === "admin" || role === "desarrollador";

const validatePayload = (role, { attentionDate, type, beneficiaryId }) => {
  const config = getAttentionFields(role);
  if (!config) return { error: `El rol "${role}" todavía no tiene expediente de atenciones configurado` };
  if (!attentionDate || isNaN(Date.parse(attentionDate))) return { error: "attentionDate es obligatoria y debe ser una fecha válida" };

  const typeDef = config.types.find((t) => t.key === type);
  if (!typeDef) return { error: "Tipo de atención inválido para este rol" };
  if (typeDef.requiresBeneficiary && !beneficiaryId) {
    return { error: `"${typeDef.label}" necesita elegir un estudiante` };
  }
  return null;
};

// GET /api/attentions/available-roles — qué roles llevan expediente
router.get("/available-roles", auth, async (req, res) => {
  try {
    const roles = await Role.findAll();
    const configured = Object.keys(ATTENTION_FIELDS);
    res.json(roles.filter((r) => configured.includes(r.name)).map((r) => ({ name: r.name, label: r.label })));
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
    const role = canSeeAll(req.admin.role) ? (req.query.role || req.admin.role) : req.admin.role;
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
    const role = canSeeAll(req.admin.role) ? (req.query.role || undefined) : req.admin.role;
    const beneficiaryId = req.query.beneficiaryId ? parseInt(req.query.beneficiaryId, 10) : undefined;
    res.json(await Attention.findAll({ role, beneficiaryId }));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/attentions
router.post("/", auth, async (req, res) => {
  try {
    const role = canSeeAll(req.admin.role) && req.body.role ? req.body.role : req.admin.role;
    const beneficiaryId = req.body.beneficiaryId ? parseInt(req.body.beneficiaryId, 10) : null;

    const err = validatePayload(role, { ...req.body, beneficiaryId });
    if (err) return res.status(400).json(err);

    if (beneficiaryId) {
      const beneficiary = await Beneficiary.findById(beneficiaryId);
      if (!beneficiary) return res.status(404).json({ error: "Estudiante no encontrado" });
    }

    const created = await Attention.create({
      beneficiaryId, role, authorId: req.admin.id,
      attentionDate: req.body.attentionDate, type: req.body.type, notes: req.body.notes,
      images: Array.isArray(req.body.images) ? req.body.images : [],
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
    if (existing.author_id !== req.admin.id && !canSeeAll(req.admin.role)) {
      return res.status(403).json({ error: "No puedes editar la atención de otra persona" });
    }

    const err = validatePayload(existing.role, {
      attentionDate: req.body.attentionDate || existing.attention_date,
      type: req.body.type || existing.type,
      beneficiaryId: existing.beneficiary_id,
    });
    if (err) return res.status(400).json(err);

    res.json(await Attention.update(id, req.body));
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
    if (existing.author_id !== req.admin.id && !canSeeAll(req.admin.role)) {
      return res.status(403).json({ error: "No puedes eliminar la atención de otra persona" });
    }

    await Attention.remove(id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
