import express from "express";
import multer from "multer";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { join } from "path";

interface SCRecord {
  elr: string;
  trackId: string;
  desc: string;
  railwayId?: string;
  startMiles: number;
  startYards: number;
  endMiles: number;
  endYards: number;
}

const SC_DATA: SCRecord[] = JSON.parse(
  readFileSync(join(__dirname, "scData.json"), "utf-8")
);

interface OTMRecord {
  elr: string;
  trackId: string;
  location: string;
  otm: string;
  status: string;
  date: string;
  startMiles: number;
  startYards: number;
  endMiles: number;
  endYards: number;
}

const OTM_DATA: OTMRecord[] = JSON.parse(
  readFileSync(join(__dirname, "otmData.json"), "utf-8")
);

interface StructureRecord {
  elr: string;
  trackId: string;
  name: string;
  assetType: string;
  railwayId: string;
  startMiles: number;
  startYards: number;
  endMiles: number;
  endYards: number;
}

const STRUCTURES_DATA: StructureRecord[] = JSON.parse(
  readFileSync(join(__dirname, "structuresData.json"), "utf-8")
);

interface TrackCatRecord {
  elr: string;
  trackId: string;
  startMiles: number;
  startYards: number;
  endMiles: number;
  endYards: number;
  speed: number | null;
  lastStcat: string | null;
}

const TRACKCAT_DATA: TrackCatRecord[] = JSON.parse(
  readFileSync(join(__dirname, "trackCatData.json"), "utf-8")
);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


/* ============================================================
   CONFIGURATION
============================================================ */

const CONFIG = {
  graphLeft: 73,
  graphRightOffset: 42,
  normalBoxHeight: 16,
  qualityBoxHeightRatio: 0.071,
  horizontalChainsWidth: 10,
  cycWidth: 54,
  cycTopRatio: 900,
  cycBottomRatio: 117,
  debug: false,

  // How many chains either side of the page mileage range we still
  // consider "on this page". 40 chains catches defects that appear
  // before the first or after the last mileage marker.
  pageMarginChains: 40,

  // Label settings — columns across the top of the page
  labelAreaTopMargin: 10,
  labelStartX: 5,          // X position where label columns start (from left edge of page)
  labelColumnWidth: 120,
  labelBoxGap: 6,
  labelFontSize: 7,
  labelLineHeight: 11,
  labelPadding: 5,
  labelHeaderFontSize: 7.5,

  // Number badge settings
  numberFontSize: 6,
  numberPadding: 2,

  // S&C annotation settings
  scLineThickness: 1.0,       // thickness of the green S&C vertical lines
  scLabelFontSize: 6,         // font size for S&C labels at the bottom
  scLabelBottomMargin: 8,     // gap from bottom of cycBottom to top of S&C label
  scLabelMaxWidth: 80,        // max width before truncating S&C label text
};

/* ============================================================
   PARAMETER MAP
============================================================ */

const PARAM_MAP: Record<string, string> = {
  // Faults CSV parameter names
  "Twist 3m":             "Twist3m",
  "Left Top / WT35":      "Ltop35m",
  "Right Top / WT35":     "Rtop35m",
  "Dip Angle":            "Dip",
  "Alignment 35m / AL35": "Amean35m",
  "Alignment 70m / AL70": "Amean70m",
  "MT70":                 "Mtop70m",
  "Mean Gauge":           "Gauge",
  // Quality CSV parameter names
  "AL35":       "Amean35m",
  "AL70":       "Amean70m",
  "WT35":       "Ltop35m",
  "Amean35m":   "Amean35m",
  "Amean70m":   "Amean70m",
  "Mtop70m":    "Mtop70m",
  "Twist3m":    "Twist3m",
  "Gauge":      "Gauge",
  "Crosslevel": "Crosslevel",
  "Curv":       "Curv",
  "CantDef":    "CantDef",
  "Cant Def":   "CantDef",
};

/* ============================================================
   ROW POSITIONS
============================================================ */

const ROW_POSITIONS: Record<string, number> = {
  Twist3m: 900,
  Ltop35m: 828,
  Dip: 757,
  Rtop35m: 686,
  Amean35m: 614,
  Amean70m: 544,
  Mtop70m: 473,
  Gauge: 401,
  Crosslevel: 330,
  Curv: 259,
  "Cant Def": 189,
};

/* ============================================================
   DEFECT ROWS TO CENTER
============================================================ */

const DEFECT_ROWS_TO_CENTER = [
  "Twist3m",
  "Ltop35m",
  "Dip",
  "Rtop35m",
  "Amean35m",
  "Amean70m",
  "Mtop70m",
  "Gauge",
  "Crosslevel",
  "Curv",
  "Cant Def"
];

/* ============================================================
   COLORS
============================================================ */

const POOR_BLUE = rgb(0, 0.204, 1);   // #0034FF

const COLORS = {
  VERY_POOR: rgb(1, 0, 0),
  SUPER_RED: rgb(0, 1, 1),
  POOR: POOR_BLUE,
  REPORTABLE: rgb(1, 0, 0.8),   // pink/magenta
  CYC: rgb(1, 0.56, 0),
  LABEL_FAULT_BORDER: rgb(1, 0, 0.9),
  LABEL_QUALITY_VERY_POOR_BORDER: rgb(1, 0, 0),
  LABEL_QUALITY_SUPER_RED_BORDER: rgb(0, 1, 1),  // matches Super Red annotation colour
  LABEL_QUALITY_POOR_BORDER: POOR_BLUE,
  LABEL_CYC_BORDER: rgb(1, 0.56, 0),
  LABEL_TEXT: rgb(0, 0, 0),
  LABEL_BG: rgb(1, 1, 1),
  SC_LINE: rgb(0, 0.6, 0),            // green for S&C lines
  SC_LABEL: rgb(0, 0.6, 0),           // green for S&C label text
  OTM_COMPLETED: rgb(0.18, 0.55, 0.34),  // green for completed tamps
  OTM_PLANNED:   rgb(0.13, 0.47, 0.71),  // blue for planned tamps
  OTM_LOST:      rgb(0.80, 0.20, 0.20),  // red for lost/cancelled/failed
  OTM_LABEL:     rgb(0, 0, 0),           // black label text
  STRUCT_LINE:   rgb(0.58, 0.0, 0.83),   // purple for structures
  STRUCT_LABEL:  rgb(0.58, 0.0, 0.83),
};

/* ============================================================
   UTILITIES
============================================================ */

function yardsToChains(yards: number) {
  return yards / 22;
}

function absoluteChains(mile: number, yards: number) {
  return (mile * 80) + yardsToChains(yards);
}

function formatMileage(miles: number, yards: number): string;
function formatMileage(absYards: number): string;
function formatMileage(milesOrAbs: number, yards?: number): string {
  if (yards === undefined) {
    const m = Math.floor(milesOrAbs / 1760);
    const y = Math.round(milesOrAbs % 1760);
    return `${m}m ${y}y`;
  }
  return `${milesOrAbs}m ${yards}y`;
}

function safeInt(val: any, fallback = 0): number {
  const n = parseInt(val);
  return isNaN(n) ? fallback : n;
}

function normaliseQualityBand(val: any): string {
  return (val || '').toString().trim().toLowerCase();
}

function isSuperRed(val: any): boolean {
  return normaliseQualityBand(val) === 'super red';
}

function isVeryPoor(val: any): boolean {
  return normaliseQualityBand(val) === 'very poor';
}

function isPoor(val: any): boolean {
  return normaliseQualityBand(val) === 'poor';
}

function isAnnotatedQuality(val: any): boolean {
  return isSuperRed(val) || isVeryPoor(val) || isPoor(val);
}

function qualityAnnotationColor(val: any): any {
  if (isSuperRed(val)) return COLORS.SUPER_RED;
  if (isPoor(val))     return COLORS.POOR;
  return COLORS.VERY_POOR;
}

function qualityLabelBorderColor(val: any): any {
  if (isSuperRed(val)) return COLORS.LABEL_QUALITY_SUPER_RED_BORDER;
  if (isPoor(val))     return COLORS.LABEL_QUALITY_POOR_BORDER;
  return COLORS.LABEL_QUALITY_VERY_POOR_BORDER;
}

// Truncate a string to fit within maxChars
function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 1) + '…';
}

/* ============================================================
   SERVER
============================================================ */

app.post("/api/process", upload.fields([
  { name: 'raw', maxCount: 1 },
  { name: 'faults', maxCount: 1 },
  { name: 'quality', maxCount: 1 }
]), async (req: any, res) => {

  try {
    const rawFile    = req.files['raw']?.[0];
    const faultsFile = req.files['faults']?.[0];
    const qualityFile = req.files['quality']?.[0];

    if (!rawFile || !faultsFile || !qualityFile) {
      return res.status(400).json({ error: "Missing required files" });
    }

    // Read annotation toggles from form data (default to true if not sent)
    const showFaults  = req.body.showFaults  !== '0';
    const showQuality = req.body.showQuality !== '0';
    const showSC      = req.body.showSC      !== '0';
    const showOTM          = req.body.showOTM          !== '0';
    const showUnderbridges = req.body.showUnderbridges !== '0';
    const showOverbridges  = req.body.showOverbridges  !== '0';
    const showCulverts     = req.body.showCulverts     !== '0';

    // Channel scales sent from browser (JSON) — fallback to server defaults
    const userScales: Record<string, number> = {};
    try {
      const parsed = JSON.parse(req.body.channelScales || '{}');
      Object.assign(userScales, parsed);
    } catch {}

    const parseCSV = (buffer: Buffer) => {
      const content = buffer.toString('utf-8');
      const lines = content.split(/\r?\n/);
      const headerIndex = lines.findIndex(line =>
        line.trim().startsWith('ELR,Track ID')
      );
      if (headerIndex === -1) {
        throw new Error("Could not find CSV header row.");
      }
      return parse(lines.slice(headerIndex).join('\n'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true
      });
    };

    // Extract ELR and Track ID from the raw CSV header line FIRST
    // e.g. "ELR: DOW    Track Id: 1100    ..."
    const rawContent = rawFile.buffer.toString('utf-8');
    const rawHeader  = rawContent.split(/\r?\n/)[0];
    const elrMatch   = rawHeader.match(/ELR:\s*(\S+)/);
    const tidMatch   = rawHeader.match(/Track Id:\s*(\d+)/);
    const traceELR     = elrMatch ? elrMatch[1].trim().toUpperCase() : '';
    const traceTrackId = tidMatch ? tidMatch[1].trim()               : '';

    console.log(`Trace ELR: ${traceELR}, Track ID: ${traceTrackId} (from raw CSV header)`);

    const allFaultsData  = parseCSV(faultsFile.buffer);
    const allQualityData = parseCSV(qualityFile.buffer);

    // Filter to only defects matching this trace's ELR and Track ID
    const faultsData  = allFaultsData.filter((f: any) =>
      (f['ELR'] || '').trim() === traceELR &&
      (f['Track ID'] || '').toString().trim() === traceTrackId
    );
    const qualityData = allQualityData.filter((q: any) =>
      (q['ELR'] || '').trim() === traceELR &&
      (q['Track ID'] || '').toString().trim() === traceTrackId
    );

    console.log(`Faults after ELR filter: ${faultsData.length} of ${allFaultsData.length}`);
    console.log(`Quality after ELR filter: ${qualityData.length} of ${allQualityData.length}`);

    // Filter S&C data to only assets matching this trace's ELR + Track ID
    const relevantSC = SC_DATA.filter(
      sc => sc.elr === traceELR && sc.trackId === traceTrackId
    );

    console.log(`Found ${relevantSC.length} matching S&C assets`);

    const relevantOTM = OTM_DATA.filter(
      o => o.elr === traceELR && o.trackId === traceTrackId
    );
    console.log(`Found ${relevantOTM.length} matching OTM plan entries`);

    const relevantStructures = STRUCTURES_DATA.filter(s => {
      if (s.elr !== traceELR) return false;
      // If the structure has a trackId, it must match; if not, include for all tracks on this ELR
      if (s.trackId && s.trackId !== traceTrackId) return false;
      return true;
    });
    console.log(`Found ${relevantStructures.length} matching structures`);

    /* ============================================================
       Parse raw CSV data points
    ============================================================ */

    interface RawPoint {
      mile: number;
      yards: number;
      absYards: number;
      values: Record<string, number | null>;
    }

    const RAW_CHANNEL_MAP: Record<string, number> = {
      Twist3m:    3,
      Ltop35m:    11,
      Dip:        16,
      Rtop35m:    10,
      Amean35m:   5,
      Amean70m:   6,
      Mtop70m:    7,
      Gauge:      9,
      Crosslevel: 8,
      Curv:       15,
      CantDef:    14,
    };

    const RAW_CHANNEL_LABELS: Record<string, string> = {
      Twist3m:    'Twist3m',
      Ltop35m:    'Ltop35m',
      Dip:        'Dip',
      Rtop35m:    'Rtop35m',
      Amean35m:   'Amean35m',
      Amean70m:   'Amean70m',
      Mtop70m:    'Mtop70m',
      Gauge:      'Gauge',
      Crosslevel: 'Crosslevel',
      Curv:       'Curv',
      CantDef:    'Cant Def',
    };

    const RAW_CHANNEL_SCALES: Record<string, number> = {
      Twist3m:    5,
      Ltop35m:    10,
      Dip:        10,
      Rtop35m:    10,
      Amean35m:   10,
      Amean70m:   10,
      Mtop70m:    10,
      Gauge:      10,
      Crosslevel: 50,
      Curv:       50,
      CantDef:    50,
    };

    const RAW_CHANNEL_COLORS: Record<string, [number,number,number]> = {
      Twist3m:    [0.08, 0.08, 0.08],
      Ltop35m:    [0.08, 0.08, 0.08],
      Dip:        [0.08, 0.08, 0.08],
      Rtop35m:    [0.08, 0.08, 0.08],
      Amean35m:   [0, 0.204, 1],
      Amean70m:   [0, 0.204, 1],
      Mtop70m:    [0.08, 0.08, 0.08],
      Gauge:      [0.08, 0.08, 0.08],
      Crosslevel: [0, 0.204, 1],
      Curv:       [0, 0.204, 1],
      CantDef:    [0, 0.204, 1],
    };

    const rawLines = rawContent.split(/\r?\n/);
    const rawPoints: RawPoint[] = [];

    for (let li = 4; li < rawLines.length; li++) {
      const line = rawLines[li].trim();
      if (!line) continue;
      const cols = line.split('	');
      if (cols.length < 16) continue;
      const mile  = parseFloat(cols[0]);
      const yards = parseFloat(cols[1]);
      if (isNaN(mile) || isNaN(yards)) continue;
      const absYards = mile * 1760 + yards;
      const values: Record<string, number | null> = {};
      for (const [key, idx] of Object.entries(RAW_CHANNEL_MAP)) {
        const v = parseFloat(cols[idx]);
        values[key] = isNaN(v) ? null : v;
      }
      rawPoints.push({ mile, yards, absYards, values });
    }

    console.log(`Parsed ${rawPoints.length} raw data points`);

    if (rawPoints.length < 2) {
      return res.status(400).json({ error: 'Raw data file has too few data points' });
    }

    // Extract survey date from raw header
    const rawDateMatch = rawHeader.match(/Date\(DD\/MM\/YYYY\):\s*(\d{2})\/(\d{2})\/(\d{4})/);
    let traceDate: Date | null = null;
    if (rawDateMatch) {
      traceDate = new Date(`${rawDateMatch[3]}-${rawDateMatch[2]}-${rawDateMatch[1]}`);
      console.log(`Trace survey date: ${traceDate.toISOString().split('T')[0]}`);
    } else {
      console.log('Could not extract survey date — showing all OTM entries');
    }

    // Filter OTM to +/- 10 weeks from survey date if date was found
    const TEN_WEEKS_MS = 10 * 7 * 24 * 60 * 60 * 1000;
    const filteredOTM = traceDate
      ? relevantOTM.filter(o => {
          if (!o.date) return false;
          const otmDate = new Date(o.date);
          if (isNaN(otmDate.getTime())) return false;
          return Math.abs(otmDate.getTime() - traceDate!.getTime()) <= TEN_WEEKS_MS;
        })
      : relevantOTM;

    console.log(`OTM entries within ±10 weeks: ${filteredOTM.length} of ${relevantOTM.length}`);

    /* ============================================================
       Build PDF — one page per mile of trace
    ============================================================ */

    // Page layout constants — A3 landscape
    const PAGE_W         = 1190.55; // A3 landscape width (pt)
    const PAGE_H         = 841.89;  // A3 landscape height (pt)
    const LABEL_W        = 70;
    const GRAPH_L        = LABEL_W;
    const GRAPH_R        = PAGE_W - 15;
    const GRAPH_W        = GRAPH_R - GRAPH_L;
    const HEADER_H       = 18;   // page header (tight — just title + date)
    const MILEAGE_H      = 16;   // mileage ruler bar
    const ANN_SC_H       = 16;   // S&C annotation channel
    const ANN_OTM_H      = 36;   // OTM annotation channel (needs detail rows)
    const ANN_STR_H      = 16;   // Structures annotation channel
    const LABEL_ROW_H    = 22;   // defect label boxes row at very bottom
    const ANN_TOTAL      = ANN_SC_H + ANN_OTM_H + ANN_STR_H;
    const ANN_H          = ANN_SC_H; // kept for compatibility
    const FOOTER_H       = 10;   // page footer (just page number)
    const CHANNEL_KEYS   = Object.keys(RAW_CHANNEL_MAP);
    const NUM_CHANNELS   = CHANNEL_KEYS.length;
    // Remaining height split evenly across 11 data channels
    const AVAILABLE_H    = PAGE_H - HEADER_H - MILEAGE_H - ANN_TOTAL - LABEL_ROW_H - FOOTER_H - 4;
    const CH_HEIGHT      = AVAILABLE_H / NUM_CHANNELS;

    // 1 mile (1760 yards) per page
    const YARDS_PER_PAGE = 1760;
    const minAbs = rawPoints[0].absYards;
    const maxAbs = rawPoints[rawPoints.length - 1].absYards;
    const numPages = Math.ceil((maxAbs - minAbs) / YARDS_PER_PAGE);

    const pdfDoc = await PDFDocument.create();
    const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Global defect counter across pages
    let defectCounter = 1;
    const labelledDefects = new Set<string>();
    const defectPageMap   = new Map<string, number>();

    for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {

      const pageStartAbs = minAbs + pageIdx * YARDS_PER_PAGE;
      const pageEndAbs   = pageStartAbs + YARDS_PER_PAGE;

      // Points on this page
      const pagePoints = rawPoints.filter(p =>
        p.absYards >= pageStartAbs - 5 && p.absYards <= pageEndAbs + 5
      );
      if (pagePoints.length < 2) continue;

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      function absToX(absYards: number): number {
        return GRAPH_L + ((absYards - pageStartAbs) / YARDS_PER_PAGE) * GRAPH_W;
      }

      function isOnPage(mile: number, yards: number): boolean {
        const abs = mile * 1760 + yards;
        return abs >= pageStartAbs - 20 && abs <= pageEndAbs + 20;
      }

      function isOnPageStrict(mile: number, yards: number): boolean {
        const abs = mile * 1760 + yards;
        return abs >= pageStartAbs - 10 && abs <= pageEndAbs + 10;
      }

      // ── Header ────────────────────────────────────────────────
      // ── Page header ───────────────────────────────────────────
      page.drawText(`Track Geometry — ${traceELR}  Track ${traceTrackId}`, {
        x: GRAPH_L, y: PAGE_H - 11,
        size: 8, font: fontB, color: rgb(0.08, 0.08, 0.08),
      });
      page.drawText(`Date: ${rawDateMatch ? `${rawDateMatch[1]}/${rawDateMatch[2]}/${rawDateMatch[3]}` : ''}   Page ${pageIdx + 1} of ${numPages}`, {
        x: GRAPH_R - 150, y: PAGE_H - 11,
        size: 7, font, color: rgb(0.4, 0.4, 0.4),
      });

      // ── Mileage ruler at top of trace ─────────────────────────
      const rulerY = PAGE_H - HEADER_H - MILEAGE_H;
      // Ruler background
      page.drawRectangle({ x: GRAPH_L, y: rulerY, width: GRAPH_W, height: MILEAGE_H, color: rgb(0.95,0.95,0.95) });
      page.drawLine({ start: { x: GRAPH_L, y: rulerY + MILEAGE_H }, end: { x: GRAPH_R, y: rulerY + MILEAGE_H }, thickness: 0.5, color: rgb(0.6,0.6,0.6) });
      page.drawLine({ start: { x: GRAPH_L, y: rulerY }, end: { x: GRAPH_R, y: rulerY }, thickness: 0.5, color: rgb(0.6,0.6,0.6) });

      // Ticks every 220 yards (1 furlong)
      const tickInterval = 220;
      const firstTick = Math.ceil(pageStartAbs / tickInterval) * tickInterval;
      for (let abs = firstTick; abs <= pageEndAbs; abs += tickInterval) {
        const x = absToX(abs);
        if (x < GRAPH_L || x > GRAPH_R) continue;
        const mile  = Math.floor(abs / 1760);
        const yards = Math.round(abs % 1760);
        const isMajor = yards % 880 === 0;
        page.drawLine({
          start: { x, y: rulerY + MILEAGE_H },
          end:   { x, y: rulerY + MILEAGE_H - (isMajor ? 10 : 5) },
          thickness: isMajor ? 0.8 : 0.3,
          color: rgb(0.3, 0.3, 0.3),
        });
        const label = yards === 0 ? `${mile}m` : `${mile}m ${yards}y`;
        page.drawText(label, {
          x: x - (label.length * 1.8), y: rulerY + 4,
          size: isMajor ? 5.5 : 4.5, font: isMajor ? fontB : font, color: rgb(0.2, 0.2, 0.2),
        });
      }

      // ── Draw channels ─────────────────────────────────────────
      const channelTop = rulerY - 2;

      CHANNEL_KEYS.forEach((key, chIdx) => {
        const chY      = channelTop - chIdx * CH_HEIGHT;
        const chBottom = chY - CH_HEIGHT;
        const midY     = chY - CH_HEIGHT / 2;
        const scale    = userScales[key] ?? RAW_CHANNEL_SCALES[key];
        const [cr, cg, cb] = RAW_CHANNEL_COLORS[key];
        const label    = RAW_CHANNEL_LABELS[key];

        // Channel background (alternating)
        if (chIdx % 2 === 0) {
          page.drawRectangle({
            x: GRAPH_L, y: chBottom, width: GRAPH_W, height: CH_HEIGHT,
            color: rgb(0.97, 0.97, 0.97),
          });
        }

        // Channel border
        page.drawLine({ start: { x: GRAPH_L, y: chY }, end: { x: GRAPH_R, y: chY }, thickness: 0.3, color: rgb(0.8,0.8,0.8) });

        // Threshold dotted lines at ±scale and ±scale/2
        for (const mult of [-1, -0.5, 0.5, 1]) {
          const ty = midY + (mult * CH_HEIGHT * 0.4);
          if (ty < chBottom || ty > chY) continue;
          page.drawLine({
            start: { x: GRAPH_L, y: ty }, end: { x: GRAPH_R, y: ty },
            thickness: 0.4, color: rgb(1, 0.7, 0.7), dashArray: [2, 2],
          });
        }

        // Zero line
        page.drawLine({ start: { x: GRAPH_L, y: midY }, end: { x: GRAPH_R, y: midY }, thickness: 0.3, color: rgb(0.85,0.85,0.85) });

        // Channel label
        page.drawText(label, {
          x: 4, y: midY + 3,
          size: 6, font: fontB, color: rgb(0.2, 0.2, 0.2),
        });
        page.drawText(`${scale} /div`, {
          x: 4, y: midY - 6,
          size: 5, font, color: rgb(0.5, 0.5, 0.5),
        });

        // Draw trace polyline — sample to avoid too many ops
        const maxSegments = 800;
        const step = Math.max(1, Math.floor(pagePoints.length / maxSegments));
        let prevX: number | null = null;
        let prevY: number | null = null;

        for (let pi = 0; pi < pagePoints.length; pi += step) {
          const p = pagePoints[pi];
          const v = p.values[key];
          if (v === null) { prevX = null; prevY = null; continue; }
          const x  = absToX(p.absYards);
          const y  = midY + (v / scale) * (CH_HEIGHT * 0.4);
          const cy = Math.max(chBottom, Math.min(chY, y));
          if (prevX !== null && prevY !== null) {
            page.drawLine({
              start: { x: prevX, y: prevY }, end: { x, y: cy },
              thickness: 0.6, color: rgb(cr, cg, cb),
            });
          }
          prevX = x; prevY = cy;
        }
      });

      // Graph border
      page.drawRectangle({
        x: GRAPH_L, y: channelTop - NUM_CHANNELS * CH_HEIGHT,
        width: GRAPH_W, height: NUM_CHANNELS * CH_HEIGHT,
        borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5,
      });

      // ── S&C lines ─────────────────────────────────────────────
      const cycTop    = channelTop;
      const cycBottom = channelTop - NUM_CHANNELS * CH_HEIGHT;

      if (showSC) {
        relevantSC.forEach((sc) => {
          try {
            const startOnPage = isOnPage(sc.startMiles, sc.startYards);
            const endOnPage   = isOnPage(sc.endMiles, sc.endYards);
            if (!startOnPage && !endOnPage) return;

            const startX = startOnPage ? absToX(sc.startMiles * 1760 + sc.startYards) : GRAPH_L;
            const endX   = endOnPage   ? absToX(sc.endMiles   * 1760 + sc.endYards)   : GRAPH_R;
            const clampX = (x: number) => Math.max(GRAPH_L, Math.min(x, GRAPH_R));

            if (startOnPage) page.drawLine({ start: { x: clampX(startX), y: cycBottom }, end: { x: clampX(startX), y: cycTop }, thickness: 0.8, color: COLORS.SC_LINE });
            if (endOnPage && Math.abs(endX - startX) > 2) page.drawLine({ start: { x: clampX(endX), y: cycBottom }, end: { x: clampX(endX), y: cycTop }, thickness: 0.8, color: COLORS.SC_LINE });

            const labelAnchorX = startOnPage ? clampX(startX) : clampX(endX);
            const labelText = truncateText(sc.desc, 10);
            page.drawText(labelText, { x: labelAnchorX + 1, y: cycBottom + 4, size: 5, font, color: COLORS.SC_LABEL });
          } catch (e) {}
        });
      }

      // ── OTM boxes ─────────────────────────────────────────────
      if (showOTM) {
        const otmByDate = new Map<string, { otms: typeof filteredOTM, minX: number, maxX: number }>();
        filteredOTM.forEach((otm) => {
          try {
            const startOnPage = isOnPage(otm.startMiles, otm.startYards);
            const endOnPage   = isOnPage(otm.endMiles,   otm.endYards);
            if (!startOnPage && !endOnPage) return;

            const startX = startOnPage ? absToX(otm.startMiles * 1760 + otm.startYards) : GRAPH_L;
            const endX   = endOnPage   ? absToX(otm.endMiles   * 1760 + otm.endYards)   : GRAPH_R;
            const leftX  = Math.max(GRAPH_L, Math.min(Math.min(startX, endX), GRAPH_R));
            const rightX = Math.max(GRAPH_L, Math.min(Math.max(startX, endX), GRAPH_R));
            const bw     = rightX - leftX;
            if (bw < 1) return;

            const statusLower = (otm.status || '').toLowerCase();
            const boxColor = (statusLower === 'completed' || statusLower === 'partial')
              ? COLORS.OTM_COMPLETED
              : (statusLower === 'planned' || statusLower === 'replan')
                ? COLORS.OTM_PLANNED
                : COLORS.OTM_LOST;

            page.drawRectangle({ x: leftX, y: cycBottom, width: bw, height: cycTop - cycBottom, color: boxColor, opacity: 0.2, borderColor: boxColor, borderWidth: 0.6 });

            const dk = otm.date || 'unknown';
            if (!otmByDate.has(dk)) otmByDate.set(dk, { otms: [], minX: leftX, maxX: rightX });
            const g = otmByDate.get(dk)!;
            g.otms.push(otm); g.minX = Math.min(g.minX, leftX); g.maxX = Math.max(g.maxX, rightX);
          } catch (e) {}
        });
        otmByDate.forEach((g, dk) => {
          const cx = (g.minX + g.maxX) / 2;
          const lbl = truncateText(g.otms[0].otm || g.otms[0].location, 12);
          page.drawText(lbl, { x: Math.max(GRAPH_L, cx - lbl.length * 2.5), y: cycBottom + 6, size: 5, font, color: COLORS.OTM_LABEL });
          if (dk !== 'unknown') page.drawText(dk.substring(0, 10), { x: Math.max(GRAPH_L, cx - 15), y: cycBottom + 1, size: 4.5, font, color: COLORS.OTM_LABEL });
        });
      }

      // ── Structures ────────────────────────────────────────────
      relevantStructures.forEach((s) => {
        try {
          if (!isOnPage(s.startMiles, s.startYards)) return;
          const isUB = s.assetType === 'Underbridge';
          const isOB = s.assetType === 'Overbridge' || s.assetType === 'Footbridge';
          const isUC = s.assetType === 'Underline Culvert';
          if (isUB && !showUnderbridges) return;
          if (isOB && !showOverbridges)  return;
          if (isUC && !showCulverts)     return;

          const x = absToX(s.startMiles * 1760 + s.startYards);
          const cx = Math.max(GRAPH_L, Math.min(x, GRAPH_R));
          page.drawLine({ start: { x: cx, y: cycBottom }, end: { x: cx, y: cycTop }, thickness: 0.6, color: COLORS.STRUCT_LINE, dashArray: [2, 2] });

          const typeAbbr: Record<string, string> = { 'Overbridge': 'OB', 'Underbridge': 'UB', 'Underline Culvert': 'UC', 'Footbridge': 'FB' };
          const abbr = typeAbbr[s.assetType] || s.assetType.substring(0, 2).toUpperCase();
          const lbl = s.name + ' [' + abbr + ']';
          page.drawText(truncateText(lbl, 20), { x: cx + 1, y: cycTop - 10, size: 4.5, font, color: COLORS.STRUCT_LABEL });
        } catch (e) {}
      });

      // ── Defect labels + annotations ───────────────────────────
      const pageLabels: any[] = [];

      if (showFaults) {
        faultsData.forEach((f: any) => {
          try {
            const sm = safeInt(f['Start Miles']);
            const sy = safeInt(f['Start Yards']);
            if (!isOnPageStrict(sm, sy)) return;
            const isCyc = (f['Parameter'] || '').toLowerCase().includes('cyc');
            if (!isCyc) {
              const rn = PARAM_MAP[f['Parameter']] || f['Parameter'];
              if (!ROW_POSITIONS[rn]) return;
            }
            const fk = `${sm}_${sy}_${f['Parameter']}`;
            if (labelledDefects.has(fk)) return;
            labelledDefects.add(fk);
            defectPageMap.set(fk, pageIdx);
            const em = safeInt(f['End Miles'], sm);
            const ey = safeInt(f['End Yards'], sy);
            pageLabels.push({
              number: defectCounter++, type: 'fault',
              mileageFrom: formatMileage(sm * 1760 + sy),
              mileageTo: formatMileage(em * 1760 + ey),
              defectType: f['Parameter'] || 'Unknown',
              detail: (f['Fault Size'] || '').trim(),
              borderColor: isCyc ? COLORS.LABEL_CYC_BORDER : COLORS.LABEL_FAULT_BORDER,
              sm, sy, em, ey, param: f['Parameter'], isCyc,
            });
          } catch (e) {}
        });
      }

      if (showQuality) {
        qualityData.forEach((q: any) => {
          try {
            if (!isAnnotatedQuality(q['Quality Band'])) return;
            const sm = safeInt(q['Start Miles']);
            const sy = safeInt(q['Start Yards']);
            if (!isOnPageStrict(sm, sy)) return;
            const rn = PARAM_MAP[q['Parameter']] || q['Parameter'];
            if (!ROW_POSITIONS[rn]) return;
            const qk = `${sm}_${sy}_${q['Parameter']}_${q['Quality Band']}`;
            if (labelledDefects.has(qk)) return;
            labelledDefects.add(qk);
            defectPageMap.set(qk, pageIdx);
            const qey = safeInt(q['End Yards'], sy);
            pageLabels.push({
              number: defectCounter++, type: 'quality',
              mileageFrom: formatMileage(sm * 1760 + sy),
              mileageTo: formatMileage(sm * 1760 + qey),
              defectType: q['Parameter'] || 'Unknown',
              detail: (q['Quality Band'] || '').toString().trim(),
              borderColor: qualityLabelBorderColor(q['Quality Band']),
              sm, sy, ey: qey, param: q['Parameter'], qualityBand: q['Quality Band'],
            });
          } catch (e) {}
        });
      }

      // Label boxes drawn AFTER annotation channels so we know final annCursor position
      // (stored and drawn below)
      const savedPageLabels = pageLabels;

      // Draw defect annotations on trace
      // drawDefectBox: draws transparent coloured box spanning start->end mileage
      const drawDefectBox = (startAbs: number, endAbs: number, chKey: string, color: any, number: number, isCyc: boolean) => {
        const x1 = absToX(startAbs);
        const x2 = absToX(endAbs);
        if (x1 > GRAPH_R + 20 || x2 < GRAPH_L - 20) return;
        const bx = Math.max(GRAPH_L, x1);
        const bx2 = Math.min(GRAPH_R, x2);
        // Minimum visible width for point faults
        const minW = 5;
        const bw = Math.max(minW, bx2 - bx);
        const drawBx = bw === minW ? Math.max(GRAPH_L, x1 - minW / 2) : bx;

        if (isCyc) {
          page.drawRectangle({ x: drawBx, y: cycBottom, width: bw, height: cycTop - cycBottom, color, opacity: 0.15, borderColor: color, borderWidth: 1 });
        } else {
          const chIdx = CHANNEL_KEYS.indexOf(chKey);
          if (chIdx < 0) return;
          const chY      = channelTop - chIdx * CH_HEIGHT;
          const chBottom = chY - CH_HEIGHT;
          page.drawRectangle({ x: drawBx, y: chBottom, width: bw, height: CH_HEIGHT, color, opacity: 0.2, borderColor: color, borderWidth: 0.8 });
          // Number badge at top
          const ns = String(number);
          const badgeW = ns.length * 4 + 4;
          const badgeX = Math.min(drawBx + 1, GRAPH_R - badgeW);
          page.drawRectangle({ x: badgeX, y: chY - 8, width: badgeW, height: 7, color: rgb(1,1,1), borderColor: color, borderWidth: 0.5 });
          page.drawText(ns, { x: badgeX + 2, y: chY - 7, size: 5, font, color: rgb(0,0,0) });
        }
      };

      pageLabels.forEach((lbl) => {
        if (lbl.type === 'fault') {
          const fk = `${lbl.sm}_${lbl.sy}_${lbl.param}`;
          if (defectPageMap.get(fk) !== pageIdx) return;
          const isCyc = lbl.isCyc;
          const color = isCyc ? COLORS.CYC : COLORS.REPORTABLE;
          // PARAM_MAP returns a channel key directly (e.g. 'Gauge', 'CantDef')
          const rawCh = isCyc ? '' : (PARAM_MAP[lbl.param] || lbl.param);
          const startAbs = lbl.sm * 1760 + lbl.sy;
          const endAbs   = lbl.em * 1760 + lbl.ey;
          drawDefectBox(startAbs, endAbs, rawCh, color, lbl.number, isCyc);
        } else {
          const qk = `${lbl.sm}_${lbl.sy}_${lbl.param}_${lbl.qualityBand}`;
          if (defectPageMap.get(qk) !== pageIdx) return;
          const rawCh = PARAM_MAP[lbl.param] || lbl.param;
          const qStartAbs = lbl.sm * 1760 + lbl.sy;
          const qEndAbs   = lbl.sm * 1760 + lbl.ey;
          drawDefectBox(qStartAbs, qEndAbs, rawCh, qualityAnnotationColor(lbl.qualityBand), lbl.number, false);
        }
      });

      // ── Annotation channels at bottom ────────────────────────
      // Stack cleanly below graph: each channel butts up against the one above
      const SC_H  = ANN_SC_H;
      const OTM_H = ANN_OTM_H;
      const STR_H = ANN_STR_H;
      let annCursor = cycBottom - 2; // start just below graph

      // S&C channel
      if (showSC) {
        const scY = annCursor - SC_H;
        annCursor = scY;
        page.drawRectangle({ x: GRAPH_L, y: scY, width: GRAPH_W, height: SC_H, color: rgb(0.97,1,0.97) });
        page.drawLine({ start:{x:GRAPH_L,y:scY+SC_H}, end:{x:GRAPH_R,y:scY+SC_H}, thickness:0.4, color:rgb(0,0.6,0) });
        page.drawLine({ start:{x:GRAPH_L,y:scY},       end:{x:GRAPH_R,y:scY},       thickness:0.4, color:rgb(0,0.6,0) });
        page.drawText('S&C', { x: 4, y: scY + 5, size: 5, font: fontB, color: rgb(0,0.6,0) });
        relevantSC.forEach(sc => {
          try {
            if (!isOnPage(sc.startMiles, sc.startYards) && !isOnPage(sc.endMiles, sc.endYards)) return;
            const sx = Math.max(GRAPH_L, Math.min(absToX(sc.startMiles * 1760 + sc.startYards), GRAPH_R));
            page.drawLine({ start:{x:sx,y:scY}, end:{x:sx,y:scY+SC_H}, thickness:1, color:rgb(0,0.6,0) });
            page.drawText((sc.desc||sc.railwayId||'').substring(0,14), { x:sx+1, y:scY+4, size:4, font, color:rgb(0,0.6,0) });
          } catch(e){}
        });
      }

      // OTM channel
      if (showOTM) {
        const otmY = annCursor - OTM_H;
        annCursor = otmY;
        page.drawRectangle({ x: GRAPH_L, y: otmY, width: GRAPH_W, height: OTM_H, color: rgb(0.97,0.99,0.97) });
        page.drawLine({ start:{x:GRAPH_L,y:otmY+OTM_H}, end:{x:GRAPH_R,y:otmY+OTM_H}, thickness:0.4, color:rgb(0.18,0.55,0.34) });
        page.drawLine({ start:{x:GRAPH_L,y:otmY},        end:{x:GRAPH_R,y:otmY},        thickness:0.4, color:rgb(0.18,0.55,0.34) });
        page.drawText('OTM Plan', { x: 4, y: otmY + 6, size: 5, font: fontB, color: rgb(0.18,0.55,0.34) });
        filteredOTM.forEach(otm => {
          try {
            if (!isOnPage(otm.startMiles, otm.startYards) && !isOnPage(otm.endMiles, otm.endYards)) return;
            const ox1 = Math.max(GRAPH_L, absToX(otm.startMiles * 1760 + otm.startYards));
            const ox2 = Math.min(GRAPH_R, absToX(otm.endMiles   * 1760 + otm.endYards));
            const ow = Math.max(3, ox2 - ox1);
            const sl = (otm.status||'').toLowerCase();
            const bc = sl.includes('complet') ? rgb(0.18,0.55,0.34) : sl.includes('plan') ? rgb(0.13,0.47,0.71) : rgb(0.8,0.2,0.2);
            // Box spanning the shift
            page.drawRectangle({ x:ox1, y:otmY+1, width:ow, height:OTM_H-2, color:bc, opacity:0.15, borderColor:bc, borderWidth:0.6 });
            // Detail lines inside box
            const lx = Math.max(ox1 + 2, GRAPH_L + 2);
            const mFrom = formatMileage(otm.startMiles * 1760 + otm.startYards);
            const mTo   = formatMileage(otm.endMiles   * 1760 + otm.endYards);
            page.drawText((otm.location || '').substring(0, 30),      { x:lx, y:otmY+OTM_H-8,  size:4.5, font:fontB, color:bc });
            page.drawText((otm.otm      || '').substring(0, 30),      { x:lx, y:otmY+OTM_H-15, size:4,   font,       color:bc });
            page.drawText((otm.date     || '').substring(0, 12),      { x:lx, y:otmY+OTM_H-22, size:4,   font,       color:bc });
            page.drawText(`${mFrom} — ${mTo}`,                        { x:lx, y:otmY+OTM_H-29, size:4,   font,       color:bc });
          } catch(e){}
        });
      }

      // Structures channel
      const showAnyStruct = showUnderbridges || showOverbridges || showCulverts;
      if (showAnyStruct) {
        const strY = annCursor - STR_H;
        annCursor = strY;
        page.drawRectangle({ x: GRAPH_L, y: strY, width: GRAPH_W, height: STR_H, color: rgb(0.99,0.97,1) });
        page.drawLine({ start:{x:GRAPH_L,y:strY+STR_H}, end:{x:GRAPH_R,y:strY+STR_H}, thickness:0.4, color:rgb(0.58,0,0.83) });
        page.drawLine({ start:{x:GRAPH_L,y:strY},        end:{x:GRAPH_R,y:strY},        thickness:0.4, color:rgb(0.58,0,0.83) });
        page.drawText('Structures', { x: 4, y: strY + 4, size: 5, font: fontB, color: rgb(0.58,0,0.83) });
        relevantStructures.forEach(s => {
          try {
            if (!isOnPage(s.startMiles, s.startYards)) return;
            const isUB = s.assetType === 'Underbridge';
            const isOB = s.assetType === 'Overbridge' || s.assetType === 'Footbridge';
            const isUC = s.assetType === 'Underline Culvert';
            if (isUB && !showUnderbridges) return;
            if (isOB && !showOverbridges)  return;
            if (isUC && !showCulverts)     return;
            const stx = Math.max(GRAPH_L, Math.min(absToX(s.startMiles * 1760 + s.startYards), GRAPH_R));
            page.drawLine({ start:{x:stx,y:strY}, end:{x:stx,y:strY+STR_H}, thickness:0.8, color:rgb(0.58,0,0.83), dashArray:[2,1] });
            const typeAbbr: Record<string,string> = {'Overbridge':'OB','Underbridge':'UB','Underline Culvert':'UC','Footbridge':'FB'};
            const abbr = typeAbbr[s.assetType] || '??';
            page.drawText(s.name.substring(0,14)+' ['+abbr+']', { x:stx+1, y:strY+4, size:4, font, color:rgb(0.58,0,0.83) });
          } catch(e){}
        });
      }

      // ── Defect label boxes — below all annotation channels ────
      if (savedPageLabels.length > 0) {
        const lbH = LABEL_ROW_H - 2, lbW = 105, lbGap = 3;
        const lblRowY = annCursor - LABEL_ROW_H;
        savedPageLabels.forEach((lbl: any, idx: number) => {
          const lx = GRAPH_L + idx * (lbW + lbGap);
          if (lx + lbW > GRAPH_R + 10) return;
          page.drawRectangle({ x: lx, y: lblRowY, width: lbW, height: lbH, color: rgb(1,1,1), borderColor: lbl.borderColor, borderWidth: 1 });
          page.drawText(`${lbl.number}. ${lbl.mileageFrom} — ${lbl.mileageTo}`, { x: lx + 3, y: lblRowY + lbH - 7, size: 5.5, font: fontB, color: rgb(0,0,0) });
          page.drawText(lbl.defectType, { x: lx + 3, y: lblRowY + lbH - 13, size: 5, font, color: rgb(0,0,0) });
          page.drawText(lbl.detail, { x: lx + 3, y: lblRowY + lbH - 19, size: 5, font, color: rgb(0.3,0.3,0.3) });
        });
      }

      // ── Page footer ───────────────────────────────────────────
      const footY = 3;
      const startLabel = formatMileage(pageStartAbs);
      const endLabel   = formatMileage(Math.min(pageEndAbs, maxAbs));
      page.drawText(`${startLabel} — ${endLabel}`, { x: GRAPH_L, y: footY, size: 6, font, color: rgb(0.5,0.5,0.5) });
      page.drawText(`Page ${pageIdx + 1} / ${numPages}`, { x: GRAPH_R - 50, y: footY, size: 6, font, color: rgb(0.5,0.5,0.5) });
    }

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="annotated_trace.pdf"`);
    res.setHeader('Content-Length', pdfBytes.length);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Processing failed" });
  }
});


// ─── CDDS Proxy endpoints ────────────────────────────────────────────────────
const CDDS_BASE = 'http://cdds.corp.ukrail.net/WEBQUERY/WEBQUERY';

async function cddsGet(params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams({ username: 'excelreport', wb: 'ascii_data_pump', ...params });
  const url = `${CDDS_BASE}?${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`CDDS responded ${resp.status}`);
    return await resp.text();
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('CDDS request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/cdds/elrs — list all ELRs
app.get('/api/cdds/elrs', async (_req: any, res: any) => {
  try {
    const text = await cddsGet({ ws: 'elrs' });
    const elrs = parseTabularResponse(text);
    res.json({ elrs });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/cdds/tids?elr=ECM1 — list track IDs for an ELR
app.get('/api/cdds/tids', async (req: any, res: any) => {
  try {
    const text = await cddsGet({ ws: 'tids', p0: req.query.elr });
    const tids = parseTabularResponse(text);
    res.json({ tids });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/cdds/dates?elr=ECM1&tid=1100&sy=0&ey=5280 — available survey dates
app.get('/api/cdds/dates', async (req: any, res: any) => {
  try {
    const { elr, tid, sy, ey } = req.query as any;
    const text = await cddsGet({ ws: 'dates', p0: elr, p1: tid, p2: sy, p3: ey });
    const dates = parseTabularResponse(text);
    // Sort newest first — dates come as "YYYY-MM-DD HH:MM:SS.S"
    dates.sort((a: string, b: string) => b.localeCompare(a));
    res.json({ dates });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/cdds/data?elr=ECM1&tid=1100&sy=0&ey=5280&date=16/03/2026 — fetch + parse trace
app.get('/api/cdds/data', async (req: any, res: any) => {
  try {
    const { elr, tid, sy, ey, date } = req.query as any;
    // Convert date from DB format "2026-03-16 00:00:00.0" or ISO "2026-03-16" to "16/03/2026"
    let queryDate = date as string;
    const isoMatch = queryDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) queryDate = `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

    const startYard = parseInt(sy);
    const endYard   = parseInt(ey);
    // CDDS stores data in 220-yard (1 furlong) segments — align to these boundaries
    const CDDS_CHUNK = 220;
    const alignedStart = Math.floor(startYard / 220) * 220;
    const alignedEnd   = Math.ceil(endYard / 220) * 220;

    console.log(`CDDS fetch: elr=${elr} tid=${tid} sy=${startYard} ey=${endYard} date=${queryDate}`);
    console.log(`Total yards: ${endYard - startYard}, chunks needed: ${Math.ceil((endYard - startYard) / CDDS_CHUNK)}`);

    // Store chunks with accurate position — each chunk knows its yard range and point count
    // step = chunkSize/nPoints (CDDS doesn't always use 0.25y)
    interface ChunkRecord { startYard: number; endYard: number; nPoints: number; data: Record<string, number[]>; }
    const chunks: ChunkRecord[] = [];
    let firstDate = queryDate;
    let consecutiveEmpty = 0;

    for (let chunkStart = alignedStart; chunkStart < alignedEnd; chunkStart += CDDS_CHUNK) {
      const chunkEnd = Math.min(chunkStart + CDDS_CHUNK, alignedEnd);
      const html = await cddsGet({ ws: 'ascii_data_pump_qry', p0: elr, p1: tid, p2: String(chunkStart), p3: String(chunkEnd), p4: queryDate });

      if (html.includes('Error Message') || html.includes('error code')) {
        console.log(`Chunk ${chunkStart}-${chunkEnd}: CDDS error response`);
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }

      const { channelData, meta } = parseCDDSChunk(html);
      const chunkPointCount = Object.values(channelData)[0]?.length || 0;

      if (chunks.length === 0 && meta.date) firstDate = meta.date;

      if (chunkPointCount === 0) {
        console.log(`Chunk ${chunkStart}-${chunkEnd}: 0 points returned`);
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }
      consecutiveEmpty = 0;
      chunks.push({ startYard: chunkStart, endYard: chunkEnd, nPoints: chunkPointCount, data: channelData });
      console.log(`Chunk ${chunkStart}-${chunkEnd}: ${chunkPointCount} points`);
    }

    const csv = buildCSVFromChunks(chunks, firstDate, elr, tid);
    if (!csv) return res.status(502).json({ error: 'No data returned from CDDS' });

    const lines = csv.split('\n').length;
    console.log(`Final CSV: ${csv.length} chars, ${lines} lines`);
    res.set('Content-Type', 'text/plain');
    res.send(csv);
  } catch (e: any) {
    console.error('CDDS error:', e);
    res.status(502).json({ error: e.message });
  }
});

// Parse the HTML table responses CDDS returns into arrays of values (for ELR/TID/dates)
function parseTabularResponse(html: string): string[] {
  const matches = html.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
  return matches
    .map(m => m.replace(/<[^>]+>/g, '').trim())
    .filter(v => v.length > 0 && v !== 'To_Avoid_Formula');
}

// CDDS parameter name → our channel key
const CDDS_PARAM_MAP: Record<string, string> = {
  'AligMS':      'AligMS',
  'AligML':      'AligML',
  'Cant Def':    'CantDef',
  'Crosslevel':  'Crosslevel',
  'Curvature':   'Curvature',
  'Gauge':       'Gauge',
  'TopLS':       'TopLS',
  'TopRS':       'TopRS',
  'TopML':       'TopML',
  'Twist1':      'Twist1',
  'Dipped Left': 'DippedLeft',
  'Dipped Right':'DippedRight',
  'Gradient':    'Gradient',
  'Velocity':    'Velocity',
};

// CSV column order matching our raw CSV format
// "Locn mile, Locn yards, Locn chs, Twist1, Twist2, AligMS, AligML, TopML,
//  Crosslevel, Gauge, TopRS, TopLS, Velocity, Gradient, Cant Def, Curvature,
//  Dipped Left, Dipped Right"
const CSV_COL_ORDER = [
  'Twist1', 'Twist2', 'AligMS', 'AligML', 'TopML',
  'Crosslevel', 'Gauge', 'TopRS', 'TopLS', 'Velocity',
  'Gradient', 'Cant Def', 'Curvature', 'Dipped Left', 'Dipped Right'
];

// Parse one CDDS HTML chunk into channel data arrays + metadata
function parseCDDSChunk(html: string): { channelData: Record<string, number[]>, meta: any } {
  const rows = html.match(/<tr>[\s\S]*?(?=<tr>|$)/gi) || [];
  const channelData: Record<string, number[]> = {};
  let meta: any = {};

  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, '').trim());
    if (cells.length < 5) continue;
    const paramName = cells[0];
    if (!paramName || paramName === 'To_Avoid_Formula') continue;

    if (cells.length >= 17) {
      meta.startYardAbs = parseInt(cells[3]) || meta.startYardAbs || 0;
      meta.endYardAbs   = parseInt(cells[4]) || meta.endYardAbs || 0;
      meta.date         = cells[5] || meta.date || '';
      meta.step         = parseFloat(cells[16]) || 0.25;
    }

    const raw1 = (cells[10] || '').replace(/^To_Avoid_Formula/, '').replace(/^,/, '');
    const raw2 = (cells[11] || '').replace(/^To_Avoid_Formula/, '').replace(/^,/, '');
    const combined = raw2 ? raw1 + ',' + raw2 : raw1;

    const values = combined.split(',')
      .map(v => v.trim())
      .filter(v => v !== '' && v !== 'To_Avoid_Formula')
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v));

    if (values.length > 0) channelData[paramName] = values;
  }
  return { channelData, meta };
}

// Build CSV from position-aware chunks — uses actual step per chunk
function buildCSVFromChunks(chunks: { startYard: number; endYard: number; nPoints: number; data: Record<string, number[]> }[], dateRaw: string, elr: string, trackId: string): string {
  if (!chunks.length) return '';

  // Format date
  let dateStr = dateRaw;
  const m = dateRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) dateStr = `${m[3]}/${m[2]}/${m[1]}`;

  const firstYard = chunks[0].startYard;
  const lastChunk = chunks[chunks.length - 1];
  const lastYard  = lastChunk.endYard;
  const startMile = Math.floor(firstYard / 1760);
  const endMile   = Math.floor(lastYard  / 1760);

  let csv = `ELR: ${elr}    Track Id: ${trackId}    Start Eighth: ${String(startMile).padStart(3,'0')}/0    End Eighth: ${String(endMile).padStart(3,'0')}/0    Date(DD/MM/YYYY): ${dateStr}
`;
  csv += `
`;
  csv += `Locn	Locn	Locn	Twist1	Twist2	AligMS	AligML	TopML	Crosslevel	Gauge	TopRS	TopLS	Velocity	Gradient	Cant Def	Curvature	Dipped Left	Dipped Right
`;
  csv += `mile	yards	chs	mm	mm	mm	mm	mm	mm	mm	mm	mm	km/h	dgx100	mm	mm	mrad	mrad
`;

  // Channels where normal values are small (±30mm) — velocity markers appear as spikes
  // Values that are whole integers > 30 in these channels are CDDS speed markers, not data
  const SMALL_RANGE_PARAMS = new Set(['Twist1','AligMS','AligML','TopML','TopRS','TopLS','Gauge']);

  const get = (data: Record<string, number[]>, param: string, idx: number): string => {
    const arr = data[param];
    if (!arr || idx >= arr.length) return '';
    const v = arr[idx];
    if (v === null || v === undefined || isNaN(v)) return '';
    // Remove CDDS velocity markers from small-range geometry channels
    // These appear as isolated whole integers > 30 (matching train speed in km/h)
    if (SMALL_RANGE_PARAMS.has(param) && v === Math.round(v) && Math.abs(v) > 30) return '';
    return v.toString();
  };

  for (const chunk of chunks) {
    const n = chunk.nPoints;
    // step = 220 yards (CDDS_CHUNK) / nPoints returned for this chunk
    const step = n > 0 ? (chunk.endYard - chunk.startYard) / n : 0.25;

    for (let i = 0; i < n; i++) {
      const absYards = chunk.startYard + i * step;
      const mile     = Math.floor(absYards / 1760);
      const yards    = (absYards % 1760).toFixed(2);
      const chs      = Math.floor((absYards % 1760) / 22);
      const cols = [
        mile, yards, chs,
        get(chunk.data, 'Twist1', i), '',
        get(chunk.data, 'AligMS', i), get(chunk.data, 'AligML', i), get(chunk.data, 'TopML', i),
        get(chunk.data, 'Crosslevel', i), get(chunk.data, 'Gauge', i),
        get(chunk.data, 'TopRS', i), get(chunk.data, 'TopLS', i),
        get(chunk.data, 'Velocity', i), get(chunk.data, 'Gradient', i),
        get(chunk.data, 'Cant Def', i), get(chunk.data, 'Curvature', i),
        get(chunk.data, 'Dipped Left', i), get(chunk.data, 'Dipped Right', i),
      ];
      csv += cols.join('	') + '\r\n';

    }
  }
  return csv;
}



// GET /api/cdds/export — same as /data but returns as file download
app.get('/api/cdds/export', async (req: any, res: any) => {
  try {
    const { elr, tid, sy, ey, date } = req.query as any;
    let queryDate = date as string;
    const isoMatch = queryDate.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) queryDate = `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

    const startYard = parseInt(sy);
    const endYard   = parseInt(ey);
    const CDDS_CHUNK = 220;
    const alignedStart = Math.floor(startYard / 220) * 220;
    const alignedEnd   = Math.ceil(endYard / 220) * 220;

    interface ChunkRecord2 { startYard: number; endYard: number; nPoints: number; data: Record<string, number[]>; }
    const chunks2: ChunkRecord2[] = [];
    let firstDate2 = queryDate;
    let consecutiveEmpty = 0;

    for (let chunkStart = alignedStart; chunkStart < alignedEnd; chunkStart += CDDS_CHUNK) {
      const chunkEnd = Math.min(chunkStart + CDDS_CHUNK, alignedEnd);
      const html = await cddsGet({ ws: 'ascii_data_pump_qry', p0: elr, p1: tid, p2: String(chunkStart), p3: String(chunkEnd), p4: queryDate });

      if (html.includes('Error Message') || html.includes('error code')) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }

      const { channelData, meta } = parseCDDSChunk(html);
      const chunkPointCount = Object.values(channelData)[0]?.length || 0;

      if (chunks2.length === 0 && meta.date) firstDate2 = meta.date;

      if (chunkPointCount === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }
      consecutiveEmpty = 0;
chunks2.push({ startYard: chunkStart, endYard: chunkEnd, nPoints: chunkPointCount, data: channelData });
    }

    const csv = buildCSVFromChunks(chunks2, firstDate2, elr, tid);
    if (!csv) return res.status(502).json({ error: 'No data returned from CDDS' });

    const filename = `CDDS_${elr}_${tid}_${queryDate.replace(/\//g,'-')}.csv`;
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

const PORT = parseInt(process.env.PORT || "3000");

// Serve the standalone frontend HTML directly - no build step needed
app.get("/api/assets", (req: any, res) => {
  const elr     = (req.query.elr     || '').toString().trim().toUpperCase();
  const trackId = (req.query.trackId || '').toString().trim();

  if (!elr) return res.status(400).json({ error: 'ELR required' });

  const sc = SC_DATA.filter(s =>
    s.elr === elr && s.trackId === trackId
  );

  const structures = STRUCTURES_DATA.filter(s => {
    if (s.elr !== elr) return false;
    if (s.trackId && s.trackId !== trackId) return false;
    return true;
  });

  // Return all OTM for this ELR/TrackID — client will filter by date
  const otm = OTM_DATA.filter(o =>
    o.elr === elr && o.trackId === trackId
  );

  const trackCat = TRACKCAT_DATA.filter(t =>
    t.elr === elr && t.trackId === trackId
  );

  res.json({ sc, structures, otm, trackCat });
});

app.get("/", (_req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

app.get("/export-tool", (_req, res) => {
  res.sendFile(join(__dirname, "cdds_export.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open: http://localhost:${PORT}`);
});