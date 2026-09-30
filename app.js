/* Calcolo costi di trasporto
   PWA statica: nessun server, nessun costo. Dati in /data, aggiornati da listini.json e gasolio.json. */
"use strict";

/* ====================== Impostazioni ====================== */
const APP_BUILD = 11;                // deve coincidere con versione.json
const DATI_VERSIONE = 2;            // deve coincidere con "versione" in data/pallet.json e data/groupage.json
const ISOLE = ["SICILIA", "SARDEGNA"];
const STORE = { state: "ct_state", adj: "ct_adj", fuel: "ct_fuel" };
const FUEL_DEFAULTS = { on: false, share: 30, shareIs: 15 };

/* ====================== Dati ====================== */
const D = { listini: null, pallet: null, groupage: null, articoli: [], geo: [], gasolio: null };
let S = { cart: [], reg: "", prov: "", opts: { ass: false, pre: false, dis: false } };
let ADJ = 0;
let FUEL = { ...FUEL_DEFAULTS };
let LAST = null;           // ultimo risultato calcolato
let manualType = "pallet";
let uidSeq = 1;

const $ = (id) => document.getElementById(id);
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const num = (v, d = 0) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : d; };
const eur = (v) => Number.isFinite(v) ? v.toLocaleString("it-IT", { style: "currency", currency: "EUR" }) : "—";
const it1 = (v, dec = 1) => Number(v).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const itN = (v) => Number(v).toLocaleString("it-IT", { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
function dataIt(iso, lungo = false){
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso || "");
  if(!m) return iso || "";
  if(!m[3]) return `${MESI[+m[2] - 1]} ${m[1]}`;
  return lungo ? `${+m[3]} ${MESI[+m[2] - 1]} ${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}
function ls(key, val){
  try{
    if(val === undefined){ return JSON.parse(localStorage.getItem(key) || "null"); }
    if(val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val));
  }catch{ return null; }
}

async function getJSON(path){
  // il parametro evita copie vecchie nella cache di GitHub Pages o del browser
  const r = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if(!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/* ====================== Catalogo ====================== */
const artById = (id) => D.articoli.find((a) => a.id === id) || null;
const regById = (id) => D.geo.find((r) => r.id === id) || null;
const palletType = (id) => (D.pallet?.tipi || []).find((t) => t.id === id) || null;

function lineService(line){
  if(line.kind === "manual") return line.manual.type;
  const a = artById(line.artId);
  if(!a) return "quote";
  if(productPallets(a)) return "pallet";
  if(productGroupage(a)) return "groupage";
  return "quote";
}

function lineTitle(line){
  if(line.kind === "manual"){
    return line.manual.type === "pallet" ? `Collo su pallet ${line.manual.pallet}` : "Collo in groupage";
  }
  return artById(line.artId)?.nome || "Articolo";
}

function palletDesc(id){
  const t = palletType(id);
  if(!t) return id;
  const base = `h ${t.altezzaCm} cm, fino a ${t.kgMax} kg`;
  return t.nota ? `${base}, ${t.nota}` : base;
}

/* ====================== Calcolo ====================== */
/* Criteri di classificazione dei pallet 2026:
   classe dal peso e dall'altezza, maggiorazione per area di base, lunghezza o peso: si applica la maggiore. */
function palletClass(kg, h){
  if(kg <= 150) return h <= 60 ? "MINI" : h <= 80 ? "QUARTER" : h <= 120 ? "HALF" : h <= 160 ? "MEDIUM" : "LIGHT";
  if(kg <= 300) return h <= 80 ? "QUARTER" : h <= 120 ? "HALF" : h <= 160 ? "MEDIUM" : "LIGHT";
  if(kg <= 450) return h <= 120 ? "HALF" : h <= 160 ? "MEDIUM" : "LIGHT";
  if(kg <= 600) return h <= 160 ? "MEDIUM" : "LARGE";
  if(kg <= 750) return "LARGE";
  if(kg <= 900) return "FULL";
  if(kg <= 1050) return "BIG";
  return "MEGA";
}
function palletAreaPct(m2){
  const T = [[1.28, 0], [1.39, 10], [1.59, 30], [1.89, 50], [2.27, 80], [2.51, 100], [2.87, 130], [3.07, 150], [3.84, 200]];
  for(const [max, pct] of T) if(m2 <= max + 0.005) return pct;
  return null;
}
function palletWeightPct(kg){
  if(kg <= 1200) return 0;
  if(kg <= 1800) return Math.ceil((kg - 1200) / 100) * 10;
  return null;
}
/* Classifica un collo: { type, pct, note } oppure null se non può viaggiare su pallet */
function palletPkg(kg, l1, l2, h){
  kg = num(kg);
  if(![l1, l2, h].every((x) => x > 0)) return null;
  const long = Math.max(l1, l2), short = Math.min(l1, l2);
  if(h > 240 || kg > 1800 || long > 300) return null;
  const wPct = palletWeightPct(kg);
  if(long > 240){
    if(short > 120) return null;
    return { type: "MEGA", pct: Math.max(long <= 270 ? 300 : 320, wPct), note: `lunghezza ${itN(long)} cm` };
  }
  const area = Math.round(l1 * l2 / 100) / 100;           // m² a due decimali, come nella tabella
  let aPct = palletAreaPct(area);
  if(aPct === null) return null;
  const type = palletClass(kg, h);
  if(type === "MINI" || type === "QUARTER") aPct = 0;      // nessuna maggiorazione per MINI e QUARTER
  const fuori = short > 160 || long > 240;
  return { type, pct: Math.max(aPct, wPct), note: aPct ? `base ${it1(area, 2)} m²${fuori ? ", misure oltre lo standard 240×160" : ""}` : "" };
}
function palletOversize(a){
  const m = a?.misure;
  return Array.isArray(m) && m.length === 3 ? palletPkg(a.kg, m[0], m[1], m[2]) : null;
}
function pieces(a){
  const out = [];
  (a?.colli || []).forEach((c) => { for(let i = 0; i < (c.n || 1); i++) out.push(c); });
  return out;
}
function totKg(a){ return a?.colli ? pieces(a).reduce((s, c) => s + num(c.kg), 0) : num(a?.kg); }

/* Pallet necessari per un prodotto: [{ type, pct, note }] oppure null se non può andare su pallet */
function productPallets(a){
  if(!a) return null;
  if(a.colli){
    const ps = pieces(a);
    if(!ps.length) return null;
    const res = ps.map((c) => palletPkg(c.kg, c.l, c.p, c.h));
    return res.every(Boolean) ? res : null;
  }
  if(a.groupage){ const o = palletOversize(a); return o ? [o] : null; }
  if(a.pallet) return [{ type: a.pallet, pct: 0, note: "", fixed: true }];
  return null;
}
/* Tariffa di un pallet: usa la riga del listino con la maggiorazione se esiste, altrimenti la applica */
function palletRate(reg, pl){
  const rates = D.pallet.tariffe[reg] || {};
  if(pl.fixed) return rates[pl.type] ?? null;
  const exact = rates[`${pl.type} + ${pl.pct}%`];
  if(pl.pct && exact != null) return exact;
  return rates[pl.type] != null ? rates[pl.type] * (1 + pl.pct / 100) : null;
}
/* Ingombro in groupage: metri di pianale (larghezza utile 2,4 m), quintali, colli */
function productGroupage(a){
  if(a?.colli){
    const ps = pieces(a);
    if(!ps.length) return null;
    const area = ps.reduce((s, c) => s + c.l * c.p / 10000, 0);
    const longest = Math.max(...ps.map((c) => Math.max(c.l, c.p) / 100));
    return { ml: round2(Math.max(area / 2.4, longest > 2.4 ? longest : 0)), q: round2(totKg(a) / 100), b: ps.length };
  }
  if(a?.groupage) return { ml: num(a.groupage.ml), q: num(a.groupage.quintali), b: num(a.groupage.bancali, 1) };
  if(a?.pallet) return { ml: 0.6, q: num(a.kg) / 100, b: 1 };
  return null;
}

function findGroupage(provSigla, regId){
  for(const z of D.groupage?.zone || []){
    for(const g of z.gruppi){
      if(g.province.includes(provSigla)) return { zona: z, gruppo: g };
      if(g.tutte && regId && norm(g.regione) === norm(regId)) return { zona: z, gruppo: g };
    }
  }
  return null;
}

function groupageBand(zona, ml, q, b){
  const f = zona.fasce;
  const idx = (val, arr) => {
    if(!(val > 0) || !arr) return { i: 0, over: false };
    const i = arr.findIndex((lim) => val <= lim + 1e-9);
    return i === -1 ? { i: arr.length - 1, over: true } : { i, over: false };
  };
  const r = [idx(ml, f.ml), idx(b, f.bancali), idx(q, f.quintali)];
  const i = Math.max(...r.map((x) => x.i));
  return { i, over: r.some((x) => x.over), ml: f.ml[i], b: f.bancali[i], q: f.quintali[i] };
}

function groupageLoad(items){
  let ml = 0, q = 0, b = 0;
  for(const { line, qty } of items){
    if(line.kind === "manual"){
      ml += num(line.manual.ml) * qty; q += num(line.manual.q) * qty; b += num(line.manual.b) * qty;
    } else {
      const g = productGroupage(artById(line.artId));
      if(g){ ml += g.ml * qty; q += g.q * qty; b += g.b * qty; }
    }
  }
  return { ml: round2(ml), q: round2(q), b: Math.round(b) };
}

function fuelDelta(){
  const g = D.gasolio;
  if(!g?.base?.prezzo || !g?.attuale?.prezzo) return null;
  return (g.attuale.prezzo / g.base.prezzo - 1) * 100;
}
function fuelPctFor(reg){
  const d = fuelDelta();
  if(!FUEL.on || d === null) return 0;
  return d * (ISOLE.includes(reg) ? FUEL.shareIs : FUEL.share) / 100;
}

/* mode: "auto" (per ogni prodotto il servizio più conveniente), "pallet" (dove possibile), "groupage" (tutto in groupage) */
function decideService(line, mode, reg, prov){
  const base = lineService(line);
  if(line.kind !== "art" || base === "quote") return { svc: base };
  const a = artById(line.artId);
  const pal = productPallets(a);
  const grp = productGroupage(a);
  if(!pal) return { svc: grp ? "groupage" : "quote" };
  if(a.soloPallet || !grp) return { svc: "pallet", pal };
  if(mode === "groupage") return { svc: "groupage" };
  if(mode === "pallet" || !reg) return { svc: "pallet", pal };
  // automatico: per ogni prodotto il servizio che costa meno
  const rates = pal.map((pl) => palletRate(reg, pl));
  if(rates.some((r) => r == null)) return { svc: "groupage" };
  const palCost = rates.reduce((x, y) => x + y, 0);
  const hit = findGroupage(prov, reg);
  if(!hit) return { svc: "pallet", pal };
  const band = groupageBand(hit.zona, grp.ml, grp.q, grp.b);
  return palCost <= hit.gruppo.prezzi[band.i] ? { svc: "pallet", pal } : { svc: "groupage" };
}

function computeMode(mode = "auto"){
  const R = { lines: [], notes: [], infos: [], total: null, used: new Set(), alt: [], ready: false };
  const reg = S.reg, prov = S.prov;
  const cart = S.cart.map((line) => ({ line, qty: Math.max(1, line.qty | 0), ...decideService(line, mode, reg, prov) }));
  if(!cart.length) return R;

  const opts = S.opts;
  let costTot = 0;
  let priced = false;

  if(!reg){ R.notes.push("Scegli la regione di destinazione per vedere il costo."); }

  /* --- Pallet --- */
  const pal = cart.filter((c) => c.svc === "pallet");
  if(pal.length && reg){
    const rates = D.pallet.tariffe[reg] || {};
    const reg0 = D.pallet.regole;
    let sub = 0, nPal = 0, missing = [];
    for(const c of pal){
      const list = c.line.kind === "manual" ? [{ type: c.line.manual.pallet, pct: 0, note: "", fixed: true }] : c.pal;
      const rs = list.map((pl) => palletRate(reg, pl));
      if(rs.some((r) => r == null)){ missing.push(lineTitle(c.line)); continue; }
      const cost = rs.reduce((x, y) => x + y, 0) * c.qty;
      sub += cost; nPal += list.length * c.qty;
      const lab = (pl) => `${pl.type}${!pl.fixed && pl.pct ? ` +${pl.pct}%` : ""}`;
      let desc;
      if(list.length === 1){
        const pl = list[0];
        desc = `${c.qty} × pallet ${lab(pl)}${!pl.fixed && pl.pct ? ` fuori misura (${pl.note})` : ""}`;
      } else {
        const counts = {};
        list.forEach((pl) => { const k = lab(pl); counts[k] = (counts[k] || 0) + 1; });
        desc = `${c.qty > 1 ? c.qty + " × " : ""}${list.length} colli su pallet: ${Object.entries(counts).map(([k, n]) => (n > 1 ? n + " × " : "") + k).join(", ")}`;
      }
      R.lines.push({ t: lineTitle(c.line), s: desc, v: round2(cost) });
      if(list.some((pl) => !pl.fixed && pl.pct)) R.ovs = true;
    }
    if(missing.length) R.notes.push(`Tariffa pallet non trovata per: ${missing.join(", ")}.`);
    if(nPal){
      const sped = Math.ceil(nPal / reg0.maxPalletPerSpedizione);
      if(sped > 1) R.infos.push(`${nPal} pallet: il trasportatore accetta al massimo ${reg0.maxPalletPerSpedizione} pallet per spedizione, calcolate ${sped} spedizioni.`);
      if(opts.pre){
        const c = reg0.preavvisoEuro * sped;
        sub += c;
        R.lines.push({ t: "Preavviso telefonico", s: sped > 1 ? `${sped} spedizioni` : "1 spedizione", v: round2(c), minor: true });
      }
      if(opts.ass){
        const c = sub * reg0.assicurazionePct / 100;
        sub += c;
        R.lines.push({ t: "Assicurazione all risk pallet", s: `${reg0.assicurazionePct}%`, v: round2(c), minor: true });
      }
      costTot += sub; priced = true; R.used.add("pallet");
    }
  }

  /* --- Groupage --- */
  const grp = cart.filter((c) => c.svc === "groupage");
  if(grp.length && reg){
    const regObj = regById(reg);
    const needProv = !(regObj && D.groupage.zone.some((z) => z.gruppi.some((g) => g.tutte && norm(g.regione) === norm(reg))));
    if(needProv && !prov){
      R.notes.push("Scegli la provincia: il groupage ha tariffe diverse per provincia.");
    } else {
      const hit = findGroupage(prov, reg);
      if(!hit){
        R.notes.push("Nessuna tariffa groupage per questa provincia.");
      } else {
        const load = groupageLoad(grp);
        const band = groupageBand(hit.zona, load.ml, load.q, load.b);
        let c = hit.gruppo.prezzi[band.i];
        const names = grp.map((g) => `${g.qty > 1 ? g.qty + " × " : ""}${lineTitle(g.line)}`).join(", ");
        const carico = [load.ml ? `${itN(load.ml)} m` : null, load.b ? `${load.b} ${load.b === 1 ? "bancale" : "bancali"}` : null, load.q ? `${itN(load.q)} q` : null].filter(Boolean).join(", ");
        R.lines.push({
          t: `Groupage: ${names}`,
          s: `Carico ${carico}. Fascia fino a ${itN(band.ml)} m, ${band.b} bancali, ${band.q} q`,
          v: round2(c)
        });
        if(band.over) R.notes.push("Il carico supera l'ultima fascia del listino groupage: la cifra è una stima minima, va richiesta una quotazione.");
        if(opts.ass){
          const a = c * D.groupage.regole.assicurazionePct / 100;
          c += a;
          R.lines.push({ t: "Assicurazione all risk groupage", s: `${D.groupage.regole.assicurazionePct}%`, v: round2(a), minor: true });
        }
        if(reg === "SICILIA") R.infos.push("Sicilia: tariffa groupage per resa intermodale.");
        const lung = /SUD|ISOLE/i.test(hit.zona.zona) ? 16 : 12;
        R.infos.push(`Groupage: verificare che a destino possa accedere un automezzo lungo fino a ${lung} m.`);
        costTot += c; priced = true; R.used.add("groupage");
      }
    }
  }

  /* --- Articoli non quotabili e avvisi prodotto --- */
  const quote = cart.filter((c) => c.svc === "quote");
  if(quote.length) R.notes.push(`Imballo non disponibile per ${quote.map((c) => lineTitle(c.line)).join(", ")}: costo da richiedere, non incluso nel totale.`);
  const arts = cart.filter((c) => c.line.kind === "art").map((c) => artById(c.line.artId)).filter(Boolean);
  const prev = arts.filter((a) => a.preventivo).map((a) => a.nome);
  if(prev.length && (R.used.has("groupage") || R.ovs)) R.notes.push(`Prodotti di grandi dimensioni (${prev.join(", ")}): stima da confermare con il trasportatore.`);
  const noSp = arts.filter((a) => a.noSponda).map((a) => a.nome);
  if(noSp.length) R.infos.push(`Scarico senza sponda idraulica per ${noSp.join(", ")}: a destino serve un mezzo di sollevamento.`);
  const cor = arts.filter((a) => a.corriere).map((a) => a.nome);
  if(cor.length) R.infos.push(`${cor.join(", ")}: articolo piccolo, di solito conviene il corriere espresso.`);
  if(opts.dis && priced && !(num(opts.disEur) > 0)) R.notes.push("Località disagiata o oltre 30 km dal capoluogo: possibile supplemento, il costo va confermato.");

  if(!priced) return R;

  /* --- Adeguamenti --- */
  const base = round2(R.lines.reduce((s, l) => s + l.v, 0));
  let total = base;
  if(ADJ){
    const v = round2(base * ADJ / 100);
    R.lines.push({ t: `Adeguamento costi ${ADJ > 0 ? "+" : "−"}${it1(Math.abs(ADJ))}%`, s: "Impostato su questo dispositivo", v, minor: true, adj: true });
    total = round2(total + v);
  }
  const fp = fuelPctFor(reg);
  if(fp){
    const v = round2(total * fp / 100);
    R.lines.push({ t: `Adeguamento gasolio ${fp > 0 ? "+" : "−"}${it1(Math.abs(fp))}%`, s: `Prezzo MIMIT del ${dataIt(D.gasolio.attuale.data)}`, v, minor: true, adj: true });
    total = round2(total + v);
    R.used.add("gasolio");
  }
  /* --- Supplemento fisso per località disagiata / oltre 30 km (importo inserito a mano) --- */
  if(opts.dis && num(opts.disEur) > 0){
    const v = round2(num(opts.disEur));
    R.lines.push({ t: "Supplemento località disagiata / oltre 30 km", s: "Importo indicato", v, minor: true });
    total = round2(total + v);
  }
  /* --- Arrotondamento all'euro, come nelle offerte --- */
  const rounded = Math.round(total);
  if(Math.abs(rounded - total) >= 0.005){
    R.lines.push({ t: "Arrotondamento", s: "", v: round2(rounded - total), minor: true });
  }
  R.total = rounded;
  R.ready = true;

  return R;
}

/* Calcola le tre soluzioni (per prodotto, tutto in groupage, tutto su pallet)
   e propone la più conveniente; le altre restano come confronto. */
function compute(){
  const LABEL = { auto: "Pallet e groupage separati", groupage: "Tutto in groupage", pallet: "Tutto su pallet, anche i fuori misura" };
  const all = ["auto", "groupage", "pallet"].map((m) => ({ m, R: computeMode(m) }));
  const valid = all.filter((x) => x.R.ready && !x.R.notes.some((n) => /provincia|tariffa|supera l'ultima fascia/i.test(n)));
  const main = valid.length ? valid.reduce((best, x) => x.R.total < best.R.total - 0.005 ? x : best, valid[0]) : all[0];
  const R = main.R;
  R.mode = main.m;
  R.alt = [];
  valid.filter((x) => x !== main).forEach((x) => {
    const same = Math.abs(x.R.total - R.total) < 0.5 || R.alt.some((y) => Math.abs(y.total - x.R.total) < 0.5);
    const meaningful = (x.m === "groupage" && x.R.used.has("groupage")) || (x.m === "pallet" && x.R.used.has("pallet")) || x.m === "auto";
    const sensible = x.R.total <= R.total * 2;
    if(!same && meaningful && sensible) R.alt.push({ mode: x.m, label: LABEL[x.m], total: x.R.total, cheaper: false });
  });
  return R;
}

function needsProvince(reg){
  return !D.groupage.zone.some((z) => z.gruppi.some((g) => g.tutte && norm(g.regione) === norm(reg)));
}

/* ====================== Resa grafica: bolla ====================== */
function destLabel(){
  const r = regById(S.reg);
  if(!r) return "Destinazione da scegliere";
  const p = r.province.find((x) => x.sigla === S.prov);
  return p ? `${p.nome} (${p.sigla}), ${r.nome}` : r.nome;
}

function refLines(used){
  const L = D.listini, out = [];
  const who = (s) => s.fornitore ? ` · ${s.fornitore}` : "";
  if(used.has("pallet")){ const s = L.servizi.pallet; out.push(`<span>Pallet: <b>listino ${esc(s.riferimento.toLowerCase())}</b>${esc(who(s))}</span>`); }
  if(used.has("groupage")){ const s = L.servizi.groupage; out.push(`<span>Groupage: <b>listino ${esc(s.riferimento.toLowerCase())}</b>${esc(who(s))}</span>`); }
  if(used.has("gasolio")) out.push(`<span>Gasolio: <b>MIMIT ${esc(dataIt(D.gasolio.attuale.data))}</b></span>`);
  return out;
}

let MODE = "auto";
function render(){
  const R = compute();
  LAST = R;
  if(R.mode && R.mode !== MODE){ MODE = R.mode; renderCart(); }
  $("dkDest").textContent = destLabel();

  const body = $("dkLines");
  if(!S.cart.length){
    body.innerHTML = `<p class="dk-empty">Aggiungi un prodotto per iniziare.</p>`;
  } else if(!R.lines.length){
    body.innerHTML = `<p class="dk-empty">Completa i dati per vedere il dettaglio.</p>`;
  } else {
    body.innerHTML = R.lines.map((l) => `
      <div class="dk-line${l.minor ? " minor" : ""}">
        <div class="l"><strong>${esc(l.t)}</strong>${l.s ? `<small>${esc(l.s)}</small>` : ""}</div>
        <div class="v">${eur(l.v)}</div>
      </div>`).join("");
  }

  const tot = $("dkTotal");
  const newTxt = R.ready ? eur(R.total) : "—";
  if(tot.textContent !== newTxt){
    tot.textContent = newTxt;
    tot.classList.remove("bump"); void tot.offsetWidth; tot.classList.add("bump");
  }
  $("pbTotal").textContent = newTxt;

  const alt = $("dkAlt");
  if(R.alt.length){
    alt.hidden = false;
    alt.innerHTML = `<b>Confronto</b>` + R.alt.map((x) =>
      `<div class="alt-row"><span>${esc(x.label)}</span><b>${eur(x.total)}</b></div>`).join("");
  } else alt.hidden = true;

  $("dkNotes").innerHTML =
    R.notes.map((n) => `<li>${esc(n)}</li>`).join("") +
    R.infos.map((n) => `<li class="info">${esc(n)}</li>`).join("");

  const refs = refLines(R.used);
  $("dkRef").innerHTML = refs.length ? `<span>Calcolato su:</span>${refs.join("")}` : "";

  ["btnShare", "btnCopy", "btnPrint"].forEach((id) => { $(id).disabled = !R.ready; });
  updatePricebar();
  renderChips();
}

/* ====================== Carico ====================== */
function renderCart(){
  const ul = $("cart");
  $("cartEmpty").hidden = S.cart.length > 0;
  ul.innerHTML = S.cart.map((line) => {
    const dec = decideService(line, MODE, S.reg, S.prov);
    const svc = dec.svc;
    let chip = "", meta = "";
    if(line.kind === "manual"){
      if(svc === "pallet"){ chip = `<span class="chip">Pallet ${esc(line.manual.pallet)}</span>`; meta = palletDesc(line.manual.pallet); }
      else { chip = `<span class="chip chip-red">Groupage</span>`; meta = `${itN(line.manual.ml)} m, ${itN(line.manual.q)} q, ${line.manual.b} bancali`; }
    } else {
      const a = artById(line.artId);
      if(svc === "pallet"){
        const pl = dec.pal || productPallets(a) || [];
        chip = pl.length === 1
          ? `<span class="chip">Pallet ${esc(pl[0].type)}${!pl[0].fixed && pl[0].pct ? " +" + pl[0].pct + "%" : ""}</span>`
          : `<span class="chip">${pl.length} colli su pallet</span>`;
      }
      else if(svc === "groupage"){ const g = productGroupage(a); chip = `<span class="chip chip-red">Groupage ${itN(g.ml)} m</span>`; }
      else chip = `<span class="chip chip-amber">Da quotare</span>`;
      const bits = [];
      const kg = totKg(a);
      if(kg) bits.push(`${itN(kg)} kg`);
      if(a?.colli){
        const ps = pieces(a);
        if(ps.length === 1) bits.push(`${ps[0].l}×${ps[0].p}×${ps[0].h} cm`);
        else if(ps.length > 1) bits.push(`${ps.length} colli`);
      } else if(a?.misure?.length === 3 && a.misure.every((x) => x > 0)) bits.push(`${a.misure.map((x) => itN(x)).join("×")} cm`);
      if(a?.nota) bits.push(a.nota);
      meta = bits.join(", ");
    }
    return `
      <li class="cart-item" data-svc="${svc}" data-uid="${line.uid}">
        <div class="ci-info">
          <div class="ci-name">${esc(lineTitle(line))}</div>
          <div class="ci-meta">${chip}${esc(meta)}</div>
        </div>
        <div class="qty" role="group" aria-label="Quantità">
          <button type="button" data-act="dec" aria-label="Uno in meno">−</button>
          <span aria-live="polite">${line.qty}</span>
          <button type="button" data-act="inc" aria-label="Uno in più">+</button>
        </div>
        <button type="button" class="ci-del" data-act="del" aria-label="Rimuovi ${esc(lineTitle(line))}">✕</button>
      </li>`;
  }).join("");
}

function addLine(line){
  if(line.kind === "art"){
    const ex = S.cart.find((l) => l.kind === "art" && l.artId === line.artId);
    if(ex){ ex.qty++; saveState(); renderCart(); render(); return; }
  }
  S.cart.push({ uid: uidSeq++, qty: 1, ...line });
  saveState(); renderCart(); render();
}

function onCartClick(e){
  const btn = e.target.closest("button[data-act]");
  if(!btn) return;
  const uid = +btn.closest(".cart-item").dataset.uid;
  const line = S.cart.find((l) => l.uid === uid);
  if(!line) return;
  if(btn.dataset.act === "inc") line.qty = Math.min(99, line.qty + 1);
  if(btn.dataset.act === "dec"){ line.qty--; if(line.qty < 1) S.cart = S.cart.filter((l) => l !== line); }
  if(btn.dataset.act === "del") S.cart = S.cart.filter((l) => l !== line);
  saveState(); renderCart(); render();
}

/* ====================== Menu prodotti (a tendina con ricerca) ====================== */
let comboItems = [], comboActive = -1;

function categories(){
  const m = new Map();
  for(const a of D.articoli) m.set(a.categoria, (m.get(a.categoria) || 0) + 1);
  const last = (c) => c === "Fuori prospetto 2026" ? 1 : 0;
  return [...m.entries()].sort((a, b) => last(a[0]) - last(b[0]) || a[0].localeCompare(b[0], "it"));
}

function fillCategories(){
  const sel = $("catSelect");
  sel.innerHTML = `<option value="">Tutte le famiglie (${D.articoli.length} prodotti)</option>` +
    categories().map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join("");
}

function artMeta(a){
  const pl = productPallets(a);
  const kg = totKg(a);
  const w = kg ? `${itN(Math.round(kg))} kg` : "";
  if(pl) return [pl.length === 1 ? `pallet ${pl[0].type}${!pl[0].fixed && pl[0].pct ? " +" + pl[0].pct + "%" : ""}` : `${pl.length} colli`, w].filter(Boolean).join(", ");
  if(productGroupage(a)) return ["groupage", w].filter(Boolean).join(", ");
  return "da quotare";
}

function filterArticles(){
  const cat = $("catSelect").value;
  const q = norm($("artInput").value);
  let list = D.articoli.filter((a) => !cat || a.categoria === cat);
  const legacy = (a) => a.fonte === "Catalogo precedente" ? 1 : 0;
  if(q){
    list = list.filter((a) => norm(a.nome).includes(q));
    const rank = (a) => { const n = norm(a.nome); return n === q ? 0 : n.startsWith(q) ? 1 : 2; };
    return list.sort((a, b) => rank(a) - rank(b) || legacy(a) - legacy(b) || a.nome.localeCompare(b.nome, "it", { numeric: true }));
  }
  return list.sort((a, b) => legacy(a) - legacy(b) || a.categoria.localeCompare(b.categoria, "it") || a.nome.localeCompare(b.nome, "it", { numeric: true }));
}

function openCombo(){
  comboItems = filterArticles();
  comboActive = comboItems.length ? 0 : -1;
  const ul = $("artList");
  if(!comboItems.length){
    ul.innerHTML = `<li class="combo-empty">Nessun prodotto trovato. Prova con parte del nome o usa “Collo non a catalogo”.</li>`;
  } else {
    let html = "", last = null;
    const showGroups = !$("catSelect").value && !norm($("artInput").value);
    comboItems.forEach((a, i) => {
      if(showGroups && a.categoria !== last){ html += `<li class="combo-group" role="presentation">${esc(a.categoria)}</li>`; last = a.categoria; }
      html += `<li class="combo-opt" role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === comboActive}">
        <span class="opt-name">${esc(a.nome)}</span><span class="opt-meta">${esc(showGroups || $("catSelect").value ? artMeta(a) : a.categoria)}</span></li>`;
    });
    ul.innerHTML = html;
  }
  ul.hidden = false;
  $("artInput").setAttribute("aria-expanded", "true");
  syncActive();
}
function closeCombo(){
  $("artList").hidden = true;
  $("artInput").setAttribute("aria-expanded", "false");
  $("artInput").removeAttribute("aria-activedescendant");
}
function syncActive(){
  const ul = $("artList");
  ul.querySelectorAll(".combo-opt").forEach((li) => li.setAttribute("aria-selected", String(+li.dataset.i === comboActive)));
  if(comboActive >= 0){
    const el = $(`opt-${comboActive}`);
    $("artInput").setAttribute("aria-activedescendant", `opt-${comboActive}`);
    el?.scrollIntoView({ block: "nearest" });
  }
}
function pickArticle(i){
  const a = comboItems[i];
  if(!a) return;
  addLine({ kind: "art", artId: a.id });
  $("artInput").value = "";
  closeCombo();
  toast(`Aggiunto: ${a.nome}`);
}

function setupCombo(){
  const inp = $("artInput");
  inp.addEventListener("focus", openCombo);
  inp.addEventListener("input", openCombo);
  inp.addEventListener("keydown", (e) => {
    if($("artList").hidden && (e.key === "ArrowDown" || e.key === "Enter")){ openCombo(); e.preventDefault(); return; }
    if(e.key === "ArrowDown"){ comboActive = Math.min(comboItems.length - 1, comboActive + 1); syncActive(); e.preventDefault(); }
    else if(e.key === "ArrowUp"){ comboActive = Math.max(0, comboActive - 1); syncActive(); e.preventDefault(); }
    else if(e.key === "Enter"){ if(comboActive >= 0) pickArticle(comboActive); e.preventDefault(); }
    else if(e.key === "Escape"){ closeCombo(); }
  });
  $("artList").addEventListener("mousedown", (e) => {
    const li = e.target.closest(".combo-opt");
    if(li){ e.preventDefault(); pickArticle(+li.dataset.i); }
  });
  document.addEventListener("click", (e) => { if(!$("combo").contains(e.target)) closeCombo(); });
  $("catSelect").addEventListener("change", () => { $("artInput").focus(); openCombo(); });
}

/* ====================== Collo manuale ====================== */
function setupManual(){
  const sel = $("mPalletType");
  sel.innerHTML = D.pallet.tipi.map((t) => `<option value="${esc(t.id)}">${esc(t.id)}</option>`).join("");
  sel.value = "MEDIUM";
  const hint = () => { $("mPalletHint").textContent = `Base 100×120 cm, ${palletDesc(sel.value)}.`; };
  sel.addEventListener("change", hint); hint();

  $("btnManual").addEventListener("click", () => { $("manualBox").hidden = false; $("btnManual").hidden = true; });
  $("btnManualCancel").addEventListener("click", () => { $("manualBox").hidden = true; $("btnManual").hidden = false; });
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    manualType = b.dataset.mtype;
    document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    $("manualPallet").hidden = manualType !== "pallet";
    $("manualGroupage").hidden = manualType !== "groupage";
  }));
  $("btnManualAdd").addEventListener("click", () => {
    const manual = manualType === "pallet"
      ? { type: "pallet", pallet: sel.value }
      : { type: "groupage", ml: Math.max(0, num($("mMl").value)), q: Math.max(0, num($("mQ").value)), b: Math.max(0, Math.round(num($("mB").value))) };
    if(manual.type === "groupage" && !(manual.ml || manual.q || manual.b)){ toast("Indica almeno metri, peso o bancali"); return; }
    addLine({ kind: "manual", manual });
    $("manualBox").hidden = true; $("btnManual").hidden = false;
    toast("Collo aggiunto al carico");
  });
}

/* ====================== Destinazione e servizi ====================== */
function fillRegions(){
  $("regSelect").innerHTML = `<option value="">Scegli la regione</option>` +
    D.geo.map((r) => `<option value="${esc(r.id)}">${esc(r.nome)}</option>`).join("");
}
function fillProvinces(){
  const sel = $("provSelect");
  const r = regById(S.reg);
  if(!r){ sel.innerHTML = `<option value="">Prima scegli la regione</option>`; sel.disabled = true; return; }
  sel.disabled = false;
  sel.innerHTML = `<option value="">Scegli la provincia</option>` +
    r.province.map((p) => `<option value="${p.sigla}">${esc(p.nome)} (${p.sigla})</option>`).join("");
  if(r.province.length === 1) S.prov = r.province[0].sigla;
  sel.value = S.prov || "";
}
function setupDest(){
  $("regSelect").addEventListener("change", (e) => { S.reg = e.target.value; S.prov = ""; fillProvinces(); saveState(); renderCart(); render(); });
  $("provSelect").addEventListener("change", (e) => { S.prov = e.target.value; saveState(); renderCart(); render(); });
  [["optAss", "ass"], ["optPre", "pre"], ["optDis", "dis"]].forEach(([id, k]) => {
    $(id).checked = !!S.opts[k];
    $(id).addEventListener("change", (e) => { S.opts[k] = e.target.checked; saveState(); syncDis(); render(); });
  });
  const inp = $("disEur");
  inp.value = num(S.opts.disEur) > 0 ? String(S.opts.disEur) : "";
  inp.addEventListener("input", () => { S.opts.disEur = Math.max(0, num(inp.value)); saveState(); render(); });
  function syncDis(){ $("disRow").hidden = !S.opts.dis; }
  syncDis();
}

/* ====================== Adeguamenti ====================== */
function renderChips(){
  const chips = [];
  if(ADJ) chips.push(`<span class="chip chip-amber">${ADJ > 0 ? "+" : "−"}${it1(Math.abs(ADJ))}%</span>`);
  if(FUEL.on && D.gasolio) chips.push(`<span class="chip chip-amber">Gasolio ${fuelPctFor(S.reg) >= 0 ? "+" : "−"}${it1(Math.abs(fuelPctFor(S.reg)))}%</span>`);
  $("adjChips").innerHTML = chips.join("");
}
function paintFuel(){
  const box = $("fuelInfo");
  if(!D.gasolio){ box.textContent = "Dati gasolio non disponibili senza connessione."; return; }
  const d = fuelDelta(), g = D.gasolio;
  box.textContent = `Oggi ${it1(g.attuale.prezzo, 3)} €/l (MIMIT, ${dataIt(g.attuale.data)}), ${g.base.descrizione} ${it1(g.base.prezzo, 3)} €/l: ${d >= 0 ? "+" : "−"}${it1(Math.abs(d))}%.`;
}
function setupAdjust(){
  ADJ = num(ls(STORE.adj), 0);
  const f = ls(STORE.fuel);
  if(f) FUEL = { on: !!f.on, share: num(f.share, FUEL_DEFAULTS.share), shareIs: num(f.shareIs, FUEL_DEFAULTS.shareIs) };

  const inp = $("adjPct");
  inp.value = String(ADJ);
  const apply = (v) => { ADJ = Math.max(-90, Math.min(300, round2(num(v)))); ls(STORE.adj, ADJ || null); render(); };
  inp.addEventListener("input", () => apply(inp.value));
  inp.addEventListener("blur", () => { inp.value = String(ADJ); });
  $("adjUp").addEventListener("click", () => { inp.value = String(round2(ADJ + 1)); apply(inp.value); });
  $("adjDown").addEventListener("click", () => { inp.value = String(round2(ADJ - 1)); apply(inp.value); });
  $("adjReset").addEventListener("click", () => { inp.value = "0"; apply(0); });

  $("fuelOn").checked = FUEL.on;
  $("fuelShare").value = FUEL.share;
  $("fuelShareIs").value = FUEL.shareIs;
  const saveF = () => { ls(STORE.fuel, FUEL); render(); };
  $("fuelOn").addEventListener("change", (e) => { FUEL.on = e.target.checked; saveF(); });
  $("fuelShare").addEventListener("input", (e) => { FUEL.share = Math.max(0, Math.min(100, num(e.target.value, 30))); saveF(); });
  $("fuelShareIs").addEventListener("input", (e) => { FUEL.shareIs = Math.max(0, Math.min(100, num(e.target.value, 15))); saveF(); });
  if(ADJ || FUEL.on) $("adjustBox").open = true;
  paintFuel();
}

/* ====================== Condivisione ====================== */
function summaryText(){
  const R = LAST;
  const L = [];
  L.push("STIMA COSTO DI TRASPORTO");
  L.push(`Data: ${dataIt(new Date().toISOString().slice(0, 10))}`);
  L.push(`Destinazione: ${destLabel()}`);
  L.push("");
  L.push("Carico:");
  S.cart.forEach((l) => L.push(`- ${l.qty} × ${lineTitle(l)}`));
  L.push("");
  R.lines.forEach((l) => L.push(`${l.t}${l.s ? ` (${l.s})` : ""}: ${eur(l.v)}`));
  L.push("");
  L.push(`TOTALE: ${eur(R.total)} + IVA`);
  const notes = [...R.notes, ...R.infos];
  if(notes.length){ L.push(""); notes.forEach((n) => L.push(`Nota: ${n}`)); }
  const refs = refLines(R.used).map((h) => h.replace(/<[^>]+>/g, ""));
  if(refs.length){ L.push(""); L.push(`Calcolato su: ${refs.join("; ")}`); }
  return L.join("\n");
}
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); return true; }
  catch{
    const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); let ok = false; try{ ok = document.execCommand("copy"); }catch{} ta.remove(); return ok;
  }
}
function setupShare(){
  $("btnCopy").addEventListener("click", async () => { toast(await copyText(summaryText()) ? "Riepilogo copiato" : "Copia non riuscita"); });
  $("btnShare").addEventListener("click", async () => {
    const text = summaryText();
    if(navigator.share){ try{ await navigator.share({ title: "Stima costo di trasporto", text }); return; }catch(e){ if(e.name === "AbortError") return; } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  });
  $("btnPrint").addEventListener("click", () => window.print());
}

/* ====================== Finestra listini ====================== */
function stamp(label, value){ return `<span class="stamp"><small>${esc(label)}</small><b>${esc(value)}</b></span>`; }
function buildListini(){
  const L = D.listini, p = L.servizi.pallet, g = L.servizi.groupage;
  const baseTypes = D.pallet.tipi.filter((t) => !t.extraPct);
  const g0 = D.gasolio;
  const fornitore = (s) => `<p class="hint">${s.fornitore ? `Trasportatore: <b>${esc(s.fornitore)}</b> · ` : ""}${esc(s.listino)}</p>`;
  $("dlgBody").innerHTML = `
    <section class="sup">
      <h3>${esc(p.titolo)}</h3>
      ${fornitore(p)}
      <div class="sup-when">${stamp("Tariffe di riferimento", p.riferimento)}</div>
      <ul>${p.condizioni.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      <div class="table-wrap"><table class="ptable">
        <thead><tr><th>Pallet</th><th>Base</th><th>Altezza max</th><th>Peso max</th></tr></thead>
        <tbody>${baseTypes.map((t) => `<tr><td><b>${t.id}</b></td><td>100×120 cm</td><td>${t.altezzaCm} cm</td><td>${t.kgMax} kg</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="hint" style="margin-top:8px">Le varianti con “+%” si applicano ai prodotti con base più grande di 100×120 cm.</p>
    </section>
    <section class="sup">
      <h3>${esc(g.titolo)}</h3>
      ${fornitore(g)}
      <div class="sup-when">${stamp("Tariffe di riferimento", g.riferimento)}${stamp("In vigore dal", dataIt(g.decorrenza))}</div>
      <ol class="timeline">${g.storico.slice().reverse().map((h) => `<li><time>${esc(dataIt(h.data, true))}</time>${esc(h.testo)}</li>`).join("")}</ol>
      <ul>${g.condizioni.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    </section>
    ${L.catalogo ? `<section class="sup">
      <h3>Pesi e misure dei prodotti</h3>
      <p class="hint">${esc(L.catalogo.fonte)}. ${esc(L.catalogo.nota)}</p>
    </section>` : ""}
    <section class="sup">
      <h3>Prezzo del gasolio</h3>
      <p class="hint">${esc(L.gasolio.fonte)}. ${esc(L.gasolio.nota)}.</p>
      <div class="sup-when">${g0 ? stamp("Ultimo dato", dataIt(g0.attuale.data)) + stamp("Prezzo", `${it1(g0.attuale.prezzo, 3)} €/l`) : ""}</div>
    </section>
    <p class="hint">Dati dell'app aggiornati al ${esc(dataIt(L.aggiornato, true))}.</p>`;
}
function setupDialog(){
  const dlg = $("dlgListini");
  $("btnListini").addEventListener("click", () => { buildListini(); dlg.showModal(); });
  $("dlgClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if(e.target === dlg) dlg.close(); });
}

/* ====================== Barra prezzo su telefono ====================== */
let docketVisible = true;
function updatePricebar(){
  const small = window.matchMedia("(max-width: 960px)").matches;
  $("pricebar").hidden = !(small && LAST?.ready && !docketVisible);
}
function setupPricebar(){
  new IntersectionObserver((ents) => { docketVisible = ents[0].isIntersecting; updatePricebar(); }, { threshold: 0.15 }).observe($("docket"));
  $("pbGo").addEventListener("click", () => $("docket").scrollIntoView({ behavior: "smooth", block: "start" }));
  window.addEventListener("resize", updatePricebar);
}

/* ====================== Stato ====================== */
function saveState(){ ls(STORE.state, S); }
function loadState(){
  const s = ls(STORE.state);
  if(!s) return;
  S.reg = regById(s.reg) ? s.reg : "";
  S.prov = s.prov || "";
  S.opts = { ass: !!s.opts?.ass, pre: !!s.opts?.pre, dis: !!s.opts?.dis, disEur: num(s.opts?.disEur) };
  S.cart = (s.cart || []).filter((l) => l.kind === "manual" || artById(l.artId)).map((l) => ({ ...l, uid: uidSeq++ }));
}

let toastT;
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ====================== Aggiornamenti automatici ====================== */
/* Aggiornamento automatico: appena sul server c'è una versione nuova (programma o tariffe)
   l'app si ricarica da sola. Il carico e le scelte restano, perché sono salvati sul dispositivo. */
async function forceUpdate(reason){
  const K = "ct_upd", now = Date.now();
  let t = [];
  try{ t = JSON.parse(sessionStorage.getItem(K) || "[]").filter((x) => now - x < 120000); }catch{}
  if(t.length >= 2){                         // evita ricariche continue: dopo 2 tentativi chiede all'utente
    $("updBar").classList.add("show");
    return;
  }
  t.push(now);
  try{ sessionStorage.setItem(K, JSON.stringify(t)); sessionStorage.setItem("ct_updated", reason || "1"); }catch{}
  try{
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    if(window.caches){ const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
  }catch{}
  location.replace(`./?v=${now}`);
}

async function remoteBuild(){
  try{
    const r = await fetch(`versione.json?v=${Date.now()}`, { cache: "no-store" });
    return r.ok ? num((await r.json()).app, 0) : 0;
  }catch{ return 0; }
}

function setupUpdates(){
  const WATCH = ["index.html", "app.js", "styles.css", "data/listini.json", "data/pallet.json", "data/groupage.json", "data/articoli.json", "data/geo.json"];
  let baseline = null;

  async function fingerprint(){
    const parts = [];
    for(const f of WATCH){
      try{
        const r = await fetch(`${f}?v=${Date.now()}`, { cache: "no-store" });
        parts.push(`${f}:${r.ok ? await r.text() : "x"}`);
      }catch{ return null; }
    }
    const txt = parts.join("\n");
    if(crypto?.subtle){
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 0; for(let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0; return String(h);
  }
  async function check(){
    if(!navigator.onLine) return;
    if(await remoteBuild() > APP_BUILD){ forceUpdate("programma"); return; }
    const fp = await fingerprint();
    if(!fp) return;
    if(baseline === null){ baseline = fp; return; }
    if(fp !== baseline) forceUpdate("tariffe");
  }

  $("updNow").addEventListener("click", () => { try{ sessionStorage.removeItem("ct_upd"); }catch{} forceUpdate("manuale"); });
  $("updLater").addEventListener("click", () => $("updBar").classList.remove("show"));
  navigator.serviceWorker?.addEventListener("message", (ev) => { if(ev.data?.type === "SW_UPDATED") check(); });

  // appena aggiornata: pulisco l'indirizzo e lo segnalo
  try{
    if(sessionStorage.getItem("ct_updated")){ sessionStorage.removeItem("ct_updated"); toast("App aggiornata all'ultima versione"); }
  }catch{}
  if(/[?&]v=/.test(location.search)) history.replaceState(null, "", location.pathname);

  check();
  document.addEventListener("visibilitychange", async () => {
    if(document.visibilityState !== "visible") return;
    check();
    try{ D.gasolio = await getJSON("data/gasolio.json"); paintFuel(); render(); }catch{}
  });
  window.addEventListener("pageshow", (e) => { if(e.persisted) check(); });
  window.addEventListener("online", check);
  setInterval(check, 5 * 60 * 1000);
}

/* ====================== Avvio ====================== */
async function init(){
  if(navigator.onLine && await remoteBuild() > APP_BUILD){ forceUpdate("programma"); return; }
  $("dkDate").textContent = dataIt(new Date().toISOString().slice(0, 10));
  try{
    const [listini, pallet, groupage, articoli, geo] = await Promise.all(
      ["listini", "pallet", "groupage", "articoli", "geo"].map((n) => getJSON(`data/${n}.json`)));
    Object.assign(D, { listini, pallet, groupage, articoli, geo });
    if(pallet.versione !== DATI_VERSIONE || groupage.versione !== DATI_VERSIONE) throw new Error("versione");
  }catch(e){
    if(e.message === "versione"){
      // programma e tariffe di versioni diverse: non mostro prezzi e aggiorno
      $("dkLines").innerHTML = `<p class="dk-empty">È in corso un aggiornamento delle tariffe. Riprova tra qualche minuto.</p>`;
      forceUpdate("versione");
      return;
    }
    $("dkLines").innerHTML = `<p class="dk-empty">Impossibile caricare i listini. Controlla la connessione e riapri l'app.</p>`;
    return;
  }
  try{ D.gasolio = await getJSON("data/gasolio.json"); }catch{ D.gasolio = null; }

  loadState();
  fillCategories();
  fillRegions();
  $("regSelect").value = S.reg;
  fillProvinces();
  setupCombo();
  setupManual();
  setupDest();
  setupAdjust();
  setupShare();
  setupDialog();
  setupPricebar();
  $("cart").addEventListener("click", onCartClick);
  renderCart();
  render();
  setupUpdates();
}

if("serviceWorker" in navigator){
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {}));
}
init();
