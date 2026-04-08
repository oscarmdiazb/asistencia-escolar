/**
 * AulaPresente — Google Apps Script Backend
 *
 * Deployed as a Web App:
 *   Execute as: deployer's account
 *   Access: Anyone (no Google login required)
 *
 * Endpoints:
 *   GET  ?action=ping&code=XXX          → validate school code
 *   GET  ?action=getClasses&code=XXX    → teacher fetches class rosters
 *   GET  ?action=getDashboard&code=XXX  → dashboard fetches all data
 *   POST ?action=setup                  → coordinator initializes school
 *   POST ?action=pushClasses            → coordinator publishes rosters
 *   POST ?action=pushAttendance         → teacher syncs attendance record
 */

// ═══════════════════════════════════
// ROUTING
// ═══════════════════════════════════

function doGet(e) {
  try {
    const action = (e.parameter.action || '').toLowerCase();
    const code = (e.parameter.code || '').trim().toUpperCase();

    switch (action) {
      case 'ping':         return json(handlePing(code));
      case 'getclasses':   return json(handleGetClasses(code));
      case 'getdashboard': return json(handleGetDashboard(code));
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
      case 'setup':          return json(handleSetup(body));
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

/**
 * Get or create the spreadsheet for a school code.
 * The script property 'sheet_CODE' stores the spreadsheet ID.
 */
function getSheet(code) {
  if (!code) throw new Error('Código de colegio requerido');
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('sheet_' + code);
  if (!ssId) return null;
  try {
    return SpreadsheetApp.openById(ssId);
  } catch (err) {
    return null;
  }
}

function getOrCreateTab(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getConfig(ss) {
  const sheet = ss.getSheetByName('Config');
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const cfg = {};
  for (let i = 0; i < data.length; i++) {
    if (data[i][0]) cfg[data[i][0]] = data[i][1];
  }
  return cfg;
}

// ═══════════════════════════════════
// GET: PING
// ═══════════════════════════════════

function handlePing(code) {
  const ss = getSheet(code);
  if (!ss) return { ok: false, error: 'Código no encontrado' };
  const cfg = getConfig(ss);
  return {
    ok: true,
    schoolName: cfg.schoolName || '',
    schoolCode: code
  };
}

// ═══════════════════════════════════
// GET: GET CLASSES
// ═══════════════════════════════════

function handleGetClasses(code) {
  const ss = getSheet(code);
  if (!ss) return { ok: false, error: 'Código no encontrado' };

  const sheet = ss.getSheetByName('Clases');
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, classes: [] };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // Group by classId
  const classMap = {};
  rows.forEach(row => {
    const classId = row[0];
    if (!classId) return;
    if (!classMap[classId]) {
      classMap[classId] = {
        classId: classId,
        name: row[1],
        school: row[2],
        grade: row[3],
        aula: row[4],
        version: row[11] || 1,
        students: []
      };
    }
    const simat = String(row[5] || '');
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

function handleGetDashboard(code) {
  const ss = getSheet(code);
  if (!ss) return { ok: false, error: 'Código no encontrado' };
  const cfg = getConfig(ss);

  // Get classes
  const classResult = handleGetClasses(code);
  const classes = classResult.classes || [];

  // Get attendance records
  const attSheet = ss.getSheetByName('Asistencia');
  const records = [];
  if (attSheet && attSheet.getLastRow() >= 2) {
    const data = attSheet.getDataRange().getValues();
    const rows = data.slice(1);
    rows.forEach(row => {
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
    schoolCode: code,
    classes: classes,
    records: records
  };
}

// ═══════════════════════════════════
// POST: SETUP
// ═══════════════════════════════════

function handleSetup(body) {
  const code = (body.code || '').trim().toUpperCase();
  if (!code || code.length < 3) {
    return { ok: false, error: 'Código inválido (mín. 3 caracteres)' };
  }

  // Check if code already exists
  const existing = getSheet(code);
  if (existing) {
    const cfg = getConfig(existing);
    return { ok: true, alreadyExists: true, schoolName: cfg.schoolName || '', spreadsheetUrl: existing.getUrl() };
  }

  // Create new spreadsheet
  const schoolName = body.schoolName || 'Colegio ' + code;
  const ss = SpreadsheetApp.create('AulaPresente — ' + code + ' — ' + schoolName);

  // Config tab (rename default sheet)
  const configSheet = ss.getSheets()[0];
  configSheet.setName('Config');
  configSheet.appendRow(['key', 'value']);
  configSheet.appendRow(['schoolCode', code]);
  configSheet.appendRow(['schoolName', schoolName]);
  configSheet.appendRow(['coordinatorName', body.coordinatorName || '']);
  configSheet.appendRow(['createdAt', new Date().toISOString()]);
  configSheet.getRange(1, 1, 1, 2).setFontWeight('bold');

  // Clases tab
  getOrCreateTab(ss, 'Clases', [
    'classId', 'className', 'school', 'grade', 'aula',
    'simat', 'apellido1', 'apellido2', 'nombre1', 'nombre2',
    'publishedAt', 'version'
  ]);

  // Asistencia tab
  getOrCreateTab(ss, 'Asistencia', [
    'recordId', 'classId', 'className', 'date', 'eventName', 'slotLabel',
    'simat', 'apellido1', 'apellido2', 'nombre1', 'nombre2', 'estado',
    'facilitador', 'facilitadorId', 'facilitadorRol', 'savedAt', 'syncedAt'
  ]);

  // Store mapping
  PropertiesService.getScriptProperties().setProperty('sheet_' + code, ss.getId());

  return {
    ok: true,
    alreadyExists: false,
    schoolName: schoolName,
    spreadsheetUrl: ss.getUrl()
  };
}

// ═══════════════════════════════════
// POST: PUSH CLASSES
// ═══════════════════════════════════

function handlePushClasses(body) {
  const code = (body.code || '').trim().toUpperCase();
  const ss = getSheet(code);
  if (!ss) return { ok: false, error: 'Código no encontrado. Ejecuta "setup" primero.' };

  const classes = body.classes;
  if (!Array.isArray(classes) || classes.length === 0) {
    return { ok: false, error: 'No hay clases para publicar' };
  }

  const sheet = ss.getSheetByName('Clases');
  if (!sheet) return { ok: false, error: 'Hoja "Clases" no encontrada' };

  const now = new Date().toISOString();
  let studentsWritten = 0;

  classes.forEach(cls => {
    // Delete existing rows for this classId
    const data = sheet.getDataRange().getValues();
    // Process from bottom to top to avoid row shift issues
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === cls.classId) {
        sheet.deleteRow(i + 1);
      }
    }

    // Calculate new version
    const version = (cls.version || 0) + 1;

    // Append new rows
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

  return {
    ok: true,
    classesWritten: classes.length,
    studentsWritten: studentsWritten
  };
}

// ═══════════════════════════════════
// POST: PUSH ATTENDANCE
// ═══════════════════════════════════

function handlePushAttendance(body) {
  const code = (body.code || '').trim().toUpperCase();
  const ss = getSheet(code);
  if (!ss) return { ok: false, error: 'Código no encontrado' };

  const sheet = ss.getSheetByName('Asistencia');
  if (!sheet) return { ok: false, error: 'Hoja "Asistencia" no encontrada' };

  const record = body.record;
  if (!record || !record.recordId) {
    return { ok: false, error: 'Registro inválido' };
  }

  // Delete existing rows with the same recordId (idempotent re-sync)
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === record.recordId) {
      sheet.deleteRow(i + 1);
    }
  }

  const now = new Date().toISOString();
  let rowsWritten = 0;

  // Write one row per student
  if (Array.isArray(record.students)) {
    record.students.forEach(s => {
      sheet.appendRow([
        record.recordId,
        record.classId,
        record.className || '',
        record.date,
        record.eventName || '',
        record.slotLabel || '',
        s.simat || '',
        s.apellido1 || '',
        s.apellido2 || '',
        s.nombre1 || '',
        s.nombre2 || '',
        s.estado,
        record.facilitador || '',
        record.facilitadorId || '',
        record.facilitadorRol || '',
        record.savedAt || '',
        now
      ]);
      rowsWritten++;
    });
  }

  return { ok: true, rowsWritten: rowsWritten };
}
