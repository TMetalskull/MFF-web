import json
import os

fajl_nev = 'karakterek.json'

def adatbazis_frissitese():
    if not os.path.exists(fajl_nev):
        print(f"Hiba: A {fajl_nev} nem található.")
        return

    with open(fajl_nev, 'r', encoding='utf-8') as f:
        adatok = json.load(f)

    frissitett_db = 0

    for karakter in adatok:
        # Ha nincs meta_tier, létrehozzuk
        if "meta_tier" not in karakter:
            karakter["meta_tier"] = "UNRANKED"
            frissitett_db += 1
            
        # Ha a mechanics_tags hiányzik, üres listaként pótoljuk a stabilitásért
        if "mechanics_tags" not in karakter:
            karakter["mechanics_tags"] = []

    with open(fajl_nev, 'w', encoding='utf-8') as f:
        json.dump(adatok, f, ensure_ascii=False, indent=4)

    print(f"Sikeres frissítés! {frissitett_db} karakter kapta meg az új tag-eket.")

if __name__ == "__main__":
    adatbazis_frissitese()