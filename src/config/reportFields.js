// ── Campos de informe por rol ──────────────────────────────────
// Fuente única de qué pide el informe de cada rol. Se guardan en
// reports.narrative (párrafos) y reports.stats (todo lo numérico:
// totales, series mensuales y listas). Agregar un rol nuevo aquí no
// requiere ninguna migración de base de datos, solo la entrada.
//
// narrativeFields: párrafos de texto libre (reports.narrative[key] = string).
// statFields:      un número total del periodo (reports.stats[key] = number).
//                  "sourceType" (opcional): tipo de attentionFields.js que
//                  autocalcula este total (COUNT de ese tipo en el periodo).
// monthlyFields:   una serie de datos dentro del periodo, con
//                  granularidad libre (día/semana/mes) elegida por
//                  quien llena el informe
//                  (reports.stats[key] = { granularity: "mensual", rows: [{ label: "Enero", value: 16 }, ...] }).
//                  "sourceType" (opcional): igual que en statFields, pero
//                  agrupado por la granularidad elegida.
// listFields:      lista de textos cortos, ej. temas de talleres
//                  (reports.stats[key] = ["Tema 1", "Tema 2", ...]).
// periodTypes:     periodicidad que puede elegir este rol al crear un informe.
// codePrefix:      prefijo del código automático de cada informe de
//                  este rol (ej. "PSI" -> PSI-0001, PSI-0002...).
//
// El botón "Calcular desde el expediente" del formulario llena estos
// campos contando los registros de attentions — pero siguen siendo
// editables a mano después, por si algo no quedó registrado ahí.

const REPORT_FIELDS = {
  psicologa: {
    codePrefix: "PSI",
    // Título y encabezado que usa el documento (Word/PDF) exportado —
    // replican el formato real que ya entrega el área (ver
    // "Informe 1 sem psicologia.docx"), por eso no siempre coinciden
    // textualmente con el label del rol.
    docTitle: "Informe Área de Psicología",
    detailSectionTitle: "Atenciones individuales y actividades",
    periodTypes: ["diario", "semanal", "mensual", "trimestral", "semestral", "anual"],
    narrativeFields: [
      { key: "resumen_general",        label: "Resumen general del periodo" },
      { key: "fortalecimiento_equipo", label: "Fortalecimiento del área de psicología (equipo, practicantes, horarios)" },
      { key: "logros",                 label: "Logros obtenidos" },
      { key: "desafios",               label: "Desafíos detectados" },
      { key: "coordinacion",           label: "Coordinación institucional" },
      { key: "conclusion",             label: "Conclusión general" },
    ],
    statFields: [
      { key: "atenciones_individuales",        label: "Atenciones individuales (total del periodo)",              sourceType: "atenciones_individuales" },
      { key: "talleres_presencial",            label: "Taller presencial",                                        sourceType: "talleres_presencial" },
      { key: "talleres_virtual",               label: "Taller virtual",                                           sourceType: "talleres_virtual" },
      { key: "talleres_padres_familia",        label: "Taller padres de familia",                                 sourceType: "talleres_padres_familia" },
      { key: "reuniones_equipo",               label: "Reunión de equipo",                                        sourceType: "reuniones_equipo" },
      { key: "reuniones_atencion_psicosocial", label: "Reuniones con adolescentes para atención psicosocial",      sourceType: "reuniones_atencion_psicosocial" },
    ],
    monthlyFields: [
      { key: "atenciones_individuales_serie", label: "Atenciones individuales por periodo", sourceType: "atenciones_individuales" },
    ],
    listFields: [
      { key: "talleres_mensuales", label: "Talleres mensuales presenciales (temas impartidos)" },
    ],
  },
};

const getReportFields = (role) => REPORT_FIELDS[role] || null;

module.exports = { REPORT_FIELDS, getReportFields };
