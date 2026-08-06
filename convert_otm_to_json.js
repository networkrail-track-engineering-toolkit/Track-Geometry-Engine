/**
 * convert_otm_to_json.js
 * ----------------------
 * Converts the OTM Planning Excel file to otmData.json for use in the
 * Track Annotation Tool.
 *
 * Run from your project folder:
 *   node convert_otm_to_json.js
 *
 * Place this script and the Excel file in the same folder as server.ts.
 * Run it any time the Excel file is updated to regenerate otmData.json.
 */

const XLSX = require("xlsx");
const fs   = require("fs");
const path = require("path");

const OUTPUT_FILE = path.join(__dirname, "otmData.json");
const SHEET_NAME  = "OTM PLAN";

// Find all .xlsx files in the same folder and combine them
const xlsxFiles = fs.readdirSync(__dirname).filter(f => f.endsWith(".xlsx"));
if (xlsxFiles.length === 0) {
  console.error("ERROR: No .xlsx files found in this folder.");
  console.error("Place one or more OTM Planning Excel files in the same folder as this script.");
  process.exit(1);
}
console.log(`Found ${xlsxFiles.length} Excel file(s): ${xlsxFiles.join(", ")}`);


// Row 3 (0-indexed) is the header row in this sheet
const HEADER_ROW = 3;

function safeInt(val, fallback = 0) {
  const n = parseInt(val);
  return isNaN(n) ? fallback : n;
}

function safeFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function safeStr(val, fallback = "") {
  if (val === null || val === undefined) return fallback;
  return String(val).trim();
}

function chainsToYards(chains) {
  return Math.round(safeFloat(chains) * 22);
}

function excelDateToString(val) {
  if (!val) return "";
  // XLSX gives dates as JS Date objects when cellDates: true
  if (val instanceof Date) {
    return val.toISOString().split("T")[0];
  }
  return safeStr(val);
}

function processFile(filePath) {
  console.log(`Reading ${path.basename(filePath)}...`);
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet    = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    console.warn(`  WARNING: Sheet "${SHEET_NAME}" not found in ${path.basename(filePath)} — skipping.`);
    console.warn(`  Available sheets: ${workbook.SheetNames.join(", ")}`);
    return [];
  }

  const rows    = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const headers = rows[HEADER_ROW].map(h => (h !== null ? String(h).trim() : ""));

  function colIdx(name) { return headers.indexOf(name); }

  const iStatus  = colIdx("Status");
  const iELR     = colIdx("ELR");
  const iTrackID = colIdx("Track ID");
  const iLocation= colIdx("Location");
  const iOTM     = colIdx("OTM");
  const iDate    = colIdx("Date");
  const iStartM  = headers.indexOf("M");
  const iStartCH = headers.indexOf("CH");
  const iEndM    = headers.indexOf("M",  iStartM  + 1);
  const iEndCH   = headers.indexOf("CH", iStartCH + 1);

  const fileRecords = [];
  let fileSkipped = 0;

  for (let i = HEADER_ROW + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null)) continue;

    const elr     = safeStr(row[iELR]);
    const trackId = safeStr(row[iTrackID]);

    if (!elr || !trackId || trackId === "0") { fileSkipped++; continue; }

    const startMiles  = safeInt(row[iStartM]);
    const startChains = safeFloat(row[iStartCH]);
    const endMiles    = safeInt(row[iEndM],  startMiles);
    const endChains   = safeFloat(row[iEndCH], startChains);

    if (isNaN(startMiles) || isNaN(startChains)) { fileSkipped++; continue; }

    fileRecords.push({
      elr,
      trackId:    String(safeInt(trackId)),
      location:   safeStr(row[iLocation]),
      otm:        safeStr(row[iOTM]),
      status:     safeStr(row[iStatus]),
      date:       excelDateToString(row[iDate]),
      startMiles,
      startYards: chainsToYards(startChains),
      endMiles,
      endYards:   chainsToYards(endChains),
    });
  }

  console.log(`  -> ${fileRecords.length} records (${fileSkipped} skipped)`);
  return fileRecords;
}

const records = [];
let skipped = 0;

xlsxFiles.forEach(file => {
  const fileRecords = processFile(path.join(__dirname, file));
  records.push(...fileRecords);
});

// Write output
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(records, null, 2));

console.log(`\nConverted ${records.length} records (${skipped} skipped)`);
console.log(`Written to ${OUTPUT_FILE}`);

// Summary by ELR
const byELR = {};
records.forEach(r => { byELR[r.elr] = (byELR[r.elr] || 0) + 1; });
console.log("\nRecords by ELR:");
Object.keys(byELR).sort().forEach(elr => {
  console.log(`  ${elr}: ${byELR[elr]}`);
});