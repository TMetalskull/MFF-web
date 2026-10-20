import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getFirestore, collection, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAwxRBst_SDlj06FAXCdjot2JHHAvaBrj8",
    authDomain: "mff-lexikon.firebaseapp.com",
    projectId: "mff-lexikon",
    storageBucket: "mff-lexikon.firebasestorage.app",
    messagingSenderId: "862240235182",
    appId: "1:862240235182:web:dff321e9560bcb8d0d573f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let nyersKarakterAdatok = [];
let szurok = { mode: 'all', type: 'all', species: 'all', alignment: 'all', role: 'all', search: '' };
const szinek = { 'Combat': '#ef5350', 'Blast': '#29b6f6', 'Speed': '#66bb6a', 'Universal': '#ab47bc' };
let jelenlegiNezet = 'grid-mod-gomb';
let utolsoScrollPozicio = 0;

let sajatRaktar = JSON.parse(localStorage.getItem('mff_raktar')) || [];

// ==============================================================
// AUTOMATIKUS ADATKITÖLTŐ MOTOR (NULLA KÉZI MUNKÁHOZ)
// ==============================================================
const DEFAULT_URUS = {
    ENERGY: [
        "Odin's Blessing Magic (Energy Attack + Energy Attack)",
        "Odin's Blessing Insight (Energy Attack + Ignore Defense)",
        "Odin's Blessing Amplify (Energy Attack + Critical Damage)",
        "Odin's Blessing Focus (Energy Attack + Critical Rate)",
        "Odin's Blessing Will (Energy Attack + Skill Cooldown)",
        "Odin's Blessing Heal (HP + HP)"
    ],
    PHYSICAL: [
        "Odin's Blessing Strike (Physical Attack + Physical Attack)",
        "Odin's Blessing Fortitude (Physical Attack + Ignore Defense)",
        "Odin's Blessing Steel (Physical Attack + Critical Damage)",
        "Odin's Blessing Toughness (Physical Attack + Critical Rate)",
        "Odin's Blessing Will (Physical Attack + Skill Cooldown)",
        "Odin's Blessing Heal (HP + HP)"
    ],
    HP: [
        "Odin's Blessing Heal (HP + HP) - Minden lehetséges helyre HP-t kell tenni!",
        "Attack Uru használata felesleges, mivel tisztán HP-ból skálázódik!"
    ]
};

function getAutoSlug(charName) {
    if (!charName) return 'placeholder';
    return String(charName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getAutoUruSetup(c) {
    if (Array.isArray(c.equipment?.uru_setup) && c.equipment.uru_setup.length > 0) {
        return c.equipment.uru_setup;
    }
    const tags = (c.mechanics_tags || []).map(t => String(t).toLowerCase());
    const dmgType = String(c.damage_type || '').toLowerCase();

    if (tags.includes('hp_scaling') || dmgType === 'hp') {
        return DEFAULT_URUS.HP;
    }
    if (
        tags.some(t => t.includes('physical')) ||
        dmgType.includes('physical') ||
        (!tags.some(t => t.includes('energy') || t.includes('flame') || t.includes('cold') || t.includes('lightning') || t.includes('mind')) &&
         (c.type === 'Combat' || c.type === 'Speed'))
    ) {
        return DEFAULT_URUS.PHYSICAL;
    }
    return DEFAULT_URUS.ENERGY;
}

function automatikusKarakterKiegeszites(rawChar) {
    const c = { ...rawChar };
    const slug = getAutoSlug(c.character);

    // 1. Automatikus portrékép URL (ha nincs megadva a JSON-ban)
    if (!c.image_url) {
        c.image_url = `${slug}.webp`;
    }

    // 2. Koreai bot által feltöltött meta_ctp elemzése (T4 státusz, birtoklási szám, szerepkör)
    const metaCtpUpper = String(c.meta_ctp || '').toUpperCase();
    const hasBotMeta = metaCtpUpper && metaCtpUpper !== 'NINCS ADAT' && metaCtpUpper !== '-';

    let koreaiMintaSzam = 0;
    const matchCount = metaCtpUpper.match(/KOREAI TOP\s+(\d+)/i);
    if (matchCount) {
        koreaiMintaSzam = parseInt(matchCount[1], 10);
    }

    if (hasBotMeta && koreaiMintaSzam > 0) {
        c.tier = 'T4';
    } else if (!c.tier) {
        c.tier = 'T4';
    }

    // 3. Automatikus PvE / PvP / Leader / Support felismerés (bot CTP + Szerkesztő címkék alapján)
    const isPvpCtp = /CONQUEST|AUTHORITY|GREED|REFINEMENT|REGENERATION/.test(metaCtpUpper);
    const isPveCtp = /RAGE|COMPETITION|JUDGEMENT|JUDGMENT|ENERGY|DESTRUCTION/.test(metaCtpUpper);
    const isSupCtp = /LIBERATION|INSIGHT|ASCENT/.test(metaCtpUpper);

    const tagsLower = (c.mechanics_tags || []).map(t => String(t).toLowerCase());
    const hasLeaderTag = tagsLower.includes('leadership') || tagsLower.includes('leader');
    const hasSupportTag = tagsLower.includes('support') || isSupCtp;

    if (!c.usage || c.usage === '?') {
        if (isPvpCtp && isPveCtp) c.usage = 'PvE & PvP Hybrid';
        else if (isPvpCtp) c.usage = 'PvP Meta';
        else if (hasSupportTag && !isPveCtp && !isPvpCtp) c.usage = 'PvE / PvP Support';
        else c.usage = 'PvE Meta';
    }

    if (!c.role || c.role === '-') {
        let roleParts = [c.type || ''];
        if (isPvpCtp && isPveCtp) roleParts.push('Hybrid DPS');
        else if (isPvpCtp) roleParts.push('PvP DPS');
        else roleParts.push('PvE DPS');

        if (hasLeaderTag) roleParts.push('Leader');
        if (hasSupportTag) roleParts.push('Support');
        c.role = roleParts.join(' / ').trim();
    } else {
        if (hasLeaderTag && !c.role.toLowerCase().includes('leader')) c.role += ' / Leader';
        if (hasSupportTag && !c.role.toLowerCase().includes('support')) c.role += ' / Support';
    }

    // 4. Automatikus Meta Tier (SS / S / A / B) számítás a koreai T4 birtoklás alapján
    if (!c.meta_tier || c.meta_tier === 'UNRANKED') {
        if (koreaiMintaSzam >= 32) c.meta_tier = 'SS';
        else if (koreaiMintaSzam >= 18) c.meta_tier = 'S';
        else if (koreaiMintaSzam >= 6) c.meta_tier = 'A';
        else if (koreaiMintaSzam >= 1) c.meta_tier = 'B';
    }

    // 5. Automatikus ISO-8 és Uru kitöltés
    if (!c.equipment) c.equipment = {};
    if (c.meta_iso && c.meta_iso !== '-' && c.meta_iso !== 'ÜRES') {
        c.equipment.iso_8_set = c.meta_iso;
    } else if (!c.equipment.iso_8_set || c.equipment.iso_8_set === 'Nincs adat') {
        c.equipment.iso_8_set = isPvpCtp && !isPveCtp
            ? "Power of Angry Hulk / Overdrive / Binary Power (PvP)"
            : "Power of Angry Hulk / Overdrive";
    }
    c.equipment.uru_setup = getAutoUruSetup(c);

    // 6. Automatikus Artifact kép
    if (c.own_artifact && !c.own_artifact.image) {
        c.own_artifact.image = `artifact_${slug}.webp`;
    }

    return c;
}

// ==============================================================
// UI ELEMEK ÉS ESEMÉNYKEZELŐK
// ==============================================================
const hamburgerGomb = document.getElementById('hamburger-menu-gomb');
const szuroDrawer = document.getElementById('szuro-drawer');
const drawerBezaras = document.getElementById('drawer-bezar-gomb');
const drawerOverlay = document.getElementById('drawer-overlay');
const felGomb = document.getElementById('vissza-a-tetejere');

function nyitSzurok() { szuroDrawer.classList.add('nyitva'); drawerOverlay.classList.add('aktiv'); }
function csukSzurok() { szuroDrawer.classList.remove('nyitva'); drawerOverlay.classList.remove('aktiv'); }
hamburgerGomb.addEventListener('click', nyitSzurok);
drawerBezaras.addEventListener('click', csukSzurok);
drawerOverlay.addEventListener('click', csukSzurok);

window.addEventListener('scroll', () => { felGomb.style.display = window.scrollY > 300 ? 'flex' : 'none'; });
felGomb.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });

function formatMFFStats(text) { 
    if (!text) return ''; 
    // 1. Kacsacsőrök HTML-kódolása, hogy a <Galactus> vagy hasonló szövegek ne törjék szét a weboldalt
    let safeText = String(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // 2. Számok és százalékok zöldítése
    return safeText.replace(/([+-]?\d+(?:\.\d+)?%?)/g, '<span class="ertek-zold">$1</span>'); 
}

function getCTPIcon(ctpText) {
    if (!ctpText) return '';
    const val = ctpText.toUpperCase();
    let iconFile = '';
    let fallbackFile = 'images/icons/placeholder.webp';

    if (val.includes('RAGE')) iconFile = 'ctp_rage.webp';
    else if (val.includes('CONQUEST')) iconFile = 'ctp_conquest.webp';
    else if (val.includes('COMPETITION')) iconFile = 'ctp_competition.webp';
    else if (val.includes('TRANSCENDENCE')) iconFile = 'ctp_transcendence.webp';
    else if (val.includes('AUTHORITY')) iconFile = 'ctp_authority.webp';
    else if (val.includes('GREED')) iconFile = 'ctp_greed.webp';
    else if (val.includes('INSIGHT')) iconFile = 'ctp_insight.webp';
    else if (val.includes('JUDGEMENT') || val.includes('JUDGMENT')) {
        iconFile = 'ctp_judgment.webp';
        fallbackFile = 'images/icons/ctp_judgement.webp';
    }
    else if (val.includes('REFINEMENT')) iconFile = 'ctp_refinement.webp';
    else if (val.includes('ENERGY')) iconFile = 'ctp_energy.webp';
    else if (val.includes('DESTRUCTION')) iconFile = 'ctp_destruction.webp';
    else if (val.includes('REGENERATION')) iconFile = 'ctp_regeneration.webp';
    else if (val.includes('LIBERATION')) iconFile = 'ctp_liberation.webp';
    else if (val.includes('VETERAN')) iconFile = 'ctp_veteran.webp';
    else if (val.includes('PATIENCE')) iconFile = 'ctp_patience.webp';
    else if (val.includes('ASCENT')) iconFile = 'ctp_ascent.webp';

    if (iconFile) {
        return `<img src="images/icons/${iconFile}" onerror="this.onerror=null; this.src='${fallbackFile}';" style="width: 50px; height: 50px; object-fit: contain; margin-right: 8px; border-radius: 4px; border: 1px solid #4da6ff;">`;
    }
    return '';
}

function formatCTPList(ctpString) {
    if (!ctpString || ctpString === 'Nincs adat' || ctpString === '-') {
        return '<span class="mff-highlight-green" style="margin-left: 10px;">Nincs adat</span>';
    }
    return `<ul class="adat-lista" style="margin-top: 5px;">${ctpString.split('/').map(part => {
        let text = part.trim();
        if (!text || text === '-') return '';
        return `<li style="display: flex; align-items: center; margin-bottom: 8px;">${getCTPIcon(text)}<span class="mff-highlight-green">${formatMFFStats(text)}</span></li>`;
    }).join('')}</ul>`;
}

function getCancelIcon(text) {
    if (!text) return '';
    const val = text.toLowerCase(); let iconFile = '';
    if (val.includes('silence')) iconFile = 'icon_silence.webp'; else if (val.includes('paralysis')) iconFile = 'icon_paralysis.webp';
    else if (val.includes('fear')) iconFile = 'icon_fear.webp'; else if (val.includes('stun')) iconFile = 'icon_stun.webp';
    else if (val.includes('fracture')) iconFile = 'icon_fracture.webp'; else if (val.includes('snare')) iconFile = 'icon_snare.webp';
    else if (val.includes('shock')) iconFile = 'icon_shock.webp'; else if (val.includes('burn')) iconFile = 'icon_burn.webp';
    else if (val.includes('time freez')) iconFile = 'icon_time_freezing.webp'; else if (val.includes('freeze')) iconFile = 'icon_freeze.webp';
    else if (val.includes('bind')) iconFile = 'icon_bind.webp'; else if (val.includes('web')) iconFile = 'icon_web.webp';
    else if (val.includes('mind control')) iconFile = 'icon_mind_control.webp'; else if (val.includes('incapacitation')) iconFile = 'icon_incapacitation.webp';

    if (iconFile) return `<img src="images/icons/${iconFile}" class="cancel-icon">`;
    return '';
}

function formatSkillName(text) {
    if (!text) return '';
    return text.replace(/Active ([\d, ]+)/gi, function(match, p1) {
        let nums = p1.split(',').map(n => n.trim()).filter(n => n !== '');
        return nums.map(num => (num==='1'||num==='2'||num==='4')?num+'-es':(num==='3'?'3-as':(num==='5'?'5-ös':num))).join(', ') + ' skill';
    });
}

function getHardCounters(c) {
    if (!c.matchup_engine || !c.matchup_engine.weak_against || c.matchup_engine.weak_against.length === 0) {
        return '<div class="reszlet-sor" style="color: #666; font-style: italic;">Nincs meta kontra.</div>';
    }
    return c.matchup_engine.weak_against.map(name => `<div class="counter-box"><span style="font-weight:bold; color:var(--mff-t4);">${name}</span></div>`).join('');
}

function getKarakterKep(nev) {
    const talalat = nyersKarakterAdatok.find(k => (k.character || "").toLowerCase() === nev.toLowerCase());
    return talalat && talalat.image_url ? talalat.image_url : `${getAutoSlug(nev)}.webp`;
}

const nezetGombok = document.querySelectorAll('.fejlec-gombok .mod-toggle-btn');
const nezetek = {
    'grid-mod-gomb': 'karakter-grid',
    'ctp-mod-gomb': 'ctp-szuro-view',
    'pvp-mod-gomb': 'pvp-matchup-view',
    'tier-list-gomb': 'tier-list-view',
    'abx-mod-gomb': 'abx-abl-view',
    'kartya-meta-gomb': 'kartya-meta-view'
};

nezetGombok.forEach(btn => {
    btn.addEventListener('click', () => {
        const aktivGombId = btn.id;
        Object.values(nezetek).forEach(viewId => document.getElementById(viewId).classList.add('rejtett'));
        document.getElementById('karakter-reszletek-view').classList.add('rejtett');
        nezetGombok.forEach(g => g.classList.remove('aktiv'));
        document.getElementById(nezetek[aktivGombId]).classList.remove('rejtett');
        btn.classList.add('aktiv');
        jelenlegiNezet = aktivGombId;
        csukSzurok();
        if(aktivGombId === 'tier-list-gomb') renderTierList();
        if(aktivGombId === 'grid-mod-gomb') { window.scrollTo(0, utolsoScrollPozicio); }
    });
});

function betoltesFirebasebol() {
    onSnapshot(collection(db, "karakterek"), (querySnapshot) => {
        let adatok = [];
        querySnapshot.forEach((docSnap) => {
            const raw = docSnap.data();
            if (raw && raw.character) {
                adatok.push(automatikusKarakterKiegeszites(raw));
            }
        });

        adatok.sort((a, b) => String(a.character || '').localeCompare(String(b.character || '')));

        nyersKarakterAdatok = adatok;
        initGrid(nyersKarakterAdatok);
        initPvPMatchupEngine();
        if (jelenlegiNezet === 'tier-list-gomb') renderTierList();
        if (jelenlegiNezet === 'ctp-mod-gomb') frissitCtpEredmenyek();
    }, (error) => {
        console.error("Kritikus hiba a Firebase adatok lekérésekor:", error);
    });
}

// --- KŐKEMÉNY ZÁRT RENDSZER LOGIKA (ZSILIP) ---
const TITKOS_KOD = "MAGYARMETA2026";

const inviteWall = document.getElementById('invite-wall');
const inviteInput = document.getElementById('invite-input');
const inviteBtn = document.getElementById('invite-btn');
const inviteError = document.getElementById('invite-error');

if (localStorage.getItem('mff_klan_auth') === 'engedelyezve') {
    if (inviteWall) inviteWall.style.display = 'none';
    betoltesFirebasebol();
} else {
    if (inviteBtn) {
        inviteBtn.addEventListener('click', () => {
            if (inviteInput.value === TITKOS_KOD) {
                localStorage.setItem('mff_klan_auth', 'engedelyezve');
                inviteWall.style.display = 'none';
                betoltesFirebasebol();
            } else {
                inviteError.style.display = 'block';
                inviteInput.value = '';
            }
        });
    }
    if (inviteInput) {
        inviteInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                inviteBtn.click();
            }
        });
    }
}

function letrehozKarakterKartya(c) {
    const color = szinek[c.type] || '#fff';
    const letter = c.type ? c.type[0].toUpperCase() : '';

    let rawUsage = (c.usage || '').toUpperCase();
    let shortUsage = c.usage || '?';
    if (rawUsage.includes('HYBRID') || (rawUsage.includes('PVE') && rawUsage.includes('PVP'))) {
        shortUsage = 'PVE & PVP';
    } else if (rawUsage.includes('PVE')) {
        shortUsage = 'PVE';
    } else if (rawUsage.includes('PVP')) {
        shortUsage = 'PVP';
    } else if (shortUsage.length > 15) {
        shortUsage = shortUsage.substring(0, 12) + '...';
    }

    const typeIconName = c.type ? `icon_${c.type.toLowerCase()}.webp` : 'icon_unknown.webp';
    const alignIconName = c.alignment ? `icon_${c.alignment.toLowerCase().replace(/ /g, '_')}.webp` : 'icon_unknown.webp';

    const kartya = document.createElement('div');
    kartya.className = 'karakter-kartya';
    kartya.style.setProperty('--type-color', color);

    const benneVan = sajatRaktar.includes(c.character);

    kartya.innerHTML = `
        <div class="hatter-betu">${letter}</div>
        <button class="sajat-gomb ${benneVan ? 'megvan' : ''}" data-char="${c.character}" title="Hozzáadás / Törlés a saját raktárból">★</button>
        <div class="portre-keret"><img src="images/portraits/${c.image_url}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" alt="${c.character}"></div>
        <h2>${c.character}</h2>
        <div class="badge-sor" style="margin-bottom: 8px;">
            <span class="badge ${c.tier === 'T4' ? 'badge-t4' : 'badge-t3'}">${c.tier || 'T4'}</span>
            <div class="badge-icon-text" style="border-color: ${color}; color: ${color};"><img src="images/icons/${typeIconName}" class="meta-icon"> ${c.type || '?'}</div>
        </div>
        <div class="badge-sor" style="margin-bottom: 15px;">
            <div class="badge-icon-text" style="background:#2a3441; border-color:#8892b0;"><img src="images/icons/${alignIconName}" class="meta-icon"> ${c.alignment || '?'}</div>
            <span class="badge badge-usage" title="${c.usage || ''}">${shortUsage}</span>
        </div>
        <button class="reszletek-gomb">Adatlap megnyitása</button>
    `;

    kartya.querySelector('.sajat-gomb').addEventListener('click', function(e) {
        e.stopPropagation();
        const charName = this.getAttribute('data-char');
        if (sajatRaktar.includes(charName)) {
            sajatRaktar = sajatRaktar.filter(n => n !== charName);
            this.classList.remove('megvan');
        } else {
            sajatRaktar.push(charName);
            this.classList.add('megvan');
        }
        localStorage.setItem('mff_raktar', JSON.stringify(sajatRaktar));

        if(document.getElementById('sajat-raktar-toggle').checked) {
            if (jelenlegiNezet === 'grid-mod-gomb') szuresEsMegjelenites();
            if (jelenlegiNezet === 'ctp-mod-gomb') frissitCtpEredmenyek();
        }
    });

    kartya.querySelector('.reszletek-gomb').addEventListener('click', () => {
        megnyitKarakterAdatlap(c, color);
    });

    return kartya;
}

function initGrid(adatok) {
    const grid = document.getElementById('karakter-grid');
    grid.innerHTML = '';
    adatok.forEach((c) => {
        grid.appendChild(letrehozKarakterKartya(c));
    });
}

function megnyitKarakterAdatlap(c, color) {
    utolsoScrollPozicio = window.scrollY;

    if (jelenlegiNezet === 'grid-mod-gomb') {
        document.getElementById('karakter-grid').classList.add('rejtett');
    } else if (jelenlegiNezet === 'ctp-mod-gomb') {
        document.getElementById('ctp-szuro-view').classList.add('rejtett');
    }

    document.getElementById('karakter-reszletek-view').classList.remove('rejtett');
    window.scrollTo({ top: 0, behavior: 'auto' });

    const tartalom = document.getElementById('reszletek-dinamikus-tartalom');

    const urus = Array.isArray(c.equipment?.uru_setup) ? c.equipment.uru_setup.map(u => `<li>${formatMFFStats(u)}</li>`).join('') : '<li>Nincs adat</li>';
    const effectsList = Array.isArray(c.uniform_effect) && c.uniform_effect.length > 0 ? c.uniform_effect.map(e => `<li>${formatMFFStats(e)}</li>`).join('') : '<li>Nincs adat</li>';
    const leaderText = Array.isArray(c.recommended_teams?.leader) ? c.recommended_teams.leader.join(', ') : (c.recommended_teams?.leader || '-');
    const supportText = Array.isArray(c.recommended_teams?.supports) ? c.recommended_teams.supports.join(', ') : (c.recommended_teams?.supports || '-');
    const strategyText = c.matchup_engine?.counter_strategy || 'Nincs specifikus stratégia megadva.';

    const uniformHTML = c.best_uniform
        ? `<div class="reszlet-sor"><span class="reszlet-label">Legjobb Uniformis:</span> <span style="color: var(--mff-blast); font-weight: bold;">${c.best_uniform}</span></div>`
        : '';

    const synergyNotesHTML = Array.isArray(c.team_synergy_notes) && c.team_synergy_notes.length > 0
        ? `<span class="reszlet-cim">Meta Elemzés & Csapat Szinergia</span><div style="font-size:13px; line-height:1.6; color:#b3b9c1; background:#12161c; padding:12px 15px; border-left:3px solid var(--mff-blast); border-radius:4px; margin-bottom:15px;">${c.team_synergy_notes.join('<br><br>')}</div>`
        : '';

    let artifactHTML = '';
    if (c.own_artifact) {
        const artImg = 'images/artifacts/' + (c.own_artifact.image || `artifact_${getAutoSlug(c.character)}.webp`);
        const artEff = Array.isArray(c.own_artifact.effect) ? c.own_artifact.effect.map(e => `<div>• ${formatMFFStats(e)}</div>`).join('') : `<div>• ${c.own_artifact.effect || 'Nincs adat'}</div>`;
        artifactHTML = `<span class="reszlet-cim">Exkluzív Artifact</span><div style="display:flex; gap:12px; align-items:center; background:rgba(18,22,28,0.6); border:1px solid #2a3441; border-left:3px solid var(--mff-gold); padding:12px; margin-bottom:15px;"><img src="${artImg}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/artifacts/artifact_placeholder.webp';}" style="width:80px; height:80px; object-fit:contain;"> <div style="font-size:12px; line-height:1.4;">${artEff}</div></div>`;
    }

    let strikerHTML = '';
    if (c.meta_striker && c.meta_striker !== "NINCS ADAT" && c.meta_striker !== "NINCS" && c.meta_striker !== "-") {
        let strikerFajlNev = c.meta_striker.toLowerCase().replace(/ /g, '_');
        strikerHTML = `<span class="reszlet-cim">Koreai Meta Striker</span><div style="display:flex; gap:12px; align-items:center; background:rgba(18,22,28,0.6); border:1px solid #2a3441; border-left:3px solid var(--mff-gold); padding:12px; margin-bottom:15px;"><img src="images/strikers/striker_${strikerFajlNev}.png" onerror="this.onerror=null; this.src='images/portraits/placeholder.webp';" alt="${c.meta_striker}" style="width:75px; height:75px; border-radius:50%; border:2px solid #555e70; box-shadow: 0 4px 8px rgba(0,0,0,0.5); object-fit:cover;"> <div style="font-size:12px; line-height:1.4;"><div style="font-weight:900; font-size:16px; color:#fff; text-transform:uppercase; margin-bottom:4px; letter-spacing: 1px;">${c.meta_striker}</div><div style="color:#8892b0;">• A koreai elit toplista alapján tesztelt meta választás.</div><div style="color:#8892b0;">• Garantálja a maximális Instinct statisztika bónuszt a képességekhez.</div></div></div>`;
    }

    let cancelsHTML = '';
    if ((c.abx_cancels && c.abx_cancels.length > 0) || (c.abl_cancels && c.abl_cancels.length > 0)) {
        let abx = c.abx_cancels ? c.abx_cancels.map(x => `<span class="cancel-item">${getCancelIcon(x)} ${formatSkillName(x)}</span>`).join('') : 'Nincs';
        let abl = c.abl_cancels ? c.abl_cancels.map(x => `<span class="cancel-item">${getCancelIcon(x)} ${formatSkillName(x)}</span>`).join('') : 'Nincs';
        cancelsHTML = `<div class="cancel-box-container"><div class="cancel-box"><h4>ABX Cancels</h4>${abx}</div><div class="cancel-box"><h4>ABL Cancels</h4>${abl}</div></div>`;
    }

    let procHTML = '';
    if (c.proc_rotation) {
        const stdRot = typeof c.proc_rotation === 'string' ? c.proc_rotation : (c.proc_rotation.standard || '-');
        const burstRot = typeof c.proc_rotation === 'object' ? c.proc_rotation.burst : '';
        procHTML = `<span class="reszlet-cim">Makró Rotáció (Proc)</span><div class="proc-box"><div style="font-size:11px; color:#8892b0;">STANDARD</div><div class="proc-text">${stdRot}</div>${burstRot ? `<div style="font-size:11px; color:#8892b0; margin-top:10px;">BURST</div><div class="proc-text" style="color:var(--mff-t4);">${burstRot}</div>` : ''}</div>`;
    } else if (c.gameplay) {
        procHTML = `<span class="reszlet-cim">Játékmenet (Rotáció)</span><div class="reszlet-sor"><span class="reszlet-label">Standard:</span> <span class="mff-highlight-yellow">${c.gameplay.standard_rotation || '-'}</span></div>${c.gameplay.burst_rotation ? `<div class="reszlet-sor" style="margin-top: 5px;"><span class="reszlet-label">T3/T4 Burst:</span> <span class="mff-highlight-red">${c.gameplay.burst_rotation}</span></div>` : ''}`;
    }

    let importantBuffsHTML = '';
    if (c.important_buffs && c.important_buffs.length > 0) {
        const rows = c.important_buffs.map(buff => `<tr><td>${formatMFFStats(buff.name)}</td><td style="color: var(--mff-gold);">${buff.skill}</td></tr>`).join('');
        importantBuffsHTML = `<span class="reszlet-cim">Kiemelt Buffok</span><div style="overflow-x: auto; width: 100%;"><table class="mff-table"><thead><tr><th>Hatás</th><th>Forrás (Skill)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    tartalom.innerHTML = `
        <div class="reszletek-bal" style="--type-color: ${color};">
            <img src="images/portraits/${c.image_url}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" class="karakter-nagy-kep" alt="${c.character}">
            <div style="text-align:center; margin-top: 10px;">
                <h2 style="font-size:28px; margin:0 0 10px 0; text-transform:uppercase; color:#fff; letter-spacing:1px;">${c.character}</h2>
                <div class="badge-sor" style="justify-content:center;">
                    <span class="badge ${c.tier === 'T4' ? 'badge-t4' : 'badge-t3'}">${c.tier || 'T4'}</span>
                    <span class="badge" style="background:#2a3441; color:#fff; border:1px solid ${color};">${c.type || '?'}</span>
                    <span class="badge" style="background:#12161c; color:#8892b0; border:1px solid #2a3441;">${c.usage || '?'}</span>
                </div>
            </div>
        </div>

        <div class="reszletek-jobb">
            <div class="mff-tabs-container">
                <div class="mff-tabs">
                    <button class="mff-tab-btn aktiv" data-target="spa-tab-alap">Alapok & Építés</button>
                    <button class="mff-tab-btn" data-target="spa-tab-rotacio">Mechanikák & Rotáció</button>
                    <button class="mff-tab-btn" data-target="spa-tab-pvp">PvP Stratégia</button>
                </div>
            </div>

            <div id="spa-tab-alap" class="mff-tab-content aktiv">
                ${uniformHTML}
                <div class="reszlet-sor"><span class="reszlet-label">Szerepkör:</span> <span class="mff-highlight-yellow">${c.role || '-'}</span></div>
                <div class="reszlet-sor"><span class="reszlet-label">Legjobb Leader:</span> <span>${leaderText}</span></div>
                <div class="reszlet-sor"><span class="reszlet-label">Ajánlott Supportok:</span> <span>${supportText}</span></div>
                ${synergyNotesHTML}
                ${artifactHTML}
                ${strikerHTML}
                <span class="reszlet-cim">Meta Felszerelés</span>
                <div class="reszlet-sor"><span class="reszlet-label">Ajánlott CTP:</span></div>
                ${formatCTPList(c.meta_ctp || c.equipment?.custom_gear)}
                <div class="reszlet-sor" style="margin-top:10px;"><span class="reszlet-label">Ajánlott ISO-8:</span> <span class="mff-highlight-yellow">${c.meta_iso || c.equipment?.iso_8_set || 'Power of Angry Hulk / Overdrive'}</span></div>
                <span class="reszlet-cim">Uru Beállítás (Prioritás)</span>
                <ul class="adat-lista">${urus}</ul>
            </div>

            <div id="spa-tab-rotacio" class="mff-tab-content">
                ${procHTML}
                ${cancelsHTML}
                ${importantBuffsHTML}
                <span class="reszlet-cim">Passzív Uniformis Hatások</span>
                <ul class="adat-lista">${effectsList}</ul>
            </div>

            <div id="spa-tab-pvp" class="mff-tab-content">
                <span class="reszlet-cim">Alliance Conquest / Timeline Battle</span>
                <div class="reszlet-sor"><span class="reszlet-label">Kemény Kontrák (Akiket kerülni kell):</span></div>
                ${getHardCounters(c)}
                <div class="reszlet-sor" style="margin-top:15px;"><span class="reszlet-label">Túlélési / Kontra Stratégia:</span></div>
                <div style="font-size:13px; line-height:1.6; color:#b3b9c1; background:#12161c; padding:15px; border-left:3px solid var(--mff-speed); border-radius:4px;">${strategyText}</div>
            </div>
        </div>
    `;

    const tabBtns = tartalom.querySelectorAll('.mff-tab-btn');
    const tabContents = tartalom.querySelectorAll('.mff-tab-content');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('aktiv'));
            tabContents.forEach(cont => cont.classList.remove('aktiv'));
            btn.classList.add('aktiv');
            tartalom.querySelector(`#${btn.getAttribute('data-target')}`).classList.add('aktiv');
        });
    });
}

document.getElementById('vissza-a-gridbe-btn').addEventListener('click', () => {
    document.getElementById('karakter-reszletek-view').classList.add('rejtett');

    if(jelenlegiNezet === 'grid-mod-gomb') {
        document.getElementById('karakter-grid').classList.remove('rejtett');
    } else if (jelenlegiNezet === 'ctp-mod-gomb') {
        document.getElementById('ctp-szuro-view').classList.remove('rejtett');
    }

    window.scrollTo({ top: utolsoScrollPozicio, behavior: 'instant' });
});

function szuresEsMegjelenites() {
    if(jelenlegiNezet !== 'grid-mod-gomb') document.getElementById('grid-mod-gomb').click();
    const kartyak = document.querySelectorAll('#karakter-grid .karakter-kartya');
    const csakSajat = document.getElementById('sajat-raktar-toggle').checked;

    kartyak.forEach((kartya, index) => {
        const c = nyersKarakterAdatok[index]; if (!c) return;
        const keresoEgyezik = (c.character || '').toLowerCase().includes(szurok.search.toLowerCase());
        const modEgyezik = szurok.mode === 'all' || ((c.usage || '').toLowerCase().includes(szurok.mode));
        const tipusEgyezik = szurok.type === 'all' || ((c.type || '').toLowerCase() === szurok.type);
        const fajEgyezik = szurok.species === 'all' || ((c.species || '').toLowerCase() === szurok.species);
        const oldalEgyezik = szurok.alignment === 'all' || ((c.alignment || '').toLowerCase() === szurok.alignment);
        const szerepEgyezik = szurok.role === 'all' || ((c.role || '').toLowerCase().includes(szurok.role));

        const sajatEgyezik = !csakSajat || sajatRaktar.includes(c.character);

        if (keresoEgyezik && modEgyezik && tipusEgyezik && fajEgyezik && oldalEgyezik && szerepEgyezik && sajatEgyezik) {
            kartya.classList.remove('rejtett');
        } else {
            kartya.classList.add('rejtett');
        }
    });
}
window.szuresEsMegjelenites = szuresEsMegjelenites;

const keresoMezo = document.getElementById('kereso-mezo');
const keresoTorlesGomb = document.getElementById('kereso-torles-gomb');

keresoMezo.addEventListener('input', (e) => {
    szurok.search = e.target.value;
    if (e.target.value.length > 0) {
        keresoTorlesGomb.classList.remove('rejtett');
    } else {
        keresoTorlesGomb.classList.add('rejtett');
    }
    szuresEsMegjelenites();
});

keresoTorlesGomb.addEventListener('click', () => {
    keresoMezo.value = '';
    szurok.search = '';
    keresoTorlesGomb.classList.add('rejtett');
    szuresEsMegjelenites();
    keresoMezo.focus();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const category = btn.getAttribute('data-category');
        const value = btn.getAttribute('data-value');
        if (!category) return;
        document.querySelectorAll(`.filter-btn[data-category="${category}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        szurok[category] = value;
        szuresEsMegjelenites();
    });
});

window.ugrasKarakterhez = function(nev) {
    document.getElementById('kereso-mezo').value = '';
    szurok.search = '';
    document.getElementById('kereso-torles-gomb').classList.add('rejtett');

    document.getElementById('grid-mod-gomb').click();
    szuresEsMegjelenites();

    setTimeout(() => {
        const kartyak = document.querySelectorAll('#karakter-grid .karakter-kartya');
        for (let kartya of kartyak) {
            const h2 = kartya.querySelector('h2');

            if (h2 && h2.textContent.trim().toLowerCase() === nev.toLowerCase()) {
                kartya.scrollIntoView({ behavior: 'smooth', block: 'center' });

                kartya.style.transition = 'box-shadow 0.3s ease, transform 0.3s ease';
                kartya.style.transform = 'scale(1.03)';
                kartya.style.boxShadow = '0 0 40px #fbc02d';

                setTimeout(() => {
                    kartya.style.boxShadow = 'none';
                    kartya.style.transform = 'scale(1)';
                }, 2000);

                break;
            }
        }
    }, 100);
};

function frissitCtpEredmenyek() {
    const aktivGomb = document.querySelector('.ctp-kategoria-kartya.aktiv');
    if (!aktivGomb) return;
    const ctpNev = aktivGomb.dataset.ctp.toUpperCase();

    const eredmenyKontener = document.getElementById('ctp-kereso-eredmenyek');
    eredmenyKontener.innerHTML = '';

    const csakSajat = document.getElementById('sajat-raktar-toggle').checked;

    let talalatok = nyersKarakterAdatok.filter(c => {
        if (!c.meta_ctp) return false;
        const m = c.meta_ctp.toUpperCase();
        if (ctpNev === 'JUDGEMENT' || ctpNev === 'JUDGMENT') {
            return m.includes('JUDGEMENT') || m.includes('JUDGMENT');
        }
        return m.includes(ctpNev);
    });

    if (csakSajat) {
        talalatok = talalatok.filter(c => sajatRaktar.includes(c.character));
    }

    if (talalatok.length === 0) {
        eredmenyKontener.innerHTML = `<p class="placeholder-text" style="grid-column: 1 / -1; font-size: 16px;">Nincs találat a jelenlegi beállításokkal a <strong style="color:var(--mff-t4);">${ctpNev}</strong> CTP-re.</p>`;
        return;
    }

    talalatok.sort((a, b) => (b.tier === 'T4' ? 1 : 0) - (a.tier === 'T4' ? 1 : 0));

    talalatok.forEach(c => {
        eredmenyKontener.appendChild(letrehozKarakterKartya(c));
    });
}

document.querySelectorAll('.ctp-kategoria-kartya').forEach(kartya => {
    kartya.addEventListener('click', (e) => {
        document.querySelectorAll('.ctp-kategoria-kartya').forEach(k => k.classList.remove('aktiv'));
        e.currentTarget.classList.add('aktiv');
        frissitCtpEredmenyek();
    });
});

document.getElementById('sajat-raktar-toggle').addEventListener('change', () => {
    if(jelenlegiNezet === 'grid-mod-gomb') {
        szuresEsMegjelenites();
    } else if(jelenlegiNezet === 'abx-mod-gomb') {
        if(document.getElementById('abx-section').classList.contains('aktiv')) document.getElementById('abx-kereso-btn').click();
        if(document.getElementById('abl-section').classList.contains('aktiv')) document.getElementById('abl-kereso-btn').click();
    } else if(jelenlegiNezet === 'ctp-mod-gomb') {
        frissitCtpEredmenyek();
    }
});

function initPvPMatchupEngine() {
    const pvpListKontener = document.getElementById('pvp-character-list');
    pvpListKontener.innerHTML = '';
    const pvpHosei = nyersKarakterAdatok.filter(c => c.matchup_engine && c.usage && c.usage.toLowerCase().includes('pvp'));
    if(pvpHosei.length === 0) { pvpListKontener.innerHTML = '<p class="placeholder-text">Nincs PvP karakter regisztrálva a JSON-ben.</p>'; return; }
    pvpHosei.forEach(c => {
        const elem = document.createElement('div');
        elem.className = 'matchup-item-card';
        const sorszín = szinek[c.type] || '#fff';

        const kepKep = `<img src="images/portraits/${c.image_url}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; border: 1px solid ${sorszín};">`;

        elem.innerHTML = `<div style="display:flex; align-items:center; gap:12px;">${kepKep}<span>${c.character}</span></div><span style="width:10px; height:10px; background:${sorszín}; border-radius:50%;"></span>`;
        elem.addEventListener('click', () => {
            document.querySelectorAll('.matchup-item-card').forEach(i => i.classList.remove('active'));
            elem.classList.add('active');
            megjelenitMatchupRészleteket(c);
        });
        pvpListKontener.appendChild(elem);
    });
}

function megjelenitMatchupRészleteket(karakter) {
    const strongList = document.getElementById('pvp-strong-list');
    const weakList = document.getElementById('pvp-weak-list');
    const supports = karakter.recommended_teams?.supports || [];
    const supportArray = Array.isArray(supports) ? supports : supports.split(',');
    const supportChips = supportArray.filter(s => s && s.trim() !== '' && s !== 'N/A' && !s.toLowerCase().includes('saját maga') && s !== '""').map(s => `<span class="support-chip">${s.trim()}</span>`).join('');
    const taktikaHtml = karakter.matchup_engine?.counter_strategy ? `<div class="taktika-bubble"><strong style="color: #fff; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Elemzés & Taktika:</strong><br><div style="margin-top: 5px; margin-bottom: 10px;">${karakter.matchup_engine.counter_strategy}</div>${supportChips ? `<strong style="color: var(--mff-blast); font-size: 10px; text-transform: uppercase;">Ajánlott Supportok:</strong><br>${supportChips}` : ''}</div>` : '';

    let strongHtml = taktikaHtml;
    if (karakter.matchup_engine?.strong_against && karakter.matchup_engine.strong_against.length > 0 && karakter.matchup_engine.strong_against[0] !== "N/A" && karakter.matchup_engine.strong_against[0] !== "") {
        strongHtml += karakter.matchup_engine.strong_against.map(nev => {
            const kepUrl = getKarakterKep(nev);
            const kepHtml = `<img src="images/portraits/${kepUrl}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border: 1px solid var(--mff-speed);">`;
            return `<div class="matchup-item-card" style="border-left: 4px solid var(--mff-speed); cursor:default; justify-content:flex-start; gap:12px;">${kepHtml}<span>${nev}</span></div>`;
        }).join('');
    } else { strongHtml += '<p class="placeholder-text">Nincs regisztrált előnyös matchup.</p>'; }
    strongList.innerHTML = strongHtml;

    if (karakter.matchup_engine?.weak_against && karakter.matchup_engine.weak_against.length > 0 && karakter.matchup_engine.weak_against[0] !== "N/A" && karakter.matchup_engine.weak_against[0] !== "") {
        weakList.innerHTML = karakter.matchup_engine.weak_against.map(nev => {
            const kepUrl = getKarakterKep(nev);
            const kepHtml = `<img src="images/portraits/${kepUrl}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border: 1px solid var(--mff-t4);">`;
            return `<div class="matchup-item-card hard-counter" style="cursor:default; justify-content:flex-start; gap:12px;">${kepHtml}<span>${nev} <span style="font-size:10px; color:var(--mff-t4); margin-left:6px; font-weight:900;">[ KRITIKUS KONTRA ]</span></span></div>`;
        }).join('');
    } else { weakList.innerHTML = '<p class="placeholder-text">Nincs regisztrált kemény kontra.</p>'; }
}

function renderTierList() {
    const container = document.getElementById('tier-list-view');
    container.innerHTML = '';
    const szintek = ['SS', 'S', 'A', 'B', 'UNRANKED'];
    const tierMap = { 'SS': [], 'S': [], 'A': [], 'B': [], 'UNRANKED': [] };
    nyersKarakterAdatok.forEach(c => {
        const tier = c.meta_tier && szintek.includes(c.meta_tier.toUpperCase()) ? c.meta_tier.toUpperCase() : 'UNRANKED';
        tierMap[tier].push(c);
    });
    szintek.forEach(szint => {
        if(tierMap[szint].length === 0) return;
        const row = document.createElement('div');
        row.className = 'tier-row';
        const cssClass = szint === 'UNRANKED' ? 'tier-unranked' : `tier-${szint.toLowerCase()}`;
        const labelText = szint === 'UNRANKED' ? '???' : szint;
        let charHtml = tierMap[szint].map(c => {
            const borderSzín = szinek[c.type] || '#555e70';
            const safeName = (c.character || '').replace(/'/g, "\\'");
            const kep = `<img src="images/portraits/${c.image_url}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" style="border-color:${borderSzín};">`;
            return `<div class="tier-mini-card" onclick="window.ugrasKarakterhez('${safeName}')">${kep}<span>${c.character}</span></div>`;
        }).join('');
        row.innerHTML = `<div class="tier-label ${cssClass}">${labelText}</div><div class="tier-content">${charHtml}</div>`;
        container.appendChild(row);
    });
}

document.getElementById('tab-btn-abx').addEventListener('click', function() {
    this.classList.add('aktiv'); document.getElementById('tab-btn-abl').classList.remove('aktiv');
    document.getElementById('abx-section').classList.add('aktiv'); document.getElementById('abl-section').classList.remove('aktiv');
});
document.getElementById('tab-btn-abl').addEventListener('click', function() {
    this.classList.add('aktiv'); document.getElementById('tab-btn-abx').classList.remove('aktiv');
    document.getElementById('abl-section').classList.add('aktiv'); document.getElementById('abx-section').classList.remove('aktiv');
});

function runAbSearch(selectId, resultsId, cancelMode) {
    const eredmenyKontener = document.getElementById(resultsId);
    const dpsCol = eredmenyKontener.querySelector('.dps .col-content');
    const leaderCol = eredmenyKontener.querySelector('.leader .col-content');
    const supportCol = eredmenyKontener.querySelector('.support .col-content');

    dpsCol.innerHTML = ''; leaderCol.innerHTML = ''; supportCol.innerHTML = '';

    const condition = document.getElementById(selectId).value;
    if(condition === 'none') {
        dpsCol.innerHTML = '<p class="placeholder-text">Válassz feltételt!</p>';
        leaderCol.innerHTML = '<p class="placeholder-text">Válassz feltételt!</p>';
        supportCol.innerHTML = '<p class="placeholder-text">Válassz feltételt!</p>';
        return;
    }

    const csakSajat = document.getElementById('sajat-raktar-toggle').checked;

    let talalatok = nyersKarakterAdatok.filter(c => {
        if(!c.usage || !c.usage.toLowerCase().includes('pve')) return false;
        if(csakSajat && !sajatRaktar.includes(c.character)) return false;

        const type = (c.type || '').toLowerCase();
        const align = (c.alignment || '').toLowerCase();
        const species = (c.species || '').toLowerCase();
        const tags = (c.mechanics_tags || []).map(t => t.toLowerCase());

        switch(condition) {
            case 'any': return true;
            case 'alien': return species === 'alien';
            case 'mutant': return species === 'mutant';
            case 'combat_hero': return type === 'combat' && align.includes('hero');
            case 'combat_villain': return type === 'combat' && align.includes('villain');
            case 'combat_female': return type === 'combat' && tags.includes('female');
            case 'combat_mutant': return type === 'combat' && species === 'mutant';
            case 'blast_hero': return type === 'blast' && align.includes('hero');
            case 'blast_villain': return type === 'blast' && align.includes('villain');
            case 'blast_male': return type === 'blast' && tags.includes('male');
            case 'blast_female': return type === 'blast' && tags.includes('female');
            case 'speed_hero': return type === 'speed' && align.includes('hero');
            case 'speed_villain': return type === 'speed' && align.includes('villain');
            case 'speed_female': return type === 'speed' && tags.includes('female');
            case 'universal_hero': return type === 'universal' && align.includes('hero');
            case 'universal_villain': return type === 'universal' && align.includes('villain');
            case 'universal_male': return type === 'universal' && tags.includes('male');
            case 'universal_female': return type === 'universal' && tags.includes('female');
            default: return false;
        }
    });

    if(talalatok.length === 0) {
        const noResultHtml = '<p class="placeholder-text">Nincs meta opció (vagy nincs a saját raktáradban)</p>';
        dpsCol.innerHTML = noResultHtml; leaderCol.innerHTML = noResultHtml; supportCol.innerHTML = noResultHtml;
        return;
    }

    talalatok.sort((a, b) => (b.tier === 'T4' ? 1 : 0) - (a.tier === 'T4' ? 1 : 0));

    talalatok.forEach(c => {
        const rawRole = (c.role || '').toLowerCase();
        const tagsLower = (c.mechanics_tags || []).map(t => String(t).toLowerCase());
        const isDps = rawRole.includes('dps') || (!rawRole.includes('leader') && !rawRole.includes('support'));
        const isLeader = rawRole.includes('leader') || tagsLower.includes('leadership') || tagsLower.includes('leader');
        const isSupport = rawRole.includes('support') || tagsLower.includes('support');

        let cancelsArr = [];
        if (cancelMode === 'ABX' && c.abx_cancels && c.abx_cancels.length > 0) {
            cancelsArr = c.abx_cancels.map(x => `<span class="cancel-item" style="padding: 2px 6px; font-size: 10px; margin: 2px;">${getCancelIcon(x)} ${formatSkillName(x)}</span>`);
        } else if (cancelMode === 'ABL' && c.abl_cancels && c.abl_cancels.length > 0) {
            cancelsArr = c.abl_cancels.map(x => `<span class="cancel-item" style="padding: 2px 6px; font-size: 10px; border-color: #4da6ff; color: #4da6ff; background: rgba(77, 166, 255, 0.1); margin: 2px;">${getCancelIcon(x)} ${formatSkillName(x)}</span>`);
        }
        let cancelsHtml = cancelsArr.length > 0 ? cancelsArr.join('') : '<span style="color:#666; font-size:10px; font-style:italic;">Nincs megszakító</span>';

        const cardHtml = `
            <div class="ab-mini-card">
                <div style="display:flex; align-items:center; gap:10px; border-bottom:1px solid #2a3441; padding-bottom:8px; margin-bottom:8px;">
                    <img src="images/portraits/${c.image_url}" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.png');}else{this.onerror=null;this.src='images/portraits/placeholder.webp';}" style="width:40px; height:40px; border-radius:50%; border:1px solid #555e70; object-fit: cover;">
                    <div>
                        <strong style="color:#fff; font-size:13px; text-transform:uppercase;">${c.character}</strong>
                        <div style="font-size:10px; color:var(--mff-gold); font-weight:bold;">${c.tier || 'T4'}</div>
                    </div>
                </div>
                <div style="font-size: 10px; color: #8892b0; margin-bottom:4px; font-weight:bold;">Megszakítók:</div>
                <div style="display:flex; flex-wrap:wrap; gap:2px; margin-bottom: 8px;">${cancelsHtml}</div>
            </div>
        `;

        if (isDps) dpsCol.innerHTML += cardHtml;
        if (isLeader) leaderCol.innerHTML += cardHtml;
        if (isSupport) supportCol.innerHTML += cardHtml;
    });

    if(dpsCol.innerHTML === '') dpsCol.innerHTML = '<p class="placeholder-text">Nincs opció a raktárban</p>';
    if(leaderCol.innerHTML === '') leaderCol.innerHTML = '<p class="placeholder-text">Nincs opció a raktárban</p>';
    if(supportCol.innerHTML === '') supportCol.innerHTML = '<p class="placeholder-text">Nincs opció a raktárban</p>';
}

document.getElementById('abx-kereso-btn').addEventListener('click', () => { runAbSearch('abx-napi-select', 'abx-eredmenyek', 'ABX'); });
document.getElementById('abl-kereso-btn').addEventListener('click', () => { runAbSearch('abl-napi-select', 'abl-eredmenyek', 'ABL'); });