-- ============================================================
-- BCA Trade Code Ontology — pmu.sg Proprietary IP v1.0
-- 47 codes across 6 categories: Civil, Architectural, M&E,
-- External Works, Specialist
--
-- Columns:
--   bca_code          — official BCA code (e.g. C1.5)
--   category          — top-level grouping
--   sub_category      — trade family
--   description       — official BCA description
--   singlish_aliases  — site voice/text aliases (SG English + Singlish)
--   malay_aliases     — Hokkien / Malay site terms
--   ambiguity_note    — known classification conflicts
--   resolution_logic  — how to resolve ambiguity
--   productivity_unit — ePSS unit: m2 | m3 | nr | lg | tonne
--   moat_score        — classification difficulty 1–5 (5 = highest moat)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bca_trade_codes (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    bca_code            TEXT    NOT NULL UNIQUE,
    category            TEXT    NOT NULL,
    sub_category        TEXT    NOT NULL,
    description         TEXT    NOT NULL,
    singlish_aliases    TEXT[]  NOT NULL DEFAULT '{}',
    malay_aliases       TEXT[]  NOT NULL DEFAULT '{}',
    ambiguity_note      TEXT,
    resolution_logic    TEXT,
    epss_field          TEXT    NOT NULL DEFAULT 'tradeCode',
    productivity_unit   TEXT    NOT NULL,
    CONSTRAINT chk_productivity_unit CHECK (productivity_unit IN ('m2','m3','nr','lg','tonne')),
    moat_score          SMALLINT NOT NULL DEFAULT 3,
    CONSTRAINT chk_moat_score CHECK (moat_score BETWEEN 1 AND 5),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_codes_category ON public.bca_trade_codes(category);
CREATE INDEX IF NOT EXISTS idx_trade_codes_active   ON public.bca_trade_codes(is_active);


-- ── Seed: 47 BCA trade codes ──────────────────────────────────────────────────

INSERT INTO public.bca_trade_codes
    (bca_code, category, sub_category, description, singlish_aliases, malay_aliases, ambiguity_note, resolution_logic, productivity_unit, moat_score)
VALUES

-- ── Civil & Structural ────────────────────────────────────────────────────────
('C1.1','Civil & Structural','Piling','Driven/Bored Piling Works',
 ARRAY['piling work','pile driving','bore pile'],
 ARRAY['korek tanah','bor'],
 'Could be C1.2 if micro-pile',
 'If ''micro'' keyword → C1.2',
 'nr', 5),

('C1.2','Civil & Structural','Piling','Micro-Piling / Caisson Works',
 ARRAY['micro pile','caisson','small pile'],
 ARRAY['cerucuk kecil'],
 'May be confused with C1.1',
 'Keyword ''micro'' or diameter <300mm → C1.2',
 'nr', 4),

('C1.3','Civil & Structural','Earthworks','Excavation & Earthworks',
 ARRAY['excavation','dig','earth cut','cut and fill'],
 ARRAY['gali','korek'],
 'Overlaps with C1.4 for shoring',
 'If ''retaining wall'' → C1.4',
 'm3', 4),

('C1.4','Civil & Structural','Earthworks','Shoring & Earth Retaining Structures',
 ARRAY['shoring','sheet pile','retaining wall','soldier pile'],
 ARRAY['dinding penahan'],
 'C1.3 vs C1.4 most common confusion',
 'Keyword ''retain'' or ''shore'' → C1.4',
 'm2', 5),

('C1.5','Civil & Structural','Concrete','Structural Concrete Works',
 ARRAY['pour concrete','casting','RC work','slab pour'],
 ARRAY['tuang konkrit','besi'],
 'C1.5 vs C1.6 (precast)',
 'If ''precast'' or ''PC'' → C1.6',
 'm3', 5),

('C1.6','Civil & Structural','Concrete','Precast Concrete Works',
 ARRAY['precast','PC panel','prefab concrete'],
 ARRAY['panel pra-tuang'],
 'Lift & install vs manufacture',
 'If on-site install only → note in remarks',
 'nr', 3),

('C1.7','Civil & Structural','Steelwork','Structural Steelwork',
 ARRAY['steel structure','H-beam','steel frame','erect steel'],
 ARRAY['besi keluli','pasang besi'],
 'C1.7 vs C1.8 (rebar)',
 '''Structural steel'' = C1.7; ''rebar/BRC'' = C1.8',
 'tonne', 4),

('C1.8','Civil & Structural','Steelwork','Reinforcement Bar & BRC Works',
 ARRAY['rebar','BRC','tie wire','bar bending','cut and bend'],
 ARRAY['besi tetulang','ikat besi'],
 'Often said alongside C1.5',
 'Log separately per BCA requirement',
 'tonne', 5),

('C1.9','Civil & Structural','Formwork','Formwork & Falsework',
 ARRAY['formwork','shuttering','falsework','prop','form'],
 ARRAY['acuan','sokong'],
 'Temp works vs perm → same code',
 'Duration in remarks field',
 'm2', 4),

-- ── Architectural ─────────────────────────────────────────────────────────────
('A2.1','Architectural','Masonry','Brickwork & Blockwork',
 ARRAY['brickwork','lay brick','block wall','blockwork'],
 ARRAY['pasang bata','dinding bata'],
 'None — very clear in site speak',
 'Direct map',
 'm2', 5),

('A2.2','Architectural','Masonry','Stonework & Cladding',
 ARRAY['stone cladding','granite','natural stone'],
 ARRAY['batu alam','granit'],
 'A2.2 vs A3.2 (tile cladding)',
 '''Natural stone'' → A2.2; ''tile'' → A3.2',
 'm2', 3),

('A2.3','Architectural','Plaster & Render','Internal Plastering Works',
 ARRAY['plaster','skim coat','render','hack and plaster'],
 ARRAY['lepa','simen lepa'],
 'Internal vs external → same code',
 'Note location in remarks',
 'm2', 4),

('A2.4','Architectural','Plaster & Render','External Render & Texture Coat',
 ARRAY['external plaster','texture coat','spray texture'],
 ARRAY['lepa luar','sembur tekstur'],
 'A2.3 vs A2.4',
 '''External'' or ''facade'' keyword → A2.4',
 'm2', 4),

('A3.1','Architectural','Floor Finishes','Floor Tiling Works',
 ARRAY['floor tile','lay tile','homogeneous tile','ceramic floor'],
 ARRAY['pasang jubin lantai','jubin'],
 'Floor vs wall tile → key distinction',
 '''Floor'' or ''ground'' → A3.1',
 'm2', 5),

('A3.2','Architectural','Wall Finishes','Wall Tiling Works',
 ARRAY['wall tile','toilet tile','tiling wall','mosaic'],
 ARRAY['jubin dinding','mozek'],
 'A3.1 vs A3.2 — most common error',
 '''Wall'' or ''toilet/bathroom'' → A3.2',
 'm2', 5),

('A3.3','Architectural','Floor Finishes','Marble & Granite Flooring',
 ARRAY['marble','granite floor','polished stone floor'],
 ARRAY['lantai marmar','granit lantai'],
 'A3.1 vs A3.3',
 '''Marble'' or ''granite'' keyword → A3.3',
 'm2', 3),

('A3.4','Architectural','Floor Finishes','Timber / Parquet / Vinyl Flooring',
 ARRAY['parquet','vinyl','timber floor','laminate','wood floor'],
 ARRAY['lantai kayu','vinil'],
 'A3.4 vs A3.5 (raised floor)',
 '''Raised'' or ''access floor'' → A3.5',
 'm2', 4),

('A3.5','Architectural','Floor Finishes','Raised Access Flooring',
 ARRAY['raised floor','access floor','OA floor','data centre floor'],
 ARRAY['lantai angkat'],
 'Niche — rarely confused',
 'Direct map on keyword ''raised''',
 'm2', 3),

('A4.1','Architectural','Ceiling','Suspended Ceiling Works',
 ARRAY['false ceiling','gypsum ceiling','T-bar ceiling','grid ceiling'],
 ARRAY['siling palsu','siling gantung'],
 'None — clear in site speak',
 'Direct map',
 'm2', 4),

('A4.2','Architectural','Ceiling','Plasterboard / GRC Ceiling',
 ARRAY['plasterboard ceiling','GRC ceiling','cornice'],
 ARRAY['siling papan gipsum'],
 'A4.1 vs A4.2',
 '''Plasterboard'' or ''GRC'' → A4.2',
 'm2', 3),

('A5.1','Architectural','Doors & Windows','Aluminium Doors & Windows',
 ARRAY['alu window','aluminium door','sliding door','grille'],
 ARRAY['tingkap aluminium','pintu gelangsar'],
 'A5.1 vs A5.2 (steel)',
 '''Alu'' or ''aluminium'' → A5.1',
 'nr', 4),

('A5.2','Architectural','Doors & Windows','Steel Doors & Windows / Grille',
 ARRAY['steel door','security door','fire door','grille door'],
 ARRAY['pintu besi','grille'],
 'A5.1 vs A5.2',
 '''Steel'', ''security'', or ''fire door'' → A5.2',
 'nr', 3),

('A5.3','Architectural','Doors & Windows','Timber Doors & Joinery',
 ARRAY['timber door','solid door','flush door','joinery'],
 ARRAY['pintu kayu','pintu pepejal'],
 'None — clear',
 'Direct map on ''timber'' or ''wood door''',
 'nr', 4),

('A6.1','Architectural','Waterproofing','Internal Waterproofing',
 ARRAY['waterproof toilet','tank waterproof','wet area WP'],
 ARRAY['kalis air dalaman'],
 'A6.1 vs A6.2 (roof/ext)',
 '''Toilet'' or ''tank'' → A6.1',
 'm2', 5),

('A6.2','Architectural','Waterproofing','External / Roof Waterproofing',
 ARRAY['roof WP','external waterproof','balcony WP','basement WP'],
 ARRAY['kalis air bumbung'],
 'A6.1 vs A6.2',
 '''Roof'', ''balcony'', or ''basement'' → A6.2',
 'm2', 5),

('A7.1','Architectural','Painting','Internal Painting Works',
 ARRAY['paint','emulsion','roller paint','touch up'],
 ARRAY['cat dalaman','warna dinding'],
 'A7.1 vs A7.2 (ext)',
 '''Internal'' or ''inside'' → A7.1',
 'm2', 4),

('A7.2','Architectural','Painting','External Painting / Coating',
 ARRAY['external paint','facade paint','anti-carbonation coat'],
 ARRAY['cat luaran','cat fasad'],
 'A7.1 vs A7.2',
 '''External'', ''facade'', ''outside'' → A7.2',
 'm2', 4),

-- ── M&E ───────────────────────────────────────────────────────────────────────
('M8.1','M&E','Electrical','HV/LV Electrical Installation',
 ARRAY['electrical','cable tray','conduit','DB','switchboard','wiring'],
 ARRAY['elektrik','kabel','wayar'],
 'HV vs LV → same code, note voltage',
 'Log voltage in remarks',
 'lg', 5),

('M8.2','M&E','Electrical','Fire Alarm & Emergency Systems',
 ARRAY['fire alarm','FA','smoke detector','emergency light','PA system'],
 ARRAY['penggera kebakaran'],
 'M8.2 vs M8.3 (FP)',
 '''Alarm'' or ''detector'' → M8.2; ''sprinkler'' → M8.3',
 'nr', 4),

('M8.3','M&E','Fire Protection','Sprinkler & Fire Protection Works',
 ARRAY['sprinkler','fire pipe','hose reel','FM200'],
 ARRAY['paip bomba','sprinkler'],
 'M8.2 vs M8.3',
 '''Sprinkler'' or ''hose reel'' → M8.3',
 'nr', 5),

('M9.1','M&E','Plumbing','Plumbing & Sanitary Works',
 ARRAY['plumbing','pipe','sanitary','toilet fit-out','P-trap'],
 ARRAY['paip air','tandas'],
 'M9.1 vs M9.2 (ACMV)',
 '''Plumbing'' or ''sanitary'' → M9.1',
 'lg', 5),

('M9.2','M&E','ACMV','Air-Conditioning & Mechanical Ventilation',
 ARRAY['aircon','AHU','FCU','ducting','ACMV','chiller','cooling'],
 ARRAY['penghawa dingin','aircon'],
 'M9.2 vs M9.3 (lifts)',
 '''Aircon'', ''AHU'', or ''ducting'' → M9.2',
 'nr', 5),

('M9.3','M&E','Lifts & Escalators','Lift & Escalator Installation',
 ARRAY['lift','elevator','escalator','car lift','dumbwaiter'],
 ARRAY['lif','eskalator'],
 'None — very clear',
 'Direct map on keyword',
 'nr', 3),

('M9.4','M&E','IBMS','Integrated Building Mgmt System',
 ARRAY['BMS','IBMS','building automation','BAS','SCADA'],
 ARRAY['sistem bangunan','BMS'],
 'M9.4 vs M8.1 (pure electrical)',
 '''BMS'' or ''automation'' → M9.4',
 'nr', 3),

('M9.5','M&E','ELV','Extra Low Voltage Systems',
 ARRAY['ELV','CCTV','access control','intercom','AV system'],
 ARRAY['CCTV','kawalan akses'],
 'M9.5 vs M8.2',
 '''CCTV'', ''access'', ''intercom'' → M9.5',
 'nr', 4),

-- ── External Works ────────────────────────────────────────────────────────────
('E10.1','External Works','Landscaping','Landscape & Softscape Works',
 ARRAY['landscape','planting','grass','turf','softscape'],
 ARRAY['landskap','rumput'],
 'E10.1 vs E10.2 (hardscape)',
 '''Plant'' or ''grass'' → E10.1',
 'm2', 3),

('E10.2','External Works','Landscaping','Hardscape & External Paving',
 ARRAY['paving','hardscape','footpath','kerb','drain','cobblestone'],
 ARRAY['turapan','laluan kaki'],
 'E10.2 vs C1.3',
 '''Paving'' or ''footpath'' → E10.2',
 'm2', 3),

('E10.3','External Works','Fencing','Fencing & Hoarding Works',
 ARRAY['fencing','hoarding','site hoarding','chain link','palisade'],
 ARRAY['pagar','sekatan tapak'],
 'None — clear',
 'Direct map',
 'lg', 3),

('E10.4','External Works','Road','Road & Carriageway Works',
 ARRAY['road work','asphalt','tarmac','carriageway','kerb'],
 ARRAY['jalan','turapan jalan'],
 'E10.4 vs E10.2',
 '''Road'' or ''asphalt'' → E10.4',
 'm2', 3),

-- ── Specialist ────────────────────────────────────────────────────────────────
('S11.1','Specialist','Facade','Curtain Wall & Facade Works',
 ARRAY['curtain wall','facade','unitised panel','cladding'],
 ARRAY['dinding tirai','fasad'],
 'A2.2 vs S11.1',
 '''Curtain wall'' or ''unitised'' → S11.1',
 'm2', 4),

('S11.2','Specialist','Facade','Glass & Glazing Works',
 ARRAY['glazing','glass','IGU','tempered glass','frameless glass'],
 ARRAY['cermin','kaca'],
 'S11.1 vs S11.2',
 '''Glazing'' without curtain wall → S11.2',
 'm2', 3),

('S12.1','Specialist','Demolition','Demolition & Hacking Works',
 ARRAY['demolish','hack','break down','remove slab','strip out'],
 ARRAY['roboh','gali bongkar'],
 'Hacking (partial) vs full demo',
 '''Full demo'' → note in remarks',
 'm2', 4),

('S12.2','Specialist','Temporary Works','Scaffolding & Temporary Works',
 ARRAY['scaffold','bamboo scaffold','system scaffold','erect scaffold'],
 ARRAY['perancah','skafold'],
 'S12.2 vs C1.9 (formwork)',
 '''Scaffold'' → S12.2; ''formwork'' → C1.9',
 'm2', 5),

('S13.1','Specialist','Roofing','Roof & Skylight Works',
 ARRAY['roofing','metal deck','skylight','roof sheet','clip-lock roof'],
 ARRAY['bumbung','atap'],
 'A6.2 (WP) vs S13.1 (structure)',
 'Structural roof → S13.1; WP layer → A6.2',
 'm2', 4),

('S13.2','Specialist','Swimming Pool','Swimming Pool & Water Feature',
 ARRAY['pool','swimming pool','jacuzzi','water feature','pond'],
 ARRAY['kolam renang','kolam air'],
 'None — very specific',
 'Direct map',
 'nr', 3),

('S14.1','Specialist','IBS','Industrialised Building System (IBS)',
 ARRAY['IBS','precast system','modular','PPVC','PBU'],
 ARRAY['IBS','modular','pra-bina'],
 'C1.6 vs S14.1',
 '''PPVC'' or ''PBU'' → S14.1; generic precast → C1.6',
 'nr', 5),

('S14.2','Specialist','DfMA','Design for Manufacture & Assembly',
 ARRAY['DfMA','prefab','offsite','MiC','volumetric'],
 ARRAY['DfMA','prafabrikasi'],
 'S14.1 vs S14.2',
 '''MiC'' or ''volumetric'' → S14.2',
 'nr', 5)

ON CONFLICT (bca_code) DO UPDATE SET
    description       = EXCLUDED.description,
    singlish_aliases  = EXCLUDED.singlish_aliases,
    malay_aliases     = EXCLUDED.malay_aliases,
    ambiguity_note    = EXCLUDED.ambiguity_note,
    resolution_logic  = EXCLUDED.resolution_logic,
    productivity_unit = EXCLUDED.productivity_unit,
    moat_score        = EXCLUDED.moat_score;
