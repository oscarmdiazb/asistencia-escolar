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
var CLASES_HEADERS = [
  'classId', 'className', 'school', 'sede', 'jornada', 'grade', 'aula',
  'simat', 'apellido1', 'apellido2', 'nombre1', 'nombre2',
  'publishedAt', 'version'
];
// Indices for Clases tab (0-based)
var CL = { id:0, name:1, school:2, sede:3, jornada:4, grade:5, aula:6,
           simat:7, ap1:8, ap2:9, n1:10, n2:11, pub:12, ver:13 };

var ASIST_HEADERS = [
  'recordId', 'classId', 'className', 'sede', 'jornada', 'grade',
  'date', 'eventName', 'slotLabel',
  'simat', 'apellido1', 'apellido2', 'nombre1', 'nombre2', 'estado',
  'facilitador', 'facilitadorId', 'facilitadorRol', 'savedAt', 'syncedAt'
];

// ═══════════════════════════════════
// ROUTING
// ═══════════════════════════════════

function doGet(e) {
  try {
    var action = (e.parameter.action || '').toLowerCase();
    switch (action) {
      case 'ping':         return json(handlePing());
      case 'getclasses':   return json(handleGetClasses());
      case 'getdashboard': return json(handleGetDashboard());
      default:             return json({ ok: false, error: 'Acción GET no válida' });
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
      case 'pushclasses':    return json(handlePushClasses(body));
      case 'pushattendance': return json(handlePushAttendance(body));
      default:               return json({ ok: false, error: 'Acción POST no válida' });
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
// CUSTOM MENU
// ═══════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AulaPresente')
    .addItem('Verificar configuración', 'checkConfig')
    .addItem('Ver instrucciones de despliegue', 'showDeployHelp')
    .addToUi();
}

function checkConfig() {
  var cfg = getConfig();
  var ui = SpreadsheetApp.getUi();
  if (!cfg.schoolName || !cfg.schoolCode) {
    ui.alert('⚠️ Configuración incompleta',
      'Llena las celdas schoolName y schoolCode en la pestaña Config.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('✅ Configuración OK',
      'Colegio: ' + cfg.schoolName + '\nCódigo: ' + cfg.schoolCode +
      '\n\nAhora despliega el script como Web App:\nExtensions → Apps Script → Deploy → New deployment → Web app',
      ui.ButtonSet.OK);
  }
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

function handleGetClasses() {
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
  var studentsWritten = 0;

  classes.forEach(function(cls) {
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(cls.classId)) sheet.deleteRow(i + 1);
    }
    var version = (cls.version || 0) + 1;
    if (Array.isArray(cls.students)) {
      cls.students.forEach(function(s) {
        sheet.appendRow([
          cls.classId, cls.name, cls.school || '', cls.sede || '', cls.jornada || '',
          cls.grade || '', cls.aula || '',
          s.simat || '', s.apellido1 || '', s.apellido2 || '', s.nombre1 || '', s.nombre2 || '',
          now, version
        ]);
        studentsWritten++;
      });
    }
  });

  return { ok: true, classesWritten: classes.length, studentsWritten: studentsWritten };
}

// ═══════════════════════════════════
// POST: PUSH ATTENDANCE
// ═══════════════════════════════════

function handlePushAttendance(body) {
  var sheet = ensureTab('Asistencia', ASIST_HEADERS);
  var record = body.record;
  if (!record || !record.recordId) return { ok: false, error: 'Registro inválido' };

  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(record.recordId)) sheet.deleteRow(i + 1);
  }

  var now = new Date().toISOString();
  var rowsWritten = 0;

  if (Array.isArray(record.students)) {
    record.students.forEach(function(s) {
      sheet.appendRow([
        record.recordId, record.classId, record.className || '',
        record.sede || '', record.jornada || '', record.grade || '',
        record.date, record.eventName || '', record.slotLabel || '',
        s.simat || '', s.apellido1 || '', s.apellido2 || '',
        s.nombre1 || '', s.nombre2 || '', s.estado,
        record.facilitador || '', record.facilitadorId || '',
        record.facilitadorRol || '', record.savedAt || '', now
      ]);
      rowsWritten++;
    });
  }

  return { ok: true, rowsWritten: rowsWritten };
}
