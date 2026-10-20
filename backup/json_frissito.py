import json
import pandas as pd

def frissit_json_ctp_vel():
    # Fájlnevek
    json_fajl = 'karakterek.json'
    csv_fajl = 'mff_t4_koreai_meta_szazalekos_vegleges.csv'
    
    try:
        # JSON beolvasása
        with open(json_fajl, 'r', encoding='utf-8') as f:
            karakterek = json.load(f)
            
        # CSV beolvasása
        df = pd.read_csv(csv_fajl, sep=';')
        
        Frissitett_karakterek_szama = 0

        # Végigmegyünk a JSON karaktereken
        for index, char_data in enumerate(karakterek):
            json_nev = str(char_data.get('character', '')).strip().upper().replace(' ', '').replace('-', '')
            
            # Keresés a CSV-ben
            koreai_adat = df[df['Karakter'] == json_nev]
            
            if not koreai_adat.empty:
                # Kinyerjük a top 2 CTP-t a karakterhez
                top_ctpk = koreai_adat.head(2)
                ctp_szoveg_lista = []
                
                for _, row in top_ctpk.iterrows():
                    ctp_szoveg_lista.append(f"{row['CTP']} ({row['%']})")
                
                uj_ctp_ertek = " / ".join(ctp_szoveg_lista) + " (Koreai Top 108)"
                
                # Felülírjuk az equipment objektumban a custom_gear-t
                if 'equipment' in char_data:
                    karakterek[index]['equipment']['custom_gear'] = uj_ctp_ertek
                    Frissitett_karakterek_szama += 1

        # Visszaírjuk a frissített JSON-t
        with open('karakterek_frissitett.json', 'w', encoding='utf-8') as f:
            json.dump(karakterek, f, indent=4, ensure_ascii=False)
            
        print(f"Kész! {Frissitett_karakterek_szama} karakter CTP adata automatikusan frissítve a koreai meta alapján.")
        print("Az eredmény a 'karakterek_frissitett.json' fájlba került.")
        
    except Exception as e:
        print(f"Kritikus hiba történt a futás során: {e}")

if __name__ == "__main__":
    frissit_json_ctp_vel()