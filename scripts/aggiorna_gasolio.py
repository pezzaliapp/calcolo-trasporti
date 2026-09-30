"""Aggiorna data/gasolio.json con il prezzo medio nazionale del gasolio self (rete stradale)
pubblicato ogni mattina dal MIMIT. Eseguito in automatico da GitHub Actions (gratis).
Se il sito MIMIT non risponde o cambia formato, il file NON viene toccato."""
import json, re, sys, urllib.request
from pathlib import Path

URL = "https://www.mimit.gov.it/it/prezzi-carburanti-media-nazionale"
FILE = Path(__file__).resolve().parent.parent / "data" / "gasolio.json"


def estrai(html: str):
    testo = re.sub(r"<[^>]+>", " ", html)
    testo = re.sub(r"&nbsp;|\s+", " ", testo)
    i = testo.lower().find("prezzi rete stradale")
    if i < 0:
        raise ValueError("sezione 'rete stradale' non trovata")
    j = testo.lower().find("prezzi rete autostradale", i)
    sezione = testo[i: j if j > 0 else None]
    d = re.search(r"Aggiornamento\s+(\d{2})-(\d{2})-(\d{4})", sezione)
    p = re.search(r"Gasolio\s+(\d[.,]\d{3})", sezione)
    if not (d and p):
        raise ValueError("data o prezzo gasolio non trovati")
    prezzo = float(p.group(1).replace(",", "."))
    if not 0.8 <= prezzo <= 4.0:
        raise ValueError(f"prezzo fuori scala: {prezzo}")
    return prezzo, f"{d.group(3)}-{d.group(2)}-{d.group(1)}"


def main():
    req = urllib.request.Request(URL, headers={
        "User-Agent": "Mozilla/5.0 (compatible; trasporti-pwa/1.0)",
        "Accept-Language": "it-IT,it;q=0.9",
    })
    try:
        html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        prezzo, data = estrai(html)
    except Exception as e:
        print(f"Nessun aggiornamento: {e}")
        return 0

    dati = json.loads(FILE.read_text(encoding="utf-8"))
    if dati.get("attuale") == {"prezzo": prezzo, "data": data}:
        print("Già aggiornato.")
        return 0
    dati["attuale"] = {"prezzo": prezzo, "data": data}
    FILE.write_text(json.dumps(dati, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Aggiornato: {prezzo} €/l del {data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
