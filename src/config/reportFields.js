// ── Campos de informe por rol ──────────────────────────────────
// Fuente única de qué pide el informe de cada rol. Se guardan en
// reports.narrative (párrafos) y reports.stats (todo lo numérico:
// totales, series mensuales y listas). Agregar un rol nuevo aquí no
// requiere ninguna migración de base de datos, solo la entrada.
//
// narrativeFields: árbol de secciones del documento, EN EL ORDEN real
//   en que aparecen. Cada nodo es uno de:
//     { kind: "intro",   key, label }  -> párrafo corrido sin numerar,
//                                          antes de todo (ej. resumen general).
//     { kind: "closing", key, label }  -> párrafo corrido sin numerar,
//                                          al final (ej. conclusión).
//     { kind: "section", ..., fields } -> un bloque con encabezado.
//       "fields": uno o más { key, label, fields? } — si un section
//         trae MÁS DE UN field, cada uno sale con su propio
//         sub-encabezado en negrita debajo del título de la sección
//         (y un field puede a su vez traer su propio "fields" anidado,
//         un nivel más, para un caso como "Reforzamientos académicos"
//         con Inglés/Matemáticas/... cada uno con su encabezado).
//       "number": identificador FIJO que se muestra tal cual (puede
//         ser texto, ej. "2.3") — nunca se recalcula.
//       "groupBase" (en vez de "number"): agrupa esta sección con las
//         siguientes que compartan el mismo groupBase en una
//         numeración 1,2,3... que se corre sola si a alguna le falta
//         contenido (para no dejar huecos) — así el documento real de
//         psicología, que salta del "2" al "5" porque el "3" y "4" no
//         existen como sección propia, queda igual si todo está
//         lleno, pero no deja un número huérfano si algo falta.
//       "isDetail": true marca dónde va el bloque especial de
//         atenciones+talleres armado desde monthlyFields/listFields
//         (solo tiene sentido si el rol los define) — no es un field
//         de texto libre, se arma solo con los datos numéricos.
//
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
      { kind: "intro", key: "resumen_general", label: "Resumen general del periodo" },
      {
        kind: "section", groupBase: 1, bulleted: true,
        fields: [{ key: "fortalecimiento_equipo", label: "Fortalecimiento del área de psicología (equipo, practicantes, horarios)" }],
      },
      { kind: "section", groupBase: 1, isDetail: true },
      {
        kind: "section", groupBase: 5, bulleted: true,
        fields: [{ key: "desafios", label: "Desafíos detectados" }],
      },
      {
        kind: "section", groupBase: 5, bulleted: true,
        fields: [{ key: "logros", label: "Logros obtenidos" }],
      },
      {
        kind: "section", groupBase: 5, bulleted: true,
        fields: [{ key: "coordinacion", label: "Coordinación institucional" }],
      },
      { kind: "closing", key: "conclusion", label: "Conclusión general" },
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

  tutora: {
    codePrefix: "TUT",
    docTitle: "Informe Área de Tutoría",
    // El área de tutoría entrega su informe con esta numeración
    // exacta (ver "Area de tutoría.docx") — son identificadores fijos
    // de su propio formato, no se recalculan.
    periodTypes: ["diario", "semanal", "mensual", "trimestral", "semestral", "anual"],
    narrativeFields: [
      {
        kind: "section", number: "2.3",
        label: "Apoyo académico y apoyo complementario para educación o formación externa",
        fields: [
          { key: "cv",    label: "Realización de curriculum vitae" },
          { key: "becas", label: "Solicitud de becas universitarias" },
          { key: "usac",  label: "Realización de proceso para ingresar a la universidad pública (USAC)" },
        ],
      },
      {
        kind: "section", number: "2.5",
        label: "Implementación de un programa de formación para el desarrollo personal",
        fields: [
          { key: "tutoria_tareas", label: "Tutoría de tareas" },
          {
            key: "reforzamientos", label: "Reforzamientos académicos",
            fields: [
              { key: "refuerzo_ingles",        label: "Inglés" },
              { key: "refuerzo_matematicas",   label: "Matemáticas" },
              { key: "refuerzo_contabilidad",  label: "Contabilidad" },
              { key: "refuerzo_lectura",       label: "Lectura" },
            ],
          },
        ],
      },
    ],
    statFields: [],
  },

  cocinera: {
    codePrefix: "COC",
    docTitle: "Informe Área de Cocina y Alimentación",
    // Numeración fija del marco lógico de la organización (ver
    // "Formato insumos informe 1 semestre 2026- Elia- Estefany.docx")
    // — R2.1 es el código que le corresponde a esta área
    // específicamente, igual que tutoría usa 2.3 y 2.5. El curso de
    // panadería (2.8) y la beca del taller de panadería (1.3) son de
    // "panadera" (rol aparte — ver roles.seed.js: "Preparación de pan
    // y documentación del curso de panadería"), no de cocinera
    // ("Compra de víveres y preparación de alimentos").
    periodTypes: ["diario", "semanal", "mensual", "trimestral", "semestral", "anual"],
    narrativeFields: [
      {
        kind: "section", number: "2.1",
        fields: [{ key: "plan_nutricional", label: "Contribución a la compra de alimentos para una nutrición fresca, nutritiva y equilibrada — plan nutricional" }],
      },
    ],
    statFields: [],
  },

  panadera: {
    codePrefix: "PAN",
    docTitle: "Informe Área de Panadería",
    // Mismo documento fuente que cocinera — estos dos códigos son los
    // que corresponden a panadería específicamente, no a cocina.
    periodTypes: ["diario", "semanal", "mensual", "trimestral", "semestral", "anual"],
    narrativeFields: [
      {
        kind: "section", number: "1.3",
        fields: [{ key: "beca_integracion_laboral", label: "Apoyo a una joven con una beca para la integración laboral en el taller protegido de panadería" }],
      },
      {
        kind: "section", number: "2.8",
        fields: [{ key: "curso_panaderia", label: "Implementación de un curso de panadería para jóvenes" }],
      },
    ],
    statFields: [],
  },

  trabajadora_social: {
    codePrefix: "TS",
    docTitle: "Informe Área de Trabajo Social",
    // A2.7 y A2.8 del documento maestro, con la estructura real de
    // "RESUMEN RED2026.docx" (confirma que sí le corresponden a esta
    // área: coincide con su descripción en roles.seed.js — "talleres
    // MAPAF, coordinación interinstitucional"). "Curso de
    // computación" y "Salidas y visitas" no se agregan todavía: el
    // primero no tiene un código propio claro en el marco lógico, y
    // del segundo no hay texto real que revise.
    periodTypes: ["diario", "semanal", "mensual", "trimestral", "semestral", "anual"],
    narrativeFields: [
      {
        kind: "section", number: "2.7",
        label: "Formación de padres o tutores para fortalecer el sistema de referencia familiar y social de los jóvenes",
        fields: [
          { key: "talleres_mapaf",      label: "Talleres realizados con MAPAF (fecha, tema, participantes, objetivo)" },
          { key: "mesadas",             label: "Mesadas — aportes económicos mensuales de los MAPAF a sus hijas e hijos" },
          { key: "visitas_familiares",  label: "Visitas familiares recibidas y vacaciones con la familia" },
        ],
      },
      {
        kind: "section", number: "2.8",
        label: "Coordinación interinstitucional con Red Niña y Niño",
        fields: [
          { key: "asamblea_red",             label: "Actividades realizadas en asamblea de la Red" },
          { key: "comisiones_red",           label: "Comisiones de la Red en las que participa ASOL" },
          { key: "analisis_conversatorios",  label: "Análisis y conversatorios" },
        ],
      },
    ],
    statFields: [],
  },

  auxiliar: {
    codePrefix: "AUX",
    docTitle: "Informe Área de Auxiliares",
    // A2.3, A2.5 y R2.4 del mismo documento maestro, asignados
    // explícitamente "para los 3 auxiliares" — coinciden con su
    // descripción en roles.seed.js ("Acompañamiento escolar,
    // reforzamiento académico y actividades recreativas"). A2.3 usa
    // el mismo código que tutoría (2.3): cada rol llena su propio
    // contenido bajo ese número — acompañamiento diario acá,
    // trámites universitarios en tutoría.
    periodTypes: ["diario", "semanal", "mensual", "trimestral", "semestral", "anual"],
    narrativeFields: [
      {
        kind: "section", number: "2.3",
        fields: [{ key: "apoyo_academico", label: "Apoyo académico y apoyo complementario para educación o formación externa" }],
      },
      {
        kind: "section", number: "2.4",
        fields: [{ key: "actividades_recreativas", label: "Organizar actividades deportivas, artísticas y de ocio para un buen equilibrio fisio-psicosocial" }],
      },
      {
        kind: "section", number: "2.5",
        fields: [{ key: "formacion_desarrollo_personal", label: "Implementación de un programa de formación para el desarrollo personal" }],
      },
    ],
    statFields: [],
  },
};

// Recorre el árbol de narrativeFields y devuelve todos los campos de
// texto "hoja" (los que de verdad tienen un textarea) en orden, sin
// importar cuántos niveles de agrupación tengan encima. Lo usan tanto
// la validación del backend como el formulario del frontend.
function flattenNarrativeFields(narrativeFields) {
  const out = [];
  const walkFields = (fields) => {
    for (const f of fields || []) {
      if (f.fields?.length) walkFields(f.fields);
      else out.push(f);
    }
  };
  for (const node of narrativeFields || []) {
    if (node.kind === "intro" || node.kind === "closing") out.push(node);
    else if (node.kind === "section") walkFields(node.fields);
  }
  return out;
}

const getReportFields = (role) => REPORT_FIELDS[role] || null;

module.exports = { REPORT_FIELDS, getReportFields, flattenNarrativeFields };
