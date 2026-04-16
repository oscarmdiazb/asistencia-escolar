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
    .addSeparator()
    .addItem('Importar desde SIMAT…', 'importFromSimat')
    .addItem('Migrar encabezados a SIMAT', 'migrateHeaders')
    .addItem('Vaciar pestaña Clases', 'clearClases')
    .addSeparator()
    .addItem('Ver instrucciones de despliegue', 'showDeployHelp')
    .addToUi();
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

function handlePushAttendance(body) {
  var sheet = ensureTab('Asistencia', ASIST_HEADERS);
  var record = body.record;
  if (!record || !record.recordId) return { ok: false, error: 'Registro inválido' };

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

    var classId = grupo;
    if (!classMap[classId]) {
      classMap[classId] = {
        classId: classId,
        name: 'Grupo ' + grupo,
        school: String(row[colIdx.INSTITUCION] || '').trim(),
        sede: String(row[colIdx.SEDE] || '').trim(),
        jornada: String(row[colIdx.JORNADA] || '').trim(),
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
