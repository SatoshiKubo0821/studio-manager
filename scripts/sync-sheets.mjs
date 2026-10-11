// Daily sheet sync (GitHub Actions, 09:00 JST).
//
// Reads every studio's booking sheet from Google Drive with a service account and
// imports the bookings that are new — the same thing the dashboard's "予約表から更新"
// button does. The parsing code is taken from index.html at run time so the app and
// this job can never disagree about how a sheet is read.
//
// Env:
//   GCP_SA_KEY   service-account JSON (Drive read access to the sheets + Firestore write)
//   DRY_RUN=1    parse and report only, write nothing
//
// The sheets must be shared (viewer) with the service account's e-mail address.

import { GoogleAuth } from "google-auth-library";
import admin from "firebase-admin";
import * as XLSX from "xlsx";
import vm from "node:vm";
import { loadParser } from "./parser.mjs";

const DRY_RUN = process.env.DRY_RUN === "1";

// ---------- the parser from index.html ----------
const P = loadParser();

// ---------- Google Drive ----------
const key = JSON.parse(process.env.GCP_SA_KEY || "{}");
if(!key.client_email){
  // not configured yet: skip quietly instead of failing every morning
  console.log("GCP_SA_KEY is not set — skipping sync (see README: 毎朝の自動取り込み)");
  process.exit(0);
}
const auth = new GoogleAuth({ credentials: key, scopes: [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
] });
const http = await auth.getClient();
async function getJson(url){ return (await http.request({ url })).data; }

async function fetchBook(fileId){
  const meta = await getJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=mimeType,name&supportsAllDrives=true`);
  if(meta.mimeType === "application/vnd.google-apps.spreadsheet"){
    const sm = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=sheets.properties(title)`);
    const titles = (sm.sheets || []).map(x=>x.properties.title);
    const q = titles.map(t=>"ranges=" + encodeURIComponent(`'${t.replace(/'/g, "''")}'`)).join("&");
    const data = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
    return titles.map((title, i)=>({ title, values: (data.valueRanges[i] || {}).values || [] }));
  }
  const res = await http.request({ url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, responseType: "arraybuffer" });
  const wb = XLSX.read(Buffer.from(res.data), { type: "buffer", cellDates: true });
  return wb.SheetNames.map(name=>({ title: name, values: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
}

// ---------- Firestore ----------
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const db = admin.firestore();

const studios = (await db.collection("studios").get()).docs.map(d=>({ id: d.id, plans: [], options: [], ...d.data() }));
const reservations = (await db.collection("reservations").select("studioId", "date", "startTime", "customerName", "importKey").get()).docs.map(d=>d.data());
P.studios = studios;
P.reservations = reservations;
// classifyImportRows reads the global `reservations`; expose it inside the sandbox
vm.runInContext("var reservations = this.reservations;", P);

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const results = [];
for(const st of studios.filter(s=>s.sheetId)){
  const res = { studio: st.name, added: 0, sum: 0, conflict: 0, error: 0, note: "" };
  try{
    const book = await fetchBook(st.sheetId);
    if(!book.some(t=>P.isGridTab(t))){ res.note = "1行1予約の表のため対象外(アプリの取り込み画面から手動で)"; results.push(res); continue; }
    const rows = P.classifyImportRows(book.filter(t=>P.isGridTab(t)).flatMap(t=>P.parseGridTab(t, st)), st);
    const picked = rows.filter(r=>r.status === "new");
    res.conflict = rows.filter(r=>r.status === "conflict").length;
    res.error = rows.filter(r=>r.status === "error").length;
    const now = new Date().toISOString();
    if(!DRY_RUN){
      for(let i = 0; i < picked.length; i += 400){
        const batch = db.batch();
        picked.slice(i, i + 400).forEach(r=> batch.set(db.collection("reservations").doc(), P.reservationDocFromRow(st, r, "sheet", now, "未収")));
        await batch.commit();
      }
      await db.collection("studios").doc(st.id).update({ lastSheetImportAt: now });
    }
    picked.forEach(r=> reservations.push({ studioId: st.id, date: r.date, startTime: r.startTime, customerName: r.customerName, importKey: r.importKey }));
    res.added = picked.length;
    res.sum = picked.reduce((a, r)=>a + (r.total || 0), 0);
  }catch(e){
    res.note = "読み込みに失敗: " + (e?.response?.data?.error?.message || e.message || e);
  }
  results.push(res);
  console.log(`${res.studio}: +${res.added} (¥${res.sum.toLocaleString("ja-JP")}) conflict=${res.conflict} error=${res.error} ${res.note}`);
}

if(!DRY_RUN){
  await db.collection("system").doc("sheetSync").set({
    at: new Date().toISOString(), date: today, by: "github-actions", results,
    added: results.reduce((a, r)=>a + r.added, 0),
  });
}
const failed = results.filter(r=>r.note.startsWith("読み込みに失敗"));
if(failed.length){ console.error(`${failed.length} studio(s) failed`); process.exitCode = 1; }
