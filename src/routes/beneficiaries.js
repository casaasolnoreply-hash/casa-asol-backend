const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const Beneficiary = require("../models/Beneficiary");

const canManage = requirePermission("manageBeneficiaries");

// GET /api/beneficiaries — cualquier cuenta activa (uso interno, no público)
router.get("/", auth, async (req, res) => {
  try {
    const { status } = req.query;
    res.json(await Beneficiary.findAll({ status }));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/beneficiaries — requiere permiso "manageBeneficiaries"
router.post("/", auth, canManage, async (req, res) => {
  try {
    const { fullName, birthDate, school, gradeLevel, admissionDate, notes } = req.body;
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      return res.status(400).json({ error: "El nombre completo es obligatorio" });
    }
    const created = await Beneficiary.create({
      fullName, birthDate, school, gradeLevel, admissionDate, notes,
      createdBy: req.admin.id,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/beneficiaries/:id
router.put("/:id", auth, canManage, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const VALID_STATUS = ["activo", "egresado", "retirado"];
    if (req.body.status !== undefined && !VALID_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: "Estado inválido" });
    }

    const updated = await Beneficiary.update(id, req.body);
    if (!updated) return res.status(404).json({ error: "No encontrado" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// DELETE /api/beneficiaries/:id
router.delete("/:id", auth, canManage, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });
    const ok = await Beneficiary.remove(id);
    if (!ok) return res.status(404).json({ error: "No encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
