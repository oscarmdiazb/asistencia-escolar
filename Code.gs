/**
 * AulaPresente — Google Apps Script (Bound Script)
 *
 * This script is embedded inside the school's Google Sheet template.
 * Each school has their own copy of this Sheet + Script.
 *
 * Deploy: Extensions → Apps Script → Deploy → Web app
 *   Execute as: Me (the coordinator's account)
 *   Access: Anyone
 *
 * Endpoints:
 *   GET  ?action=ping              → returns school name and code
 *   GET  ?action=getClasses        → teacher fetches class rosters
 *   GET  ?action=getDashboard      → dashboard fetches all data
 *   POST action=pushClasses        → coordinator publishes rosters from app
 *   POST action=pushAttendance     → teacher syncs attendance record
 */

// Column layout constants
// Encabezados de la pestaña Clases. Los campos en UPPER provienen tal cual de
// SIMAT (INSTITUCION, SEDE, JORNADA, GRADO_COD, GRUPO, DOC, APELLIDO1, etc.),
// los campos en camelCase son metadatos que genera la app (classId, className,
// publishedAt, version). Las claves internas del JSON de la API (sede,
// jornada, grade, aula, simat, apellido1…) NO cambian — lo único que cambia
// es el texto visible en la fila de encabezados de la hoja.
var CLASES_HEADERS = [
  'classId', 'className', 'INSTITUCION', 'SEDE', 'JORNADA', 'GRADO_COD', 'GRUPO',
  'DOC', 'APELLIDO1', 'APELLIDO2', 'NOMBRE1', 'NOMBRE2',
  'publishedAt', 'version'
];
// Indices for Clases tab (0-based)
var CL = { id:0, name:1, school:2, sede:3, jornada:4, grade:5, aula:6,
           simat:7, ap1:8, ap2:9, n1:10, n2:11, pub:12, ver:13 };

var ASIST_HEADERS = [
  'recordId', 'classId', 'className', 'SEDE', 'JORNADA', 'GRADO_COD',
  'date', 'eventName', 'slotLabel',
  'DOC', 'APELLIDO1', 'APELLIDO2', 'NOMBRE1', 'NOMBRE2', 'estado',
  'facilitador', 'facilitadorId', 'facilitadorRol', 'savedAt', 'syncedAt'
];

// Mapeo de columnas SIMAT usadas por el importador
var SIMAT_COLS = [
  'ESTADO', 'INSTITUCION', 'SEDE', 'JORNADA', 'GRADO_COD', 'GRUPO',
  'DOC', 'APELLIDO1', 'APELLIDO2', 'NOMBRE1', 'NOMBRE2'
];

// Pestaña Profes (sistema de tokens por docente)
var PROFES_HEADERS = [
  'token', 'nombre', 'idPersonal', 'firstSeen', 'lastSeen', 'activo', 'notas'
];
// Índices 0-based
var PR = { token:0, nombre:1, idPersonal:2, firstSeen:3, lastSeen:4, activo:5, notas:6 };

// ═══════════════════════════════════
// ROUTING
// ═══════════════════════════════════

function doGet(e) {
  try {
    var action = (e.parameter.action || '').toLowerCase();
    var params = e.parameter || {};
    switch (action) {
      case 'ping':
        // Público: solo devuelve schoolName/schoolCode para que el app
        // pueda verificar que la URL conecta a un Sheet real antes de
        // pedirle la identidad al profe.
        return json(handlePing());

      case 'getclasses': {
        var t = verifyTeacherToken(params.token);
        if (!t.ok) return json(t);
        return json(handleGetClasses(t.teacher));
      }

      case 'getdashboard': {
        var a = verifyAdminToken(params.adminToken);
        if (!a.ok) return json(a);
        return json(handleGetDashboard());
      }

      default:
        return json({ ok: false, error: 'Acción GET no válida' });
    }
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var raw = e.postData ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var action = (body.action || '').toLowerCase();
    switch (action) {
      case 'registerteacher':
        // Público: genera o reutiliza el token de un profe dada su
        // identidad (nombre + cédula). Si el admin quiere pre-aprobar,
        // puede crear la fila en Profes antes de que el profe se registre.
        return json(handleRegisterTeacher(body));

      case 'pushclasses': {
        var a = verifyAdminToken(body.adminToken);
        if (!a.ok) return json(a);
        return json(handlePushClasses(body));
      }

      case 'pushattendance': {
        var t = verifyTeacherToken(body.token);
        if (!t.ok) return json(t);
        return json(handlePushAttendance(body, t.teacher));
      }

      default:
        return json({ ok: false, error: 'Acción POST no válida' });
    }
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════

function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getConfig() {
  var ss = getSheet();
  var sheet = ss.getSheetByName('Config');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var cfg = {};
  for (var i = 0; i < data.length; i++) {
    if (data[i][0]) cfg[String(data[i][0]).trim()] = data[i][1];
  }
  return cfg;
}

function ensureTab(name, headers) {
  var ss = getSheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ═══════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════
//
// Dos niveles:
//
//   1) Admin token  — para el coordinador. Necesario para getDashboard
//      y pushClasses. Se genera una sola vez con el menú "Generar admin
//      token" y se guarda en la pestaña Config (fila `adminToken`). Si
//      no existe, esos endpoints responden con "configuración incompleta"
//      en vez de caer en modo inseguro.
//
//   2) Teacher token — para cada docente. Se genera al llamar
//      registerTeacher (nombre + idPersonal). Se guarda en la pestaña
//      Profes con un flag `activo` que el admin puede cambiar a FALSE
//      para revocar acceso individual sin afectar a los demás. Necesario
//      para getClasses y pushAttendance.
//
// Diseño pensado para el piloto donde el admin (Oscar) controla todos
// los Sheets directamente.

function verifyAdminToken(provided) {
  var cfg = getConfig();
  if (!cfg.adminToken) {
    return { ok: false,
             error: 'Este Sheet no tiene adminToken configurado. Corre "AulaPresente → Generar admin token" desde el menú.' };
  }
  if (!provided || String(provided).trim() !== String(cfg.adminToken).trim()) {
    return { ok: false, error: 'adminToken inválido o no provisto.', unauthorized: true };
  }
  return { ok: true };
}

function verifyTeacherToken(provided) {
  if (!provided) {
    return { ok: false, error: 'Falta el token del docente.', unauthorized: true };
  }
  var ss = getSheet();
  var sheet = ss.getSheetByName('Profes');
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, error: 'Token no reconocido (no hay docentes registrados).', unauthorized: true };
  }
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROFES_HEADERS.length).getValues();
  var providedStr = String(provided).trim();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][PR.token]).trim() === providedStr) {
      var activo = data[i][PR.activo];
      // Accept TRUE, true, 1, "TRUE", "Sí", etc.
      var activoTrue = (activo === true || activo === 1 ||
                        /^(true|1|sí|si|yes|y|activo)$/i.test(String(activo).trim()));
      if (!activoTrue) {
        return { ok: false,
                 error: 'Tu acceso fue revocado por el coordinador. Contáctalo si crees que es un error.',
                 unauthorized: true };
      }
      // Actualizar lastSeen
      var rowIdx = i + 2; // +2 porque data empieza en fila 2 del sheet
      sheet.getRange(rowIdx, PR.lastSeen + 1).setValue(new Date().toISOString());
      return {
        ok: true,
        teacher: {
          token: data[i][PR.token],
          nombre: data[i][PR.nombre],
          idPersonal: data[i][PR.idPersonal],
          rowIdx: rowIdx
        }
      };
    }
  }
  return { ok: false, error: 'Token no reconocido.', unauthorized: true };
}

function handleRegisterTeacher(body) {
  var nombre = String(body.nombre || '').trim();
  var idPersonal = String(body.idPersonal || '').trim();
  if (!nombre || !idPersonal) {
    return { ok: false, error: 'Se requiere nombre e idPersonal para registrarse.' };
  }

  var cfg = getConfig();
  // Por defecto operamos en modo whitelist: solo las cédulas pre-listadas
  // por el coordinador en la pestaña Profes pueden registrarse. Esto
  // significa que un URL filtrado por sí solo NO da acceso — el atacante
  // también necesitaría una cédula autorizada.
  //
  // Para desactivar el whitelist (modo abierto: cualquier cédula puede
  // registrarse), pon  requireWhitelist = FALSE  en la pestaña Config.
  var whitelistOff = /^(false|0|no|off)$/i.test(String(cfg.requireWhitelist || '').trim());
  var requireWhitelist = !whitelistOff;

  var sheet = ensureTab('Profes', PROFES_HEADERS);

  // ¿Existe ya una fila con esa cédula?
  //   - Si la pre-populó el coordinador (token vacío, activo=TRUE) → se la asignamos.
  //   - Si ya tiene token → reutilizamos (cubre reinstalaciones del app).
  //   - Si está inactiva → rechazamos.
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, PROFES_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][PR.idPersonal]).trim() === idPersonal) {
        var rowIdx = i + 2;
        var existingToken = String(data[i][PR.token] || '').trim();
        var activo = data[i][PR.activo];
        var activoTrue = (activo === true || activo === 1 ||
                          /^(true|1|sí|si|yes|y|activo)$/i.test(String(activo).trim()));
        if (!activoTrue) {
          return { ok: false,
                   error: 'Tu cédula aparece en la lista pero tu acceso está inactivo. Contacta al coordinador.' };
        }
        var now = new Date().toISOString();
        // Primer contacto de una fila pre-populada: emitir token y marcar firstSeen
        if (!existingToken) {
          existingToken = Utilities.getUuid();
          sheet.getRange(rowIdx, PR.token + 1).setValue(existingToken);
          if (!data[i][PR.firstSeen]) {
            sheet.getRange(rowIdx, PR.firstSeen + 1).setValue(now);
          }
        }
        // Actualizar nombre (por si el coordinador lo puso distinto) y lastSeen
        if (nombre) sheet.getRange(rowIdx, PR.nombre + 1).setValue(nombre);
        sheet.getRange(rowIdx, PR.lastSeen + 1).setValue(now);
        SpreadsheetApp.flush();
        return {
          ok: true,
          token: existingToken,
          schoolName: cfg.schoolName || '',
          schoolCode: cfg.schoolCode || '',
          reused: true
        };
      }
    }
  }

  // Cédula no está en la pestaña Profes
  if (requireWhitelist) {
    return {
      ok: false,
      error: 'Tu cédula (' + idPersonal + ') no está autorizada para este colegio. ' +
             'Pídele al coordinador que te agregue a la lista de docentes antes de conectarte.'
    };
  }

  // Modo abierto (requireWhitelist=FALSE): crear una fila nueva
  var token = Utilities.getUuid();
  var now2 = new Date().toISOString();
  sheet.appendRow([
    token,       // token
    nombre,      // nombre
    idPersonal,  // idPersonal
    now2,        // firstSeen
    now2,        // lastSeen
    true,        // activo
    'auto-registered (modo abierto)'  // notas
  ]);
  SpreadsheetApp.flush();

  return {
    ok: true,
    token: token,
    schoolName: cfg.schoolName || '',
    schoolCode: cfg.schoolCode || '',
    reused: false
  };
}

// ═══════════════════════════════════
// CUSTOM MENU
// ═══════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AulaPresente')
    .addItem('Verificar configuración', 'checkConfig')
    .addSeparator()
    .addItem('Importar desde SIMAT…', 'importFromSimat')
    .addItem('Migrar encabezados a SIMAT', 'migrateHeaders')
    .addItem('Vaciar pestaña Clases', 'clearClases')
    .addSeparator()
    .addItem('Generar / rotar admin token', 'generateAdminToken')
    .addItem('Agregar docentes autorizados…', 'bulkAddProfes')
    .addItem('Ver docentes registrados', 'showProfes')
    .addSeparator()
    .addItem('Ver instrucciones de despliegue', 'showDeployHelp')
    .addToUi();
}

function generateAdminToken() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSheet();
  var cfg = ss.getSheetByName('Config');
  if (!cfg) {
    ui.alert('Falta la pestaña Config',
      'Crea una pestaña "Config" con las filas schoolName y schoolCode antes de generar el token.',
      ui.ButtonSet.OK);
    return;
  }
  // Buscar la fila adminToken o agregarla
  var data = cfg.getDataRange().getValues();
  var existing = '';
  var rowIdx = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'adminToken') {
      rowIdx = i + 1;
      existing = String(data[i][1] || '').trim();
      break;
    }
  }
  var msg = existing
    ? '⚠️ Ya existe un adminToken. Si lo rotas, el dashboard tendrá que volver a pedirte el nuevo. ¿Continuar?'
    : 'Se generará un adminToken nuevo y se guardará en Config. Úsalo en el dashboard.';
  var conf = ui.alert('Generar admin token', msg, ui.ButtonSet.OK_CANCEL);
  if (conf !== ui.Button.OK) return;

  var token = Utilities.getUuid();
  if (rowIdx < 0) {
    cfg.appendRow(['adminToken', token]);
  } else {
    cfg.getRange(rowIdx, 2).setValue(token);
  }
  SpreadsheetApp.flush();
  ui.alert('✅ Admin token generado',
    'Cópialo y guárdalo en lugar seguro. El dashboard te lo pedirá la primera vez:\n\n' + token,
    ui.ButtonSet.OK);
}

function bulkAddProfes() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Agregar docentes autorizados',
    'Pega la lista de docentes autorizados, una línea por docente.\n\n' +
    'Formato:  cédula, nombre completo\n\n' +
    'Ejemplos:\n' +
    '  12345678, Ana García Ruiz\n' +
    '  87654321, Luis Pérez Mora\n\n' +
    'Si una cédula ya existe no la duplica (solo actualiza el nombre si lo cambias).',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var text = (resp.getResponseText() || '').trim();
  if (!text) return;

  var sheet = ensureTab('Profes', PROFES_HEADERS);
  // Cargar cédulas existentes para dedup
  var existing = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, PROFES_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var c = String(data[i][PR.idPersonal]).trim();
      if (c) existing[c] = i + 2;  // rowIdx
    }
  }

  var added = 0, updated = 0, skipped = 0;
  var newRows = [];
  text.split(/\r?\n/).forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var parts = line.split(',').map(function(x){return x.trim();});
    var idPersonal = parts[0] || '';
    var nombre = parts.slice(1).join(',').trim();
    if (!idPersonal) { skipped++; return; }
    if (existing[idPersonal]) {
      // Actualizar nombre si se provee uno distinto
      if (nombre) {
        sheet.getRange(existing[idPersonal], PR.nombre + 1).setValue(nombre);
        updated++;
      } else {
        skipped++;
      }
      return;
    }
    // Nueva fila: token/firstSeen/lastSeen vacíos — se llenarán cuando el profe se registre
    newRows.push(['', nombre || '(pendiente)', idPersonal, '', '', true, 'pre-autorizado']);
    existing[idPersonal] = -1;  // marcamos para evitar duplicados dentro del mismo paste
    added++;
  });

  if (newRows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, PROFES_HEADERS.length).setValues(newRows);
    SpreadsheetApp.flush();
  }

  ui.alert('✅ Lista actualizada',
    'Agregados: ' + added + '\n' +
    'Actualizados (nombre): ' + updated + '\n' +
    'Omitidos: ' + skipped + '\n\n' +
    'Los docentes nuevos aparecen con token vacío hasta que se conecten desde el app. ' +
    'Cuando lo hagan, se les emite un token automáticamente y se llenan firstSeen/lastSeen.',
    ui.ButtonSet.OK);
}

function showProfes() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSheet();
  var sheet = ss.getSheetByName('Profes');
  if (!sheet || sheet.getLastRow() < 2) {
    ui.alert('Sin docentes registrados',
      'Todavía ningún profe ha hecho "Conectar a un colegio" desde el app. ' +
      'Cuando lo hagan, aparecerán automáticamente en la pestaña Profes.',
      ui.ButtonSet.OK);
    return;
  }
  var n = sheet.getLastRow() - 1;
  ss.setActiveSheet(sheet);
  ui.alert('Docentes registrados: ' + n,
    'Abrí la pestaña Profes para ti. Para revocar a un profe, ' +
    'cambia su celda "activo" a FALSE. Para reactivarlo, pon TRUE.',
    ui.ButtonSet.OK);
}

function clearClases() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSheet();
  var sheet = ss.getSheetByName('Clases');
  if (!sheet) {
    ui.alert('No existe la pestaña "Clases".', ui.ButtonSet.OK);
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    ui.alert('La pestaña "Clases" ya está vacía.', ui.ButtonSet.OK);
    return;
  }
  var conf = ui.alert(
    '¿Vaciar la pestaña Clases?',
    'Se borrarán ' + (lastRow - 1) + ' fila(s) (deja los encabezados intactos). ' +
    'Útil si una importación falló a medias y quieres empezar limpio.\n\n¿Continuar?',
    ui.ButtonSet.OK_CANCEL);
  if (conf !== ui.Button.OK) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  SpreadsheetApp.flush();
  ui.alert('✅ Pestaña Clases vaciada.', ui.ButtonSet.OK);
}

function checkConfig() {
  var cfg = getConfig();
  var ui = SpreadsheetApp.getUi();
  if (!cfg.schoolName || !cfg.schoolCode) {
    ui.alert('⚠️ Configuración incompleta',
      'Llena las celdas schoolName y schoolCode en la pestaña Config.',
      ui.ButtonSet.OK);
    return;
  }

  // Estado del sistema de tokens
  var hasAdminToken = !!(cfg.adminToken && String(cfg.adminToken).trim());
  var whitelistOff = /^(false|0|no|off)$/i.test(String(cfg.requireWhitelist || '').trim());
  var ss = getSheet();
  var profesSheet = ss.getSheetByName('Profes');
  var profesCount = 0;
  if (profesSheet && profesSheet.getLastRow() >= 2) {
    profesCount = profesSheet.getLastRow() - 1;
  }

  var msg = '✅ Configuración básica\n';
  msg += '  Colegio: ' + cfg.schoolName + '\n';
  msg += '  Código:  ' + cfg.schoolCode + '\n\n';
  msg += '🔐 Seguridad\n';
  msg += '  Admin token: ' + (hasAdminToken ? '✅ generado' : '❌ falta (Menú → Generar admin token)') + '\n';
  msg += '  Modo whitelist: ' + (whitelistOff ? '⚠️ DESACTIVADO (cualquier cédula puede registrarse)' : '✅ activo (solo cédulas pre-listadas)') + '\n';
  msg += '  Docentes registrados: ' + profesCount + '\n';
  if (!whitelistOff && profesCount === 0) {
    msg += '\n⚠️ Nadie puede conectarse todavía — agrega docentes autorizados\n   desde "Menú → Agregar docentes autorizados…".';
  }
  ui.alert('Estado de AulaPresente', msg, ui.ButtonSet.OK);
}

function showDeployHelp() {
  SpreadsheetApp.getUi().alert('Instrucciones de despliegue',
    '1. Click en Deploy → New deployment\n' +
    '2. Tipo: Web app\n' +
    '3. Execute as: Me\n' +
    '4. Who has access: Anyone\n' +
    '5. Click Deploy\n' +
    '6. Copia la URL\n' +
    '7. Comparte la URL con los docentes',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ═══════════════════════════════════
// GET: PING
// ═══════════════════════════════════

function handlePing() {
  var cfg = getConfig();
  if (!cfg.schoolName && !cfg.schoolCode) {
    return { ok: false, error: 'Hoja no configurada. Llena la pestaña Config.' };
  }
  return { ok: true, schoolName: cfg.schoolName || '', schoolCode: cfg.schoolCode || '' };
}

// ═══════════════════════════════════
// GET: GET CLASSES
// ═══════════════════════════════════

function handleGetClasses(teacher) {
  // `teacher` is optional — si viene (pasado por doGet tras verificar token)
  // podríamos filtrar por asignaciones. Por ahora (piloto) devolvemos
  // todas las clases del colegio; la asignación por profe-a-grupo es
  // una mejora futura (otra pestaña Asignaciones: token|classId).
  var ss = getSheet();
  var sheet = ss.getSheetByName('Clases');
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, classes: [] };

  var data = sheet.getDataRange().getValues();
  var rows = data.slice(1);
  var classMap = {};

  rows.forEach(function(row) {
    var classId = String(row[CL.id] || '').trim();
    if (!classId) return;
    if (!classMap[classId]) {
      classMap[classId] = {
        classId: classId,
        name: row[CL.name] || classId,
        school: row[CL.school] || '',
        sede: row[CL.sede] || '',
        jornada: row[CL.jornada] || '',
        grade: String(row[CL.grade] || ''),
        aula: row[CL.aula] || '',
        version: row[CL.ver] || 1,
        students: []
      };
    }
    var simat = String(row[CL.simat] || '').trim();
    if (simat) {
      classMap[classId].students.push({
        simat: simat,
        apellido1: row[CL.ap1] || '',
        apellido2: row[CL.ap2] || '',
        nombre1: row[CL.n1] || '',
        nombre2: row[CL.n2] || ''
      });
    }
  });

  return { ok: true, classes: Object.values(classMap) };
}

// ═══════════════════════════════════
// GET: GET DASHBOARD DATA
// ═══════════════════════════════════

function handleGetDashboard() {
  var cfg = getConfig();
  var classResult = handleGetClasses();
  var classes = classResult.classes || [];

  var ss = getSheet();
  var attSheet = ss.getSheetByName('Asistencia');
  var records = [];
  if (attSheet && attSheet.getLastRow() >= 2) {
    var data = attSheet.getDataRange().getValues();
    data.slice(1).forEach(function(row) {
      records.push({
        recordId: row[0],  classId: row[1],   className: row[2],
        sede: row[3],      jornada: row[4],   grade: row[5],
        date: row[6],      eventName: row[7], slotLabel: row[8],
        simat: String(row[9] || ''),
        apellido1: row[10] || '', apellido2: row[11] || '',
        nombre1: row[12] || '',   nombre2: row[13] || '',
        estado: row[14],
        facilitador: row[15] || '', facilitadorId: row[16] || '',
        facilitadorRol: row[17] || '',
        savedAt: row[18] || '',     syncedAt: row[19] || ''
      });
    });
  }

  return {
    ok: true,
    schoolName: cfg.schoolName || '',
    schoolCode: cfg.schoolCode || '',
    classes: classes,
    records: records
  };
}

// ═══════════════════════════════════
// POST: PUSH CLASSES
// ═══════════════════════════════════

function handlePushClasses(body) {
  var classes = body.classes;
  if (!Array.isArray(classes) || classes.length === 0) {
    return { ok: false, error: 'No hay clases para publicar' };
  }

  var sheet = ensureTab('Clases', CLASES_HEADERS);
  var now = new Date().toISOString();

  // Leer toda la hoja UNA vez
  var lastRow = sheet.getLastRow();
  var existing = (lastRow > 1)
    ? sheet.getRange(2, 1, lastRow - 1, CLASES_HEADERS.length).getValues()
    : [];

  // Set de classIds que estamos actualizando → se remueven de existing
  var updatingIds = {};
  classes.forEach(function(cls) { updatingIds[String(cls.classId)] = true; });
  var keptRows = existing.filter(function(row) {
    return !updatingIds[String(row[CL.id])];
  });

  // Construir filas nuevas en memoria
  var newRows = [];
  var studentsWritten = 0;
  classes.forEach(function(cls) {
    var version = (cls.version || 0) + 1;
    if (Array.isArray(cls.students)) {
      cls.students.forEach(function(s) {
        newRows.push([
          cls.classId, cls.name, cls.school || '', cls.sede || '', cls.jornada || '',
          cls.grade || '', cls.aula || '',
          s.simat || '', s.apellido1 || '', s.apellido2 || '', s.nombre1 || '', s.nombre2 || '',
          now, version
        ]);
        studentsWritten++;
      });
    }
  });

  var allRows = keptRows.concat(newRows);

  // Limpiar el cuerpo y escribir todo de una sola vez
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, CLASES_HEADERS.length).clearContent();
  }
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, CLASES_HEADERS.length).setValues(allRows);
  }
  SpreadsheetApp.flush();

  return { ok: true, classesWritten: classes.length, studentsWritten: studentsWritten };
}

// ═══════════════════════════════════
// POST: PUSH ATTENDANCE
// ═══════════════════════════════════

function handlePushAttendance(body, teacher) {
  var sheet = ensureTab('Asistencia', ASIST_HEADERS);
  var record = body.record;
  if (!record || !record.recordId) return { ok: false, error: 'Registro inválido' };

  // Si tenemos el profe autenticado, reemplazamos/validamos los campos
  // de facilitador para que no pueda impersonar a otro docente al enviar
  // el payload.
  if (teacher) {
    record.facilitador    = teacher.nombre || record.facilitador || '';
    record.facilitadorId  = teacher.idPersonal || record.facilitadorId || '';
  }

  // Leer toda la hoja UNA vez y remover el recordId que estamos actualizando
  var lastRow = sheet.getLastRow();
  var existing = (lastRow > 1)
    ? sheet.getRange(2, 1, lastRow - 1, ASIST_HEADERS.length).getValues()
    : [];
  var keptRows = existing.filter(function(row) {
    return String(row[0]) !== String(record.recordId);
  });

  var now = new Date().toISOString();
  var newRows = [];

  if (Array.isArray(record.students)) {
    record.students.forEach(function(s) {
      newRows.push([
        record.recordId, record.classId, record.className || '',
        record.sede || '', record.jornada || '', record.grade || '',
        record.date, record.eventName || '', record.slotLabel || '',
        s.simat || '', s.apellido1 || '', s.apellido2 || '',
        s.nombre1 || '', s.nombre2 || '', s.estado,
        record.facilitador || '', record.facilitadorId || '',
        record.facilitadorRol || '', record.savedAt || '', now
      ]);
    });
  }

  var allRows = keptRows.concat(newRows);

  // Limpiar el cuerpo y escribir todo de una sola vez
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, ASIST_HEADERS.length).clearContent();
  }
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, ASIST_HEADERS.length).setValues(allRows);
  }
  SpreadsheetApp.flush();

  return { ok: true, rowsWritten: newRows.length };
}

// ═══════════════════════════════════
// MIGRATE HEADERS
// ═══════════════════════════════════
//
// Reescribe la fila 1 de las pestañas Clases y Asistencia con los
// encabezados nuevos (alineados con SIMAT). Úsalo una sola vez si la hoja
// ya fue poblada con los encabezados viejos (school, sede, jornada, grade,
// aula, simat, apellido1…). No toca las filas de datos.

function migrateHeaders() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSheet();
  var updated = [];
  var skipped = [];

  function applyHeaders(tabName, newHeaders) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) { skipped.push(tabName); return; }
    // Asegurar que haya suficientes columnas
    var currentCols = sheet.getMaxColumns();
    if (currentCols < newHeaders.length) {
      sheet.insertColumnsAfter(currentCols, newHeaders.length - currentCols);
    }
    sheet.getRange(1, 1, 1, newHeaders.length)
         .setValues([newHeaders])
         .setFontWeight('bold');
    sheet.setFrozenRows(1);
    updated.push(tabName);
  }

  applyHeaders('Clases', CLASES_HEADERS);
  applyHeaders('Asistencia', ASIST_HEADERS);

  var msg = '';
  if (updated.length) msg += '✅ Encabezados actualizados en: ' + updated.join(', ') + '\n';
  if (skipped.length) msg += 'ℹ️ Pestañas no encontradas (se omiten): ' + skipped.join(', ');
  if (!msg) msg = 'No se encontraron pestañas Clases ni Asistencia.';
  ui.alert('Migración de encabezados', msg.trim(), ui.ButtonSet.OK);
}

// ═══════════════════════════════════
// IMPORT FROM SIMAT
// ═══════════════════════════════════
//
// Flujo:
// 1. El coordinador crea una pestaña llamada "SIMAT_Raw" y pega ahí el
//    contenido del Excel de SIMAT (incluyendo la fila de encabezados
//    ANO, ETC, ESTADO, …, APELLIDO1, APELLIDO2, NOMBRE1, NOMBRE2, …).
// 2. Menú AulaPresente → "Importar desde SIMAT…"
// 3. Se le pide el/los GRADO_COD a importar (p.ej. "99", o "6,7,8,9").
// 4. Filtra por ESTADO = MATRICULADO y los grados dados.
// 5. Agrupa por GRUPO → cada grupo se convierte en una "clase" con:
//      classId   = GRUPO (p.ej. "9901")
//      className = "Grupo {GRUPO}"
//      school, sede, jornada, grade, aula → se copian de SIMAT
//      students  → lista ordenada por APELLIDO1
// 6. Reescribe esas clases en la pestaña Clases (reemplaza clases con el
//    mismo classId, deja las demás intactas).

function importFromSimat() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSheet();
  var raw = ss.getSheetByName('SIMAT_Raw');
  if (!raw) {
    ui.alert('Falta la pestaña SIMAT_Raw',
      'Crea una pestaña llamada "SIMAT_Raw" y pega ahí el contenido del ' +
      'Excel de SIMAT (con su fila de encabezados) antes de importar.',
      ui.ButtonSet.OK);
    return;
  }

  var data = raw.getDataRange().getValues();
  if (data.length < 2) {
    ui.alert('SIMAT_Raw está vacía o solo tiene encabezados.', ui.ButtonSet.OK);
    return;
  }

  // Localizar columnas SIMAT por nombre
  var headers = data[0].map(function(h){ return String(h || '').trim(); });
  var colIdx = {};
  var missing = [];
  SIMAT_COLS.forEach(function(name) {
    var i = headers.indexOf(name);
    if (i < 0) missing.push(name); else colIdx[name] = i;
  });
  if (missing.length) {
    ui.alert('Faltan columnas en SIMAT_Raw',
      'No encontré: ' + missing.join(', ') +
      '\n\nVerifica que la fila 1 de SIMAT_Raw tenga los encabezados originales de SIMAT.',
      ui.ButtonSet.OK);
    return;
  }

  // Pedir los grados
  var resp = ui.prompt('Importar desde SIMAT',
    'Escribe el/los código(s) de GRADO_COD a importar, separados por coma.\n' +
    '  Ejemplo: 99\n' +
    '  Ejemplo múltiple: 6, 7, 8, 9\n' +
    '  Para TODOS los grados del colegio: escribe  *  o  todos\n\n' +
    'Solo se importarán estudiantes con ESTADO = MATRICULADO.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var gradosInput = (resp.getResponseText() || '').trim();
  if (!gradosInput) { ui.alert('No ingresaste ningún grado.', ui.ButtonSet.OK); return; }

  var importAll = /^(\*|todos|todo|all)$/i.test(gradosInput);
  var grados = importAll ? null : gradosInput.split(',').map(function(g){
    return String(g).trim();
  }).filter(Boolean);
  if (!importAll && grados.length === 0) {
    ui.alert('Los grados ingresados no son válidos.', ui.ButtonSet.OK);
    return;
  }

  // Agrupar por GRUPO
  var classMap = {};
  var seenKeys = {};  // evitar duplicados por DOC dentro de un mismo grupo
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var estado = String(row[colIdx.ESTADO] || '').trim().toUpperCase();
    if (estado !== 'MATRICULADO') continue;
    var gradoCell = row[colIdx.GRADO_COD];
    var grado = (gradoCell === null || gradoCell === undefined) ? '' : String(gradoCell).trim();
    if (!importAll && grados.indexOf(grado) < 0) continue;
    var grupo = String(row[colIdx.GRUPO] || '').trim();
    if (!grupo) continue;
    var jornada = String(row[colIdx.JORNADA] || '').trim();

    var classId = grupo + '|' + jornada.toUpperCase();
    if (!classMap[classId]) {
      var jornadaLabel = jornada ? ' — ' + jornada.charAt(0).toUpperCase() + jornada.slice(1).toLowerCase() : '';
      classMap[classId] = {
        classId: classId,
        name: 'Grupo ' + grupo + jornadaLabel,
        school: String(row[colIdx.INSTITUCION] || '').trim(),
        sede: String(row[colIdx.SEDE] || '').trim(),
        jornada: jornada,
        grade: grado,
        aula: grupo,
        version: 0,
        students: []
      };
    }
    var doc = String(row[colIdx.DOC] || '').trim();
    if (!doc) continue;
    var dedupKey = classId + '|' + doc;
    if (seenKeys[dedupKey]) continue;
    seenKeys[dedupKey] = true;

    classMap[classId].students.push({
      simat: doc,
      apellido1: String(row[colIdx.APELLIDO1] || '').trim(),
      apellido2: String(row[colIdx.APELLIDO2] || '').trim(),
      nombre1:   String(row[colIdx.NOMBRE1]   || '').trim(),
      nombre2:   String(row[colIdx.NOMBRE2]   || '').trim()
    });
  }

  var classes = Object.keys(classMap).map(function(k){ return classMap[k]; });
  if (classes.length === 0) {
    var gradosMsg = importAll ? 'todos los grados' : 'GRADO_COD ∈ {' + grados.join(', ') + '}';
    ui.alert('Sin resultados',
      'No se encontraron estudiantes con ESTADO=MATRICULADO y ' + gradosMsg + ' en SIMAT_Raw.',
      ui.ButtonSet.OK);
    return;
  }

  // Ordenar alfabéticamente por APELLIDO1 dentro de cada clase
  classes.forEach(function(c) {
    c.students.sort(function(a, b) {
      return (a.apellido1 || '').localeCompare(b.apellido1 || '', 'es');
    });
  });
  // Orden natural de clases por classId
  classes.sort(function(a, b){ return String(a.classId).localeCompare(String(b.classId), 'es'); });

  // Resumen + confirmación
  var totalStu = 0;
  var summary = classes.map(function(c){
    totalStu += c.students.length;
    return '• ' + c.name + '  (' + c.sede + ' — ' + c.jornada + '):  ' + c.students.length + ' est.';
  }).join('\n');

  var conf = ui.alert(
    'Confirmar importación',
    'Se importarán ' + classes.length + ' clase(s) con ' + totalStu + ' estudiantes:\n\n' +
    summary +
    '\n\n⚠️ Esto REEMPLAZARÁ cualquier clase existente con el mismo classId en la pestaña Clases. ¿Continuar?',
    ui.ButtonSet.OK_CANCEL);
  if (conf !== ui.Button.OK) return;

  // Reutilizar la lógica de push
  var result = handlePushClasses({ classes: classes });
  if (result.ok) {
    ui.alert('✅ Importación exitosa',
      'Se escribieron ' + result.classesWritten + ' clase(s) y ' +
      result.studentsWritten + ' estudiantes en la pestaña Clases.\n\n' +
      'Ya puedes publicar los rosters a la app desde la vista del coordinador, ' +
      'o los docentes pueden sincronizar con action=getClasses.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('❌ Error al importar', result.error || 'Error desconocido', ui.ButtonSet.OK);
  }
}
