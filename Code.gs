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

// ═══════════════════════════════════
// ROUTING
// ═══════════════════════════════════

function doGet(e) {
  try {
    const action = (e.parameter.action || '').toLowerCase();
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
    const raw = e.postData ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const action = (body.action || '').toLowerCase();
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

/** Always returns this Sheet — no lookup needed */
function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getConfig() {
  const ss = getSheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const cfg = {};
  for (let i = 0; i < data.length; i++) {
    if (data[i][0]) cfg[String(data[i][0]).trim()] = data[i][1];
  }
  return cfg;
}

function ensureTab(name, headers) {
  const ss = getSheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ═══════════════════════════════════
// CUSTOM MENU (appears when Sheet opens)
// ═══════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AulaPresente')
    .addItem('Verificar configuración', 'checkConfig')
    .addItem('Ver URL del script', 'showScriptUrl')
    .addToUi();
}

function checkConfig() {
  const cfg = getConfig();
  const ui = SpreadsheetApp.getUi();
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

function showScriptUrl() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('Instrucciones',
    'Para obtener la URL del script:\n\n' +
    '1. Ve a Extensions → Apps Script\n' +
    '2. Click en Deploy → Manage deployments\n' +
    '3. Copia la URL del Web app\n' +
    '4. Pégala en AulaPresente al configurar el colegio',
    ui.ButtonSet.OK);
}

// ═══════════════════════════════════
// GET: PING
// ═══════════════════════════════════

function handlePing() {
  const cfg = getConfig();
  if (!cfg.schoolName && !cfg.schoolCode) {
    return { ok: false, error: 'Hoja no configurada. Llena la pestaña Config.' };
  }
  return {
    ok: true,
    schoolName: cfg.schoolName || '',
    schoolCode: cfg.schoolCode || ''
  };
}

// ═══════════════════════════════════
// GET: GET CLASSES
// ═══════════════════════════════════

function handleGetClasses() {
  const ss = getSheet();
  const sheet = ss.getSheetByName('Clases');
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, classes: [] };
  }

  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  // Group by classId
  const classMap = {};
  rows.forEach(row => {
    const classId = String(row[0] || '').trim();
    if (!classId) return;
    if (!classMap[classId]) {
      classMap[classId] = {
        classId: classId,
        name: row[1] || classId,
        school: row[2] || '',
        grade: String(row[3] || ''),
        aula: row[4] || '',
        version: row[11] || 1,
        students: []
      };
    }
    const simat = String(row[5] || '').trim();
    if (simat) {
      classMap[classId].students.push({
        simat: simat,
        apellido1: row[6] || '',
        apellido2: row[7] || '',
        nombre1: row[8] || '',
        nombre2: row[9] || ''
      });
    }
  });

  return { ok: true, classes: Object.values(classMap) };
}

// ═══════════════════════════════════
// GET: GET DASHBOARD DATA
// ═══════════════════════════════════

function handleGetDashboard() {
  const cfg = getConfig();
  const classResult = handleGetClasses();
  const classes = classResult.classes || [];

  const ss = getSheet();
  const attSheet = ss.getSheetByName('Asistencia');
  const records = [];
  if (attSheet && attSheet.getLastRow() >= 2) {
    const data = attSheet.getDataRange().getValues();
    data.slice(1).forEach(row => {
      records.push({
        recordId: row[0],
        classId: row[1],
        className: row[2],
        date: row[3],
        eventName: row[4],
        slotLabel: row[5],
        simat: String(row[6] || ''),
        apellido1: row[7] || '',
        apellido2: row[8] || '',
        nombre1: row[9] || '',
        nombre2: row[10] || '',
        estado: row[11],
        facilitador: row[12] || '',
        facilitadorId: row[13] || '',
        facilitadorRol: row[14] || '',
        savedAt: row[15] || '',
        syncedAt: row[16] || ''
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
  const classes = body.classes;
  if (!Array.isArray(classes) || classes.length === 0) {
    return { ok: false, error: 'No hay clases para publicar' };
  }

  const sheet = ensureTab('Clases', [
    'classId', 'className', 'school', 'grade', 'aula',
    'simat', 'apellido1', 'apellido2', 'nombre1', 'nombre2',
    'publishedAt', 'version'
  ]);

  const now = new Date().toISOString();
  let studentsWritten = 0;

  classes.forEach(cls => {
    // Delete existing rows for this classId (bottom to top)
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(cls.classId)) {
        sheet.deleteRow(i + 1);
      }
    }

    const version = (cls.version || 0) + 1;
    if (Array.isArray(cls.students)) {
      cls.students.forEach(s => {
        sheet.appendRow([
          cls.classId, cls.name, cls.school || '', cls.grade || '', cls.aula || '',
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
  const sheet = ensureTab('Asistencia', [
    'recordId', 'classId', 'className', 'date', 'eventName', 'slotLabel',
    'simat', 'apellido1', 'apellido2', 'nombre1', 'nombre2', 'estado',
    'facilitador', 'facilitadorId', 'facilitadorRol', 'savedAt', 'syncedAt'
  ]);

  const record = body.record;
  if (!record || !record.recordId) {
    return { ok: false, error: 'Registro inválido' };
  }

  // Delete existing rows with same recordId (idempotent)
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(record.recordId)) {
      sheet.deleteRow(i + 1);
    }
  }

  const now = new Date().toISOString();
  let rowsWritten = 0;

  if (Array.isArray(record.students)) {
    record.students.forEach(s => {
      sheet.appendRow([
        record.recordId, record.classId, record.className || '',
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
