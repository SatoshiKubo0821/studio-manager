// Loads the sheet parser out of index.html into a sandbox, so this job and the app
// always read sheets the same way.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadParser(){
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  function grabFunction(name){
    const i = html.indexOf(`function ${name}(`);
    if(i < 0) throw new Error(`function ${name} not found in index.html`);
    let depth = 0;
    for(let k = html.indexOf("{", i); k < html.length; k++){
      if(html[k] === "{") depth++;
      if(html[k] === "}" && --depth === 0) return html.slice(i, k + 1);
    }
    throw new Error(`unbalanced braces in ${name}`);
  }
  function grabConst(name){
    const m = html.match(new RegExp(`^\\s*const ${name} = .*;$`, "m"));
    if(!m) throw new Error(`const ${name} not found in index.html`);
    return m[0].trim().replace(/^const /, "var ");
  }
  const parserSource = [
    ...["pad2", "label0", "cellText", "normKey", "RANGE_RE", "MEMO_RANGE_RE", "hhmm"].map(grabConst),
    ...["localDateStr", "parseDateCell", "parseAmount", "parsePay", "isGridTab", "gridDate", "matchPlan",
        "mailFromOtherStudio", "findRange", "guessName", "formFields", "extractShootInfo", "extractPeople", "colLetter", "parseGridTab", "parseGridCell",
        "classifyImportRows", "reservationDocFromRow"].map(grabFunction),
  ].join("\n");
  // share Date with the caller so `instanceof Date` works on SheetJS dates
  const P = { studios: [], reservations: [], cautionInfo: ()=>"", Date };
  vm.createContext(P);
  vm.runInContext(parserSource, P);

  return P;
}
