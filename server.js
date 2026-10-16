const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000,
    pingTimeout: 60000,
    maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3000;
const DB_URL = "https://game-worboat-default-rtdb.europe-west1.firebasedatabase.app";
const MAX_PLAYERS_4V = 4;
const RESPAWN_MS = 2000;
const TICK_MS = 100;

const OFFLINE_DEATH_MS = 120000;
const OFFLINE_GRACE_SECONDS = 120;

const MAX_BOTS_ON_FIELD = 100;
const BOT_SPAWN_MIN_DIST = 3500;
const BOT_SPAWN_MAX_DIST = 6000;
// ⭐ جديد: الحد الأدنى لبعد البوت عن اللاعب عند الظهور من الأطراف
const BOT_EDGE_MIN_DIST_FROM_PLAYER = 3000;

const FPS_RATIO = 6.0;
const BOT_MAX_SPEED = 25.0;
const CHASER_SPEED_RATIO = 0.9;
const MAX_CHASERS = 8;
const BOT_LEASH_DIST = 9000;
const BOT_FREE_ROAM_RADIUS = 7000;

const TORPEDO_MIN_SPEED = 25.0;
const TORPEDO_MAX_SPEED = 52.0;

const PLAYER_SAFE_FRONT_ANGLE = 90;
const SURPRISE_SPAWN_MIN = 4000;
const SURPRISE_SPAWN_MAX = 6000;

const HIT_BOT_MIN_INTERVAL_MS = 40;

const MAX_PLAYER_COORD = 1000000;
const MAX_DAMAGE_PER_HIT = 999999;

const BOMB_BASE_TIME     = 23;
const BOMB_WAVE_BONUS    = 100;
const BOMB_MAX_TIME      = 15;
const BOMB_DISARM_RADIUS = 450;
const BOMB_DISARM_XP     = 5;

const HEALTH_DROP_EVERY_KILLS   = 4;
const HEALTH_PACK_DURATION_MS   = 6000;
const HEALTH_PACK_PICKUP_RADIUS = 350;
const HEALTH_HEAL_PERCENT       = 0.30;

const SUPER_CHARGE_EVERY_KILLS = 10;
const SHIELD_DURATION_MS       = 7000;
const MAX_SUPER_CHARGES        = 3;

// ===== Prison System =====
const PRISON_DURATION_MS   = 30000;
const PRISON_BARRIER_RATIO = 0.55;
const PRISON_PILLAR_RADIUS = 400;
// ⭐ رفعت القيمة: العمود الآن يظهر بعيداً عن المنتصف (1500 بدل 300)
const PRISON_PILLAR_JITTER = 1500;
const PRISON_MIN_XP_MULT   = 0.1;
const PRISON_MAX_XP_MULT   = 1.0;

// ===== XP & Tier System =====
const XP_PER_LEVEL         = 100;
const BASE_XP_PER_KILL     = 3;
const NEWBIE_LEVEL_THRESHOLD = 31;
const NEWBIE_XP_MULTIPLIER   = 3.0;
const PILLAR_XP_BASE       = 10;
const OFFLINE_PILLAR_XP    = 3;
const TIER_SIZE            = 30;
const TOTAL_TIERS          = 21;
const XP_SAVE_DEBOUNCE_MS  = 2000;

const SHIPS_CONFIG = {
    'bot':               { hp:  180, speed: 13.0, damage:  10 },
    'devilahorns':       { hp:  240, speed: 13.5, damage:  20 },
    'devilsfangs':       { hp:  300, speed: 14.0, damage:  30 },
    'finish':            { hp:  400, speed: 15.0, damage:  40 },
    'proskin':           { hp:  500, speed: 17.0, damage:  50 },
    'suphigh':           { hp:  600, speed: 18.0, damage:  60 },
    'suplis':            { hp:  700, speed: 18.5, damage:  70 },
    'suplis2':           { hp:  800, speed: 19.0, damage:  80 },
    'gemini':            { hp:  900, speed: 19.5, damage:  90 },
    'war':               { hp: 1000, speed: 20.0, damage: 100 },
    'geminiprosimple':   { hp: 1100, speed: 20.5, damage: 110 },
    'deepseek':          { hp: 1200, speed: 21.0, damage: 120 },
    'geminipro':         { hp: 1300, speed: 21.5, damage: 130 },
    'legendary':         { hp: 1400, speed: 22.0, damage: 140 },
    'sovereignabyss':    { hp: 1500, speed: 22.5, damage: 150 },
    'sovereignabysspro': { hp: 1600, speed: 23.0, damage: 160 },
    'sport':             { hp: 1700, speed: 23.5, damage: 170 },
    'sportpro':          { hp: 1800, speed: 24.0, damage: 180 },
    'dumpling':          { hp: 1900, speed: 24.5, damage: 190 },
    'splittingtheseas':  { hp: 2000, speed: 25.0, damage: 200 },
    'sportmax':          { hp: 2100, speed: 25.5, damage: 210 }
};

const SHIP_LEVELS = [
    { level: 1,   id: 'bot' },
    { level: 31,  id: 'devilahorns' },
    { level: 61,  id: 'devilsfangs' },
    { level: 91,  id: 'finish' },
    { level: 121, id: 'proskin' },
    { level: 151, id: 'suphigh' },
    { level: 181, id: 'suplis' },
    { level: 211, id: 'suplis2' },
    { level: 241, id: 'gemini' },
    { level: 271, id: 'war' },
    { level: 301, id: 'geminiprosimple' },
    { level: 331, id: 'deepseek' },
    { level: 361, id: 'geminipro' },
    { level: 391, id: 'legendary' },
    { level: 421, id: 'sovereignabyss' },
    { level: 451, id: 'sovereignabysspro' },
    { level: 481, id: 'sport' },
    { level: 511, id: 'sportpro' },
    { level: 541, id: 'dumpling' },
    { level: 571, id: 'splittingtheseas' },
    { level: 601, id: 'sportmax' }
];

const FINISHERS_CONFIG = [
    { id: 'Cracking',              requiredLevel: 30 },
    { id: 'CrackingPro',           requiredLevel: 60 },
    { id: 'EclipseEmperor',        requiredLevel: 90 },
    { id: 'EclipseEmperorPro',     requiredLevel: 120 },
    { id: 'Erebus',                requiredLevel: 150 },
    { id: 'ErebusPro',             requiredLevel: 180 },
    { id: 'Sword',                 requiredLevel: 210 },
    { id: 'SwordPro',              requiredLevel: 240 },
    { id: 'TheSeventhDoor',        requiredLevel: 270 },
    { id: 'TheSeventhDoorPro',     requiredLevel: 300 },
    { id: 'TheHandOfTartarus',     requiredLevel: 330 },
    { id: 'TheHandOfTartarusPro',  requiredLevel: 360 },
    { id: 'TheThirdHour',          requiredLevel: 390 }
];

const onlineUsers = new Map();
const activeParties = new Map();
const userPartyMap = new Map();
const partyRoomMap = new Map();
const partyRoomLocks = new Map();

let rooms = {};
let nextRoomId = 1;
const wipedRoomsLog = new Set();
const activeTimeouts = new Map();

// ===== XP / Tier helpers =====

function xpToLevel(xp) {
    return Math.max(1, Math.floor((xp || 0) / XP_PER_LEVEL) + 1);
}

function levelToTier(level) {
    const lv = Math.max(1, level || 1);
    return Math.max(1, Math.min(TOTAL_TIERS, Math.floor((lv - 1) / TIER_SIZE) + 1));
}

function tierMinLevel(tier) {
    return (tier - 1) * TIER_SIZE + 1;
}

function tierToBotLevel(tier) {
    return Math.max(1, tierMinLevel(tier));
}

function getShipTier(hullId) {
    const id = (hullId || 'bot').toLowerCase();
    const idx = SHIP_LEVELS.findIndex(s => s.id === id);
    if (idx < 0) return 1;
    return idx + 1;
}

function xpPerKill(hullId, roomTier, playerLevel) {
    const shipTier = getShipTier(hullId);
    const diff = (roomTier || 1) - shipTier;
    if (diff < 0) return 0;

    let xp = BASE_XP_PER_KILL * (diff + 1);

    if (playerLevel && playerLevel < NEWBIE_LEVEL_THRESHOLD) {
        xp = Math.round(xp * NEWBIE_XP_MULTIPLIER);
    }

    return xp;
}

function shotsNeeded(shipTier, roomTier) {
    const diff = (roomTier || 1) - (shipTier || 1);
    if (diff < 0) return 1;
    return (diff + 1) * 3;
}

function bestShipForLevel(level) {
    let best = SHIP_LEVELS[0].id;
    for (const entry of SHIP_LEVELS) {
        if (level >= entry.level) best = entry.id;
    }
    return best;
}

function getNewlyUnlockedFinishers(oldLevel, newLevel) {
    const result = [];
    for (const f of FINISHERS_CONFIG) {
        if (oldLevel < f.requiredLevel && newLevel >= f.requiredLevel) {
            result.push(f.id);
        }
    }
    return result;
}

function getBestFinisherForLevel(level) {
    let best = null;
    for (const f of FINISHERS_CONFIG) {
        if (level >= f.requiredLevel) best = f.id;
    }
    return best;
}

function findFreeSlot(room) {
    const used = new Set();
    for (const uid in room.players) {
        const p = room.players[uid];
        if (p && p.slotNumber) used.add(p.slotNumber);
    }
    for (let i = 1; i <= 4; i++) if (!used.has(i)) return i;
    return 1;
}

function computeRemaining(offlineAt) {
    if (!offlineAt) return 0;
    return Math.max(0, Math.ceil((offlineAt + OFFLINE_DEATH_MS - Date.now()) / 1000));
}

function getBotStatsForWave(wave) {
    const wv = Math.max(1, wave);
    const lastLevel = SHIP_LEVELS[SHIP_LEVELS.length - 1].level;
    if (wv >= lastLevel) return SHIPS_CONFIG[SHIP_LEVELS[SHIP_LEVELS.length - 1].id];
    let shipA = SHIP_LEVELS[0], shipB = SHIP_LEVELS[1];
    for (let i = 0; i < SHIP_LEVELS.length - 1; i++) {
        if (wv >= SHIP_LEVELS[i].level && wv < SHIP_LEVELS[i + 1].level) {
            shipA = SHIP_LEVELS[i]; shipB = SHIP_LEVELS[i + 1]; break;
        }
    }
    const statsA = SHIPS_CONFIG[shipA.id];
    const statsB = SHIPS_CONFIG[shipB.id];
    const ratio = (wv - shipA.level) / (shipB.level - shipA.level);
    return {
        hp: Math.round(statsA.hp + ratio * (statsB.hp - statsA.hp)),
        speed: Math.round((statsA.speed + ratio * (statsB.speed - statsA.speed)) * 10) / 10,
        damage: Math.round(statsA.damage + ratio * (statsB.damage - statsA.damage))
    };
}

function getShipStats(hullId) {
    return SHIPS_CONFIG[(hullId || 'bot').toLowerCase()] || SHIPS_CONFIG['bot'];
}

function safeSetTimeout(roomId, fn, ms) {
    const id = setTimeout(() => {
        const set = activeTimeouts.get(roomId);
        if (set) { set.delete(id); if (set.size === 0) activeTimeouts.delete(roomId); }
        try { fn(); } catch (e) {}
    }, ms);
    if (!activeTimeouts.has(roomId)) activeTimeouts.set(roomId, new Set());
    activeTimeouts.get(roomId).add(id);
    return id;
}

function clearRoomTimeouts(roomId) {
    const set = activeTimeouts.get(roomId);
    if (!set) return;
    for (const id of set) clearTimeout(id);
    activeTimeouts.delete(roomId);
}

function rnd(a, b) { return a + Math.random() * (b - a); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

function getMapStats(level) {
    const progress = Math.min(level / 250.0, 1.0);
    const originalCount = 20 + Math.floor(100 * progress);
    const count = Math.floor(originalCount / 2);
    return { size: 10000 + (10000 * progress), count };
}

// ⭐⭐⭐ جديد: توليد الجزر بتوزيع شبكي ذكي — يمنع التلاصق ويوزع على كل الخريطة
function generateIslands(count, worldSize) {
    const islands = [];
    const MIN_MARGIN = 1450;
    const MIN_GAP = 700; // مسافة إضافية بين الجزر لمنع التلاصق

    // بناء شبكة تغطي الخريطة بأكملها
    const gridN = Math.max(3, Math.ceil(Math.sqrt(count * 1.8)));
    const usableW = worldSize - MIN_MARGIN * 2;
    const usableH = worldSize - MIN_MARGIN * 2;
    const cellW = usableW / gridN;
    const cellH = usableH / gridN;

    // اجمع كل الخلايا ثم اخلطها
    const cells = [];
    for (let gy = 0; gy < gridN; gy++) {
        for (let gx = 0; gx < gridN; gx++) {
            cells.push({ gx, gy });
        }
    }
    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
    }

    let placed = 0;
    for (const cell of cells) {
        if (placed >= count) break;

        const r = 160 + Math.random() * 220;
        const h = 140 + Math.random() * 180;

        // موقع عشوائي داخل الخلية (مع هامش جيد)
        const pad = r + 200;
        const cw = Math.max(1, cellW - pad * 2);
        const ch = Math.max(1, cellH - pad * 2);
        const baseX = MIN_MARGIN + cell.gx * cellW + pad + Math.random() * cw;
        const baseY = MIN_MARGIN + cell.gy * cellH + pad + Math.random() * ch;

        let x = baseX, y = baseY;
        x = Math.max(MIN_MARGIN, Math.min(worldSize - MIN_MARGIN, x));
        y = Math.max(MIN_MARGIN, Math.min(worldSize - MIN_MARGIN, y));

        // لا نضعها قريبة جداً من مركز الخريطة (منطقة القنبلة والسجن)
        const centerDist = Math.hypot(x - worldSize / 2, y - worldSize / 2);
        if (centerDist < 1600) continue;

        // تحقق من عدم التلاصق مع الجزر الموجودة
        let clash = false;
        for (const o of islands) {
            if (Math.hypot(x - o.x, y - o.y) < o.radius + r + MIN_GAP) { clash = true; break; }
        }
        if (clash) continue;

        islands.push({
            x, y,
            radius: r,
            height: h,
            seed: Math.floor(Math.random() * 9999)
        });
        placed++;
    }

    // إذا فشل التوزيع بالشبكة، نملأ بأماكن عشوائية آمنة
    let attempts = 0;
    while (placed < count && attempts < 4000) {
        attempts++;
        const r = 160 + Math.random() * 220;
        const h = 140 + Math.random() * 180;
        const x = MIN_MARGIN + Math.random() * (worldSize - MIN_MARGIN * 2);
        const y = MIN_MARGIN + Math.random() * (worldSize - MIN_MARGIN * 2);

        const centerDist = Math.hypot(x - worldSize / 2, y - worldSize / 2);
        if (centerDist < 1600) continue;

        let clash = false;
        for (const o of islands) {
            if (Math.hypot(x - o.x, y - o.y) < o.radius + r + MIN_GAP) { clash = true; break; }
        }
        if (clash) continue;

        islands.push({ x, y, radius: r, height: h, seed: Math.floor(Math.random() * 9999) });
        placed++;
    }

    return islands;
}

function computeRoomStats(room) {
    const botStats = getBotStatsForWave(room.botLevel || 1);
    const wv = room.wave || 1;
    return {
        avgLevel: room.botLevel || 1,
        maxSpeed: 15.0,
        normalSpeed: botStats.speed,
        chaserSpeed: Math.min(botStats.speed * 1.2, BOT_MAX_SPEED),
        predictionTime: 0.3 + Math.min(1.0, wv / 100) * 0.3,
        missChance: Math.max(0, 0.4 - wv / 200),
        torpedoSpeed: 22.0,
        botAbility: wv >= 100 ? 'shield' : (wv >= 50 ? 'barrage' : 'none'),
        fireCooldown: Math.max(1.0, 2.5 - (wv * 0.015))
    };
}

function getTorpedoSpeed(room) {
    return Math.min(22.0 + Math.floor((room.wave || 1) / 20), TORPEDO_MAX_SPEED);
}

function botHPForRoom(room) {
    return Math.max(10, 5 * (room.tier || 1));
}

function botDamageForRoom(room) {
    return Math.max(20, 40 * (room.tier || 1));
}

function getPlayerDamageCooldownMs(room) {
    const wv = room.wave || 1;
    if (wv > 400) return 250;
    if (wv > 200) return 200;
    if (wv > 100) return 150;
    return 100;
}

function assignBotRole(index, total) {
    const pusherCount  = Math.floor(total * 0.4);
    const flankerCount = Math.floor(total * 0.3);
    const sniperCount  = Math.floor(total * 0.2);
    if (index < pusherCount) return 'pusher';
    if (index < pusherCount + flankerCount) return 'flanker';
    if (index < pusherCount + flankerCount + sniperCount) return 'sniper';
    return 'blocker';
}

function botCountForWave(wave, botLevel) {
    const lvl = Math.max(1, botLevel || 1);
    if (lvl < 150) return 10;
    return Math.min(100, Math.floor(lvl / 15));
}

function computeBombSchedule(botCount) {
    let bombs, killsPerBomb;
    if (botCount <= 5)       { bombs = 1; killsPerBomb = 3; }
    else if (botCount <= 15) { bombs = 2; killsPerBomb = Math.floor(botCount / 2); }
    else if (botCount <= 35) { bombs = 2; killsPerBomb = Math.floor(botCount / 2); }
    else if (botCount <= 60) { bombs = 3; killsPerBomb = Math.floor(botCount / 3); }
    else                     { bombs = Math.min(6, Math.floor(botCount / 17)); killsPerBomb = Math.floor(botCount / bombs); }
    return { bombs, killsPerBomb };
}

function computeBombTimer(wave) {
    return Math.min(BOMB_MAX_TIME, BOMB_BASE_TIME + Math.floor(wave / BOMB_WAVE_BONUS));
}

// ⭐⭐⭐ جديد: ظهور البوتات من أطراف الخريطة (بدل حول اللاعب)
function randomSpawnAtEdge(room, minDistFromPlayers) {
    const ws = room.worldSize;
    const margin = 900;
    const players = Object.values(room.players).filter(p => p.hp > 0 && p.online && !p.isGhost);

    for (let attempt = 0; attempt < 120; attempt++) {
        // اختر حافة عشوائية
        const edge = Math.floor(Math.random() * 4);
        let x, y;
        if (edge === 0)      { x = rnd(margin, ws - margin); y = margin; }
        else if (edge === 1) { x = ws - margin; y = rnd(margin, ws - margin); }
        else if (edge === 2) { x = rnd(margin, ws - margin); y = ws - margin; }
        else                 { x = margin; y = rnd(margin, ws - margin); }

        // تأكد أنه ليس داخل جزيرة
        let onIsland = false;
        for (const isl of room.islands) {
            if (dist2(x, y, isl.x, isl.y) < (isl.radius + 250) * (isl.radius + 250)) {
                onIsland = true;
                break;
            }
        }
        if (onIsland) continue;

        // تأكد أنه بعيد بما فيه الكفاية عن اللاعبين
        let tooClose = false;
        for (const p of players) {
            if (dist2(x, y, p.x, p.y) < minDistFromPlayers * minDistFromPlayers) {
                tooClose = true;
                break;
            }
        }
        if (tooClose) continue;

        return { x, y };
    }

    // احتياط: أي نقطة على الحافة العلوية
    return { x: rnd(margin, ws - margin), y: margin };
}

// (احتفظت بها لأنها تُستخدم لظهور البوتات المفاجئة عند إلغاء القنبلة)
function randomSpawnNearSafe(cx, cy, minD, maxD, islands, worldSize, playerHeading) {
    const playerHeadingRad = (playerHeading || 0) * Math.PI / 180;
    for (let attempt = 0; attempt < 60; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const d = rnd(minD, maxD);
        let x = cx + Math.cos(a) * d;
        let y = cy + Math.sin(a) * d;
        x = Math.max(700, Math.min(worldSize - 700, x));
        y = Math.max(700, Math.min(worldSize - 700, y));
        if (playerHeading !== undefined && playerHeading !== null) {
            const dirToBot = Math.atan2(y - cy, x - cx);
            let diff = Math.abs(dirToBot - playerHeadingRad) % (Math.PI * 2);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff * 180 / Math.PI < PLAYER_SAFE_FRONT_ANGLE) continue;
        }
        let inside = false;
        if (islands && islands.length) {
            for (const isl of islands) {
                if (dist2(x, y, isl.x, isl.y) < (isl.radius + 250) * (isl.radius + 250)) { inside = true; break; }
            }
        }
        if (!inside) return { x, y };
    }
    const fallbackAngle = playerHeadingRad + Math.PI;
    const fallbackDist = rnd(minD, maxD);
    let fx = cx + Math.cos(fallbackAngle) * fallbackDist;
    let fy = cy + Math.sin(fallbackAngle) * fallbackDist;
    fx = Math.max(700, Math.min(worldSize - 700, fx));
    fy = Math.max(700, Math.min(worldSize - 700, fy));
    return { x: fx, y: fy };
}

// ⭐⭐⭐ جديد: موقع عشوائي للقنبلة (بعيد عن الجزر واللاعبين، لكن داخل المنطقة الوسطى)
function findBombSpawnPos(room) {
    const ws = room.worldSize;
    const cx = ws / 2;
    const cy = ws / 2;
    const MIN_DIST_FROM_PLAYERS = 1800;

    for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 1500 + Math.random() * (ws * 0.30);
        let x = cx + Math.cos(angle) * dist;
        let y = cy + Math.sin(angle) * dist;
        x = Math.max(900, Math.min(ws - 900, x));
        y = Math.max(900, Math.min(ws - 900, y));

        let onIsland = false;
        for (const isl of room.islands) {
            if (dist2(x, y, isl.x, isl.y) < (isl.radius + 300) * (isl.radius + 300)) { onIsland = true; break; }
        }
        if (onIsland) continue;

        let tooClose = false;
        for (const uid in room.players) {
            const p = room.players[uid];
            if (!p || p.hp <= 0) continue;
            if (dist2(x, y, p.x, p.y) < MIN_DIST_FROM_PLAYERS * MIN_DIST_FROM_PLAYERS) { tooClose = true; break; }
        }
        if (tooClose) continue;

        return { x, y };
    }

    return { x: cx + rnd(-2000, 2000), y: cy + rnd(-2000, 2000) };
}

// ⭐⭐⭐ جديد: موقع عمود السجن (داخل الحاجز، بعيد عن الجزر)
function findPillarPosition(room) {
    const ws = room.worldSize;
    const cx = ws / 2;
    const cy = ws / 2;
    const maxR = Math.max(500, room.prisonBarrierRadius * 0.65);

    for (let attempt = 0; attempt < 80; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 400 + Math.random() * (maxR - 400);
        let x = cx + Math.cos(angle) * dist;
        let y = cy + Math.sin(angle) * dist;
        x = Math.max(800, Math.min(ws - 800, x));
        y = Math.max(800, Math.min(ws - 800, y));

        let onIsland = false;
        for (const isl of room.islands) {
            if (dist2(x, y, isl.x, isl.y) < (isl.radius + 250) * (isl.radius + 250)) { onIsland = true; break; }
        }
        if (onIsland) continue;

        return { x, y };
    }

    return { x: cx, y: cy };
}

function cleanSocket(socket) {
    if (!socket) return;
    socket.currentRoom = null;
    socket.uid = null;
    socket.username = null;
    socket.mode = null;
    socket.startLevel = null;
}

function findRoomForTier(mode, tier, partyId) {
    for (const id in rooms) {
        const r = rooms[id];
        if (r.mode !== mode) continue;
        if (r.wiped) continue;
        if (r.partyId) { if (!partyId || r.partyId !== partyId) continue; }
        if (partyId && !r.partyId) continue;
        if (r.tier !== tier) continue;
        if (mode === '1VBOT' && Object.keys(r.players).length === 0) return id;
        if (mode === '4VBOT' && Object.keys(r.players).length < MAX_PLAYERS_4V) return id;
    }
    return null;
}

function createRoom(mode, tier, partyId = null) {
    const t = Math.max(1, Math.min(TOTAL_TIERS, tier || 1));
    const botLevel = tierToBotLevel(t);
    const id = `${mode === '1VBOT' ? 'solo' : 'coop'}_t${t}_${nextRoomId++}`;
    const mapStats = getMapStats(botLevel);
    const islands = generateIslands(mapStats.count, mapStats.size);
    const islData = islands.map(i => ({ x: i.x, y: i.y, r100sq: (i.radius + 150) * (i.radius + 150) }));

    // ⭐ موقع ابتدائي عشوائي للقنبلة (سيُعاد اختياره عند كل تفعيل)
    const initialBombPos = {
        x: mapStats.size / 2 + rnd(-2500, 2500),
        y: mapStats.size / 2 + rnd(-2500, 2500)
    };

    rooms[id] = {
        id, mode, tier: t, botLevel,
        worldSize: mapStats.size,
        players: {},
        wave: 1,
        bots: {},
        botIdCounter: 1,
        botTickInterval: null,
        islands, islData,
        wiped: false,
        totalBotsForWave: 0,
        botsSpawnedThisWave: 0,
        botsKilledThisWave: 0,
        partyId,
        createdAt: Date.now(),
        bombSchedule: null,
        bombKillsCount: 0,
        bombBombsTriggered: 0,
        bombActive: false,
        bombX: initialBombPos.x,
        bombY: initialBombPos.y,
        bombExpireAt: 0,
        bombTimerHandle: null,
        healthPacks: {},
        healthPackIdCounter: 1,
        roomKillCounter: 0,
        prisonPhase: false,
        prisonEndsAt: 0,
        prisonBarrierRadius: mapStats.size * PRISON_BARRIER_RATIO,
        pillarX: mapStats.size / 2,
        pillarY: mapStats.size / 2,
        xpMultiplier: 1.0
    };
    startBotTick(id);
    return id;
}

function isInsideIsland(x, y, islData) {
    for (let i = 0; i < islData.length; i++) {
        if (dist2(x, y, islData[i].x, islData[i].y) < islData[i].r100sq) return true;
    }
    return false;
}

function tryUnstuck(bot, step, islData) {
    let trappingIsland = null, minD2 = Infinity;
    for (let i = 0; i < islData.length; i++) {
        const d2 = dist2(bot.x, bot.y, islData[i].x, islData[i].y);
        if (d2 < islData[i].r100sq * 1.5 && d2 < minD2) { minD2 = d2; trappingIsland = islData[i]; }
    }
    if (trappingIsland) {
        const escapeAngle = Math.atan2(bot.y - trappingIsland.y, bot.x - trappingIsland.x);
        for (let r = 2; r <= 8; r++) {
            const tx = bot.x + Math.cos(escapeAngle) * step * r;
            const ty = bot.y + Math.sin(escapeAngle) * step * r;
            if (!isInsideIsland(tx, ty, islData)) { bot.x = tx; bot.y = ty; return true; }
        }
    }
    const dirs = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, -Math.PI / 4];
    for (const offset of dirs) {
        const tx = bot.x + Math.cos(offset) * step * 5;
        const ty = bot.y + Math.sin(offset) * step * 5;
        if (tx >= 700 && ty >= 700 && !isInsideIsland(tx, ty, islData)) { bot.x = tx; bot.y = ty; return true; }
    }
    return false;
}

function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    let offlineTimerCounter = 0;

    room.botTickInterval = setInterval(() => {
        try {
            const r = rooms[roomId];
            if (!r || r.wiped) {
                if (room.botTickInterval) { clearInterval(room.botTickInterval); room.botTickInterval = null; }
                return;
            }
            const now = Date.now();

            offlineTimerCounter++;
            if (offlineTimerCounter >= 10) {
                offlineTimerCounter = 0;
                const offlineList = [];
                for (const uid in r.players) {
                    const p = r.players[uid];
                    if (p.offlineAt && p.offlineAt > 0) {
                        const rem = computeRemaining(p.offlineAt);
                        if (rem > 0) offlineList.push({ id: p.id, uid: uid, remaining: rem });
                    }
                }
                if (offlineList.length > 0) io.to(roomId).emit('offline_timers', offlineList);

                const nowHP = Date.now();
                for (const pid in r.healthPacks) {
                    if (r.healthPacks[pid].expiresAt <= nowHP) {
                        delete r.healthPacks[pid];
                        io.to(roomId).emit('health_pack_removed', { id: parseInt(pid) });
                    }
                }
            }

            for (const uid in r.players) {
                const p = r.players[uid];
                if (!p.online) continue;
                if (!p.isGhost && (now - (p.lastMoveTime || now) > 4000)) {
                    p.isGhost = true;
                    if (!p.offlineAt) {
                        p.offlineAt = Date.now();
                        p.offlineReason = "ghost";
                        io.to(roomId).emit('player_offline', {
                            id: p.id, uid: p.uid, name: p.name, slotNumber: p.slotNumber,
                            offlineAt: p.offlineAt, remaining: OFFLINE_GRACE_SECONDS
                        });
                    }
                    if (p.deathTimer) clearTimeout(p.deathTimer);
                    p.deathTimer = setTimeout(() => {
                        const r2 = rooms[roomId];
                        if (!r2 || r2.wiped || !r2.players[uid]) return;
                        savePlayerForce(r2.players[uid]);
                        io.to(roomId).emit('player_removed', {
                            id: r2.players[uid].id, uid: r2.players[uid].uid, slotNumber: r2.players[uid].slotNumber
                        });
                        delete r2.players[uid];
                        const remaining = Object.values(r2.players);
                        if (remaining.length === 0) { endRoom(roomId); return; }
                        const allDead = remaining.every(pl => {
                            const isDead = pl.hp <= 0;
                            const offlineExpired = !pl.offlineAt || (Date.now() - pl.offlineAt) >= OFFLINE_DEATH_MS;
                            return isDead && offlineExpired && !pl.isGhost;
                        });
                        if (allDead) {
                            io.to(roomId).emit('team_wipe');
                            endRoom(roomId);
                        }
                    }, OFFLINE_DEATH_MS);
                }
            }

            const playersList = Object.values(r.players).filter(p => p.hp > 0 && p.online && !p.isGhost);
            if (playersList.length === 0) { io.to(roomId).emit('bots_update', []); return; }

            for (let i = 0; i < playersList.length; i++) {
                const p = playersList[i];
                p.vx = p.x - (p.lastX || p.x);
                p.vy = p.y - (p.lastY || p.y);
                p.lastX = p.x; p.lastY = p.y;
            }

            const islData = r.islData || [];
            const stats = computeRoomStats(r);
            const chaserSpeed = stats.chaserSpeed;
            const normalSpeed = stats.normalSpeed;
            const predictionTime = stats.predictionTime;
            const missChance = stats.missChance;
            const botAbility = stats.botAbility;
            const torpedoSpeed = stats.torpedoSpeed;
            const fireCooldown = stats.fireCooldown;
            const currentBotDamage = botDamageForRoom(r);

            for (const botId in r.bots) {
                const bot = r.bots[botId];
                if (!bot || bot.hp <= 0) continue;
                if (bot.inPrison) continue;
                let closest = null, closestD2 = Infinity;
                for (let i = 0; i < playersList.length; i++) {
                    const p = playersList[i];
                    const d2 = dist2(p.x, p.y, bot.x, bot.y);
                    if (d2 < closestD2) { closestD2 = d2; closest = p; }
                }
                if (!closest) continue;

                let dx = closest.x - bot.x;
                let dy = closest.y - bot.y;
                const len = Math.sqrt(closestD2) || 1;
                let speed = bot.isChaser ? chaserSpeed : normalSpeed;
                const step = speed * FPS_RATIO;
                let moveDx = 0, moveDy = 0;
                const role = bot.role || 'pusher';

                if (bot.isChaser) { moveDx = dx; moveDy = dy; speed = chaserSpeed; }
                else {
                    if (len > BOT_LEASH_DIST) { moveDx = dx; moveDy = dy; speed *= 1.8; }
                    else if (len > BOT_FREE_ROAM_RADIUS) { moveDx = dx; moveDy = dy; }
                    else {
                        if (role === 'pusher') { moveDx = dx; moveDy = dy; }
                        else if (role === 'flanker') {
                            const baseAngle = Math.atan2(dy, dx);
                            const flankOffset = (bot.id % 2 === 0 ? Math.PI / 3 : -Math.PI / 3);
                            if (len > 2500) { moveDx = dx; moveDy = dy; }
                            else {
                                const fa = baseAngle + flankOffset;
                                moveDx = Math.cos(fa) * len * 0.7 + dx * 0.3;
                                moveDy = Math.sin(fa) * len * 0.7 + dy * 0.3;
                            }
                        } else if (role === 'sniper') {
                            if (len > 1900) { moveDx = dx; moveDy = dy; }
                            else if (len < 1300) { moveDx = -dx; moveDy = -dy; }
                            else { const cd = (bot.id % 2 === 0) ? 1 : -1; moveDx = dy * cd + dx * 0.1; moveDy = -dx * cd + dy * 0.1; }
                        } else if (role === 'blocker') {
                            const toPlayer = Math.atan2(dy, dx);
                            const blockAngle = toPlayer + Math.PI / 2;
                            moveDx = Math.cos(blockAngle) * 0.65 + (dx / len) * 0.35;
                            moveDy = Math.sin(blockAngle) * 0.65 + (dy / len) * 0.35;
                        }
                    }
                }

                const moveLen = Math.sqrt(moveDx * moveDx + moveDy * moveDy) || 1;
                const nx = bot.x + (moveDx / moveLen) * step;
                const ny = bot.y + (moveDy / moveLen) * step;

                if (!bot.stuckCheck) {
                    bot.stuckCheck = { lastX: bot.x, lastY: bot.y, timer: 0, stuckCount: 0 };
                    bot.anchorX = closest.x; bot.anchorY = closest.y;
                }
                bot.stuckCheck.timer += TICK_MS / 1000;
                if (bot.stuckCheck.timer >= 2.0) {
                    const movedDist = Math.hypot(bot.x - bot.stuckCheck.lastX, bot.y - bot.stuckCheck.lastY);
                    if (movedDist < 60) bot.stuckCheck.stuckCount++;
                    else bot.stuckCheck.stuckCount = 0;
                    bot.stuckCheck.lastX = bot.x; bot.stuckCheck.lastY = bot.y;
                    bot.stuckCheck.timer = 0;
                }
                if (bot.stuckCheck.stuckCount >= 2) {
                    tryUnstuck(bot, step, islData);
                    bot.stuckCheck.stuckCount = 0;
                    bot.stuckCheck.lastX = bot.x; bot.stuckCheck.lastY = bot.y;
                    const targetHeading = Math.atan2(closest.x - bot.x, -(closest.y - bot.y)) * 180 / Math.PI;
                    if (bot.isChaser) {
                        let diff = targetHeading - bot.heading;
                        while (diff > 180) diff -= 360;
                        while (diff < -180) diff += 360;
                        bot.heading += diff * 0.4;
                    } else bot.heading = targetHeading;
                    continue;
                }

                let blocked = false;
                for (let i = 0; i < islData.length; i++) {
                    if (dist2(nx, ny, islData[i].x, islData[i].y) < islData[i].r100sq) { blocked = true; break; }
                }

                if (!blocked) { bot.x = nx; bot.y = ny; }
                else {
                    const perp1 = Math.atan2(moveDy, moveDx) + Math.PI / 2;
                    const tX1 = bot.x + Math.cos(perp1) * step;
                    const tY1 = bot.y + Math.sin(perp1) * step;
                    let b1 = false;
                    for (let i = 0; i < islData.length; i++) if (dist2(tX1, tY1, islData[i].x, islData[i].y) < islData[i].r100sq) { b1 = true; break; }
                    if (!b1) { bot.x = tX1; bot.y = tY1; }
                    else {
                        const perp2 = Math.atan2(moveDy, moveDx) - Math.PI / 2;
                        const tX2 = bot.x + Math.cos(perp2) * step;
                        const tY2 = bot.y + Math.sin(perp2) * step;
                        let b2 = false;
                        for (let i = 0; i < islData.length; i++) if (dist2(tX2, tY2, islData[i].x, islData[i].y) < islData[i].r100sq) { b2 = true; break; }
                        if (!b2) { bot.x = tX2; bot.y = tY2; }
                    }
                }

                if (bot.x < 700) bot.x = 700; else if (bot.x > r.worldSize - 700) bot.x = r.worldSize - 700;
                if (bot.y < 700) bot.y = 700; else if (bot.y > r.worldSize - 700) bot.y = r.worldSize - 700;

                const targetHeading = Math.atan2(dx, -dy) * 180 / Math.PI;
                if (bot.isChaser) {
                    let diff = targetHeading - bot.heading;
                    while (diff > 180) diff -= 360;
                    while (diff < -180) diff += 360;
                    bot.heading += diff * 0.4;
                } else bot.heading = targetHeading;

                bot.abilityTimer = (bot.abilityTimer || 0) + (TICK_MS / 1000);
                if (botAbility !== 'none' && bot.abilityTimer > 5.0 && closestD2 < 2500 * 2500) {
                    bot.abilityTimer = 0;
                    if (botAbility === 'barrage') {
                        const pTime = predictionTime * FPS_RATIO;
                        const tx = closest.x + (closest.vx * pTime);
                        const ty = closest.y + (closest.vy * pTime);
                        const capturedBotId = bot.id;
                        const capturedX = Math.round(bot.x);
                        const capturedY = Math.round(bot.y);
                        for (let k = 0; k < 3; k++) {
                            safeSetTimeout(roomId, () => {
                                const rr = rooms[roomId];
                                if (!rr || rr.wiped) return;
                                io.to(roomId).emit('bot_fired', {
                                    botId: capturedBotId, x: capturedX, y: capturedY,
                                    targetX: Math.round(tx + rnd(-80, 80)), targetY: Math.round(ty + rnd(-80, 80)),
                                    speed: torpedoSpeed, damage: currentBotDamage
                                });
                            }, k * 150);
                        }
                        io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'barrage' });
                    } else if (botAbility === 'shield') {
                        bot.shieldUntil = now + 2000;
                        io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'shield' });
                    }
                }

                bot.fireTimer = (bot.fireTimer || 0) + (TICK_MS / 1000);
                const fireRange = bot.isChaser ? 3000 : 2000;
                if (bot.fireTimer > fireCooldown && closestD2 < fireRange * fireRange) {
                    bot.fireTimer = 0;
                    const pTime = predictionTime * FPS_RATIO;
                    let targetX = closest.x + (closest.vx * pTime);
                    let targetY = closest.y + (closest.vy * pTime);
                    if (Math.random() < missChance) {
                        targetX += rnd(-300, 300);
                        targetY += rnd(-300, 300);
                    }
                    io.to(roomId).emit('bot_fired', {
                        botId: bot.id, x: Math.round(bot.x), y: Math.round(bot.y),
                        targetX: Math.round(targetX), targetY: Math.round(targetY),
                        speed: torpedoSpeed, damage: currentBotDamage
                    });
                }
            }

            const changedBots = [];
            for (const botId in r.bots) {
                const b = r.bots[botId];
                if (!b) continue;
                if (b.inPrison) continue;
                const roundedX = Math.round(b.x);
                const roundedY = Math.round(b.y);
                const roundedHeading = Math.round(b.heading);
                const shielded = !!(b.shieldUntil && now < b.shieldUntil);
                if (!b.lastSent || b.lastSent.x !== roundedX || b.lastSent.y !== roundedY ||
                    b.lastSent.hp !== b.hp || b.lastSent.heading !== roundedHeading ||
                    b.lastSent.shielded !== shielded) {
                    changedBots.push({
                        id: b.id, x: roundedX, y: roundedY, heading: roundedHeading,
                        hp: b.hp, role: b.role || 'pusher', isChaser: !!b.isChaser, shielded
                    });
                    b.lastSent = { x: roundedX, y: roundedY, hp: b.hp, heading: roundedHeading, shielded };
                }
            }
            if (changedBots.length > 0) io.to(roomId).emit('bots_update', changedBots);
        } catch (err) {}
    }, TICK_MS);
}

// ⭐⭐⭐ معدّلة: البوتات العادية تظهر من الأطراف، المفاجئة حول اللاعب
function spawnSingleBot(room, cx, cy, minD, maxD, hpVal, isSurprise = false, playerHeading = 0) {
    let sp;
    if (isSurprise) {
        sp = randomSpawnNearSafe(cx, cy, minD, maxD, room.islands, room.worldSize, playerHeading);
    } else {
        sp = randomSpawnAtEdge(room, BOT_EDGE_MIN_DIST_FROM_PLAYER);
    }
    const id = room.botIdCounter++;
    const spawnIndex = room.botsSpawnedThisWave;
    room.botsSpawnedThisWave++;
    room.bots[id] = {
        id, x: sp.x, y: sp.y, heading: rnd(0, 360), hp: hpVal,
        maxHp: hpVal,
        fireTimer: 0, isChaser: isSurprise,
        role: isSurprise ? 'pusher' : assignBotRole(spawnIndex, room.totalBotsForWave),
        abilityTimer: rnd(0, 3), dashingUntil: 0, shieldUntil: 0,
        inPrison: false,
        lastSent: null, stuckCheck: null, anchorX: cx, anchorY: cy
    };
    return room.bots[id];
}

function spawnPrisonBot(room, bx, by, hpVal, role) {
    const id = room.botIdCounter++;
    room.bots[id] = {
        id, x: bx, y: by, heading: rnd(0, 360), hp: hpVal,
        maxHp: hpVal,
        fireTimer: 0, isChaser: false,
        role: role || 'pusher',
        abilityTimer: rnd(0, 3), dashingUntil: 0, shieldUntil: 0,
        inPrison: true,
        lastSent: null, stuckCheck: null,
        anchorX: room.worldSize / 2, anchorY: room.worldSize / 2
    };
    room.botsSpawnedThisWave++;
    return room.bots[id];
}

function spawnWave(roomId) {
    const room = rooms[roomId];
    if (!room || room.wiped) return;
    room.bots = {};
    const totalBots = botCountForWave(room.wave, room.botLevel);
    room.totalBotsForWave = totalBots;
    room.botsSpawnedThisWave = 0;
    room.botsKilledThisWave = 0;

    room.bombSchedule = computeBombSchedule(totalBots);
    room.bombKillsCount = 0;
    room.bombBombsTriggered = 0;
    room.xpMultiplier = 1.0;
    room.prisonPhase = false;

    const initialSpawnCount = Math.min(totalBots, MAX_BOTS_ON_FIELD);
    const hpVal = botHPForRoom(room);

    let cx = 0, cy = 0, n = 0;
    for (const uid in room.players) { cx += room.players[uid].x; cy += room.players[uid].y; n++; }
    if (n > 0) { cx /= n; cy /= n; } else { cx = room.worldSize / 2; cy = room.worldSize / 2; }

    // ⭐ الآن البوتات ستظهر من الأطراف تلقائياً (isSurprise = false)
    for (let i = 0; i < initialSpawnCount; i++) {
        spawnSingleBot(room, cx, cy, BOT_SPAWN_MIN_DIST, BOT_SPAWN_MAX_DIST, hpVal, false, 0);
    }

    io.to(roomId).emit('wave_start', { wave: room.wave, totalBots });

    const botsPayload = Object.values(room.bots).map(b => {
        const payload = {
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            heading: Math.round(b.heading), hp: b.hp,
            role: b.role, isChaser: !!b.isChaser, shielded: false
        };
        b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
        return payload;
    });
    io.to(roomId).emit('bots_update', botsPayload);
}

// ===== Prison System =====

function findPrisonSpawnPos(room, barrierRadius) {
    const cx = room.worldSize / 2;
    const cy = room.worldSize / 2;
    for (let attempt = 0; attempt < 40; attempt++) {
        const angle = rnd(0, Math.PI * 2);
        const dist = barrierRadius + rnd(200, 1500);
        let bx = cx + Math.cos(angle) * dist;
        let by = cy + Math.sin(angle) * dist;
        if (bx < 700 || bx > room.worldSize - 700) continue;
        if (by < 700 || by > room.worldSize - 700) continue;
        let onIsland = false;
        for (const isl of room.islands) {
            if (dist2(bx, by, isl.x, isl.y) < (isl.radius + 250) * (isl.radius + 250)) { onIsland = true; break; }
        }
        if (onIsland) continue;
        return { x: bx, y: by };
    }
    const edge = Math.floor(rnd(0, 4));
    if (edge === 0) return { x: rnd(800, room.worldSize - 800), y: 800 };
    if (edge === 1) return { x: rnd(800, room.worldSize - 800), y: room.worldSize - 800 };
    if (edge === 2) return { x: 800, y: rnd(800, room.worldSize - 800) };
    return { x: room.worldSize - 800, y: rnd(800, room.worldSize - 800) };
}

function startPrisonPhase(roomId) {
    const room = rooms[roomId];
    if (!room || room.wiped) return;

    room.prisonPhase = true;
    room.prisonEndsAt = Date.now() + PRISON_DURATION_MS;
    room.prisonBarrierRadius = room.worldSize * PRISON_BARRIER_RATIO;
    room.xpMultiplier = PRISON_MIN_XP_MULT;

    // ⭐ موقع عمود السجن الآن عشوائي بعيد عن الجزر وعن المركز
    const pillarPos = findPillarPosition(room);
    room.pillarX = pillarPos.x;
    room.pillarY = pillarPos.y;

    const totalBots = botCountForWave(room.wave, room.botLevel);
    room.totalBotsForWave = totalBots;
    room.botsSpawnedThisWave = 0;
    room.botsKilledThisWave = 0;
    room.bots = {};
    room.bombSchedule = computeBombSchedule(totalBots);
    room.bombKillsCount = 0;
    room.bombBombsTriggered = 0;

    const hpVal = botHPForRoom(room);
    for (let i = 0; i < totalBots; i++) {
        const pos = findPrisonSpawnPos(room, room.prisonBarrierRadius);
        const role = assignBotRole(i, totalBots);
        spawnPrisonBot(room, pos.x, pos.y, hpVal, role);
    }

    io.to(roomId).emit('prison_started', {
        wave: room.wave,
        duration: PRISON_DURATION_MS / 1000,
        barrierRadius: room.prisonBarrierRadius,
        pillarX: Math.round(room.pillarX),
        pillarY: Math.round(room.pillarY),
        totalBots: totalBots
    });

    emitPrisonVisibleBots(roomId);

    safeSetTimeout(roomId, () => {
        const r = rooms[roomId];
        if (!r || r.wiped || !r.prisonPhase) return;
        releaseBots(roomId, 'auto', 'Timer', PRISON_MIN_XP_MULT);
    }, PRISON_DURATION_MS);
}

function emitPrisonVisibleBots(roomId) {
    const room = rooms[roomId];
    if (!room || !room.prisonPhase) return;
    const botList = Object.values(room.bots).filter(b => b.inPrison);
    const visibleCount = Math.min(5, botList.length);
    const payload = [];
    for (let i = 0; i < visibleCount; i++) {
        const b = botList[Math.floor(Math.random() * botList.length)];
        if (!b) continue;
        payload.push({
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            heading: Math.round(b.heading), hp: b.hp,
            role: b.role, isChaser: false, shielded: false
        });
    }
    io.to(roomId).emit('prison_visible_bots', payload);
}

function emitPrisonVisibleBotsToSocket(socket, room) {
    if (!room || !room.prisonPhase) return;
    const botList = Object.values(room.bots).filter(b => b.inPrison);
    const visibleCount = Math.min(5, botList.length);
    const payload = [];
    for (let i = 0; i < visibleCount; i++) {
        const b = botList[Math.floor(Math.random() * botList.length)];
        if (!b) continue;
        payload.push({
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            heading: Math.round(b.heading), hp: b.hp,
            role: b.role, isChaser: false, shielded: false
        });
    }
    socket.emit('prison_visible_bots', payload);
}

function releaseBots(roomId, byId, byName, xpMult) {
    const room = rooms[roomId];
    if (!room || room.wiped || !room.prisonPhase) return;

    room.prisonPhase = false;
    room.xpMultiplier = xpMult;

    for (const botId in room.bots) {
        room.bots[botId].inPrison = false;
        room.bots[botId].lastSent = null;
    }

    awardPillarXp(room, xpMult);

    io.to(roomId).emit('prison_released', {
        byId, byName,
        xpMultiplier: Math.round(xpMult * 100) / 100,
        wave: room.wave,
        totalBots: room.totalBotsForWave
    });

    io.to(roomId).emit('wave_start', { wave: room.wave, totalBots: room.totalBotsForWave });

    const botsPayload = Object.values(room.bots).map(b => {
        const payload = {
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            heading: Math.round(b.heading), hp: b.hp,
            role: b.role, isChaser: !!b.isChaser, shielded: false
        };
        b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
        return payload;
    });
    io.to(roomId).emit('bots_update', botsPayload);
}

// ===== XP Awarding =====

function applyXpGain(player, gain) {
    if (!player || gain <= 0) return;
    const oldLevel = player.level || 1;
    player.xp = (player.xp || 0) + gain;
    player.level = xpToLevel(player.xp);
    const tierChanged = levelToTier(player.level) > levelToTier(oldLevel);

    const unlockedFinishers = [];
    let newlyEquipped = null;

    if (player.level > oldLevel) {
        const newFinishers = getNewlyUnlockedFinishers(oldLevel, player.level);
        if (newFinishers.length > 0) {
            for (const fId of newFinishers) {
                unlockedFinishers.push(fId);
                if (player.uid) {
                    fetchWithTimeout(DB_URL + "/players/" + player.uid + "/unlockedFinishers/" + fId + ".json", {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(true)
                    }).catch(() => {});
                }
            }

            const best = getBestFinisherForLevel(player.level);
            if (best) {
                newlyEquipped = best;
                player.finisherId = best;

                if (player.uid) {
                    fetchWithTimeout(DB_URL + "/players/" + player.uid + "/activeFinisherId.json", {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(best)
                    }).catch(() => {});
                }

                if (player.currentRoom) {
                    io.to(player.currentRoom).emit('player_finisher_changed', {
                        id: player.id,
                        uid: player.uid,
                        finisherId: best
                    });
                }
            }
        }
    }

    if (player.online && player.id && !player.isGhost) {
        io.to(player.id).emit('xp_update', {
            xp: player.xp,
            level: player.level,
            tier: levelToTier(player.level),
            gained: gain,
            tierChanged,
            unlockedFinishers,
            newlyEquipped
        });
    }
    savePlayerDebounced(player);
}

function awardKillXp(player, room) {
    const gain = xpPerKill(player.hullId, room.tier, player.level);
    if (gain <= 0) return;
    applyXpGain(player, gain);
}

function awardPillarXp(room, xpMult) {
    for (const uid in room.players) {
        const pl = room.players[uid];
        if (!pl) continue;
        const isOffline = !pl.online || pl.isGhost || (pl.offlineAt && pl.offlineAt > 0);
        let gain;
        if (isOffline) {
            gain = OFFLINE_PILLAR_XP;
        } else {
            gain = Math.round(PILLAR_XP_BASE * xpMult);
        }
        if (!isOffline && pl.level && pl.level < NEWBIE_LEVEL_THRESHOLD) {
            gain = Math.round(gain * NEWBIE_XP_MULTIPLIER);
        }
        applyXpGain(pl, gain);
    }
}

// ===== Firebase =====

async function fetchWithTimeout(url, options = {}, ms = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
}

async function fetchUserStats(uid) {
    const fallback = { kills: 0, xp: 0, level: 1, finisherId: null };
    if (!uid) return fallback;
    try {
        const res = await fetchWithTimeout(DB_URL + "/players/" + uid + ".json", {}, 4000);
        if (!res.ok) return fallback;
        const data = await res.json();
        if (!data) return fallback;

        let xp = 0;
        if (typeof data.xp === 'number') xp = data.xp;
        else if (typeof data.level === 'number') xp = (data.level - 1) * XP_PER_LEVEL;
        xp = Math.max(0, xp);

        return {
            kills: typeof data.total_kills === 'number' ? data.total_kills : 0,
            xp: xp,
            level: xpToLevel(xp),
            finisherId: typeof data.activeFinisherId === 'string' ? data.activeFinisherId : null
        };
    } catch (e) { return fallback; }
}

function savePlayerDebounced(player) {
    if (!player || !player.uid) return;
    const now = Date.now();
    if (player.lastSaveAt && (now - player.lastSaveAt) < XP_SAVE_DEBOUNCE_MS) return;
    player.lastSaveAt = now;
    savePlayerForce(player);
}

function savePlayerForce(player) {
    if (!player || !player.uid) return;
    const uid = player.uid;
    const xp = player.xp || 0;
    const level = xpToLevel(xp);
    const sessionKills = player.kills || 0;

    fetchWithTimeout(DB_URL + "/players/" + uid + "/xp.json", {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(xp)
    }).catch(() => {});

    fetchWithTimeout(DB_URL + "/players/" + uid + "/level.json", {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level)
    }).catch(() => {});

    if (player.finisherId) {
        fetchWithTimeout(DB_URL + "/players/" + uid + "/activeFinisherId.json", {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(player.finisherId)
        }).catch(() => {});
    }

    if (sessionKills > 0 || (player.sessionKillsSaved || 0) > 0) {
        const baseKills = player.totalKillsAtStart || 0;
        const alreadySaved = player.sessionKillsSaved || 0;
        const newTotalKills = baseKills + alreadySaved + sessionKills;
        fetchWithTimeout(DB_URL + "/players/" + uid + "/total_kills.json", {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTotalKills)
        }).catch(() => {});
        player.sessionKillsSaved = alreadySaved + sessionKills;
        player.kills = 0;
    }
}

let cachedLeaderboard = [];
let lastFetch = 0;
const CACHE_MS = 10000;
let pendingLeaderboardFetch = null;

async function fetchLeaderboard() {
    const now = Date.now();
    if (now - lastFetch < CACHE_MS && cachedLeaderboard.length > 0) return cachedLeaderboard;
    if (pendingLeaderboardFetch) return pendingLeaderboardFetch;
    pendingLeaderboardFetch = (async () => {
        try {
            const url = DB_URL + "/players.json?orderBy=\"level\"&limitToLast=5";
            const res = await fetchWithTimeout(url);
            if (!res.ok) return cachedLeaderboard;
            const data = await res.json();
            if (!data) return cachedLeaderboard;
            const arr = Object.values(data).map(u => ({
                name: (u && u.username) || "Commander",
                kills: (u && u.total_kills) || 0,
                level: (u && u.level) || 1
            }));
            arr.sort((a, b) => b.level - a.level || b.kills - a.kills);
            cachedLeaderboard = arr.slice(0, 5);
            lastFetch = now;
            return cachedLeaderboard;
        } catch (e) { return cachedLeaderboard; }
        finally { pendingLeaderboardFetch = null; }
    })();
    return pendingLeaderboardFetch;
}

function sendLeaderboard(roomId) {
    fetchLeaderboard().then(top => io.to(roomId).emit('leaderboard_update', top)).catch(() => {});
}

function flushWaveStats(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    for (const uid in room.players) {
        const pl = room.players[uid];
        if (!pl.uid) continue;
        savePlayerForce(pl);
    }
    sendLeaderboard(roomId);
}

// ===== Party =====

function handleUserLeavingParty(socket, uid, partyId) {
    const party = activeParties.get(partyId);
    if (!party) return;
    party.members = party.members.filter(m => m.uid !== uid);
    userPartyMap.delete(uid);
    if (socket) {
        try { socket.leave(partyId); } catch (e) {}
        socket.emit("party_update", { partyId: "", members: [] });
    }
    if (party.members.length === 0) {
        activeParties.delete(partyId);
        const roomId = partyRoomMap.get(partyId);
        if (roomId) {
            const r = rooms[roomId];
            if (r) {
                const strangers = Object.values(r.players).filter(p => !p.uid);
                if (strangers.length === 0 && Object.keys(r.players).length === 0) endRoom(roomId);
                else r.partyId = null;
            }
            partyRoomMap.delete(partyId);
        }
    } else {
        if (party.leaderUid === uid) {
            party.members.sort((a, b) => b.level - a.level);
            const newLeader = party.members[0];
            party.leaderUid = newLeader.uid;
            newLeader.isLeader = true;
        }
        io.to(partyId).emit("party_update", party);
    }
}

function endRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.wiped = true;
    clearRoomTimeouts(roomId);
    if (room.botTickInterval) { clearInterval(room.botTickInterval); room.botTickInterval = null; }
    if (room.bombTimerHandle) { clearTimeout(room.bombTimerHandle); room.bombTimerHandle = null; }
    if (room.partyId) {
        if (partyRoomMap.get(room.partyId) === roomId) partyRoomMap.delete(room.partyId);
        partyRoomLocks.delete(room.partyId);
    }
    for (const uid in room.players) {
        const p = room.players[uid];
        if (p.deathTimer) { clearTimeout(p.deathTimer); p.deathTimer = null; }
        savePlayerForce(p);
        if (!p.id) continue;
        const s = io.sockets.sockets.get(p.id);
        if (s) { s.leave(roomId); cleanSocket(s); }
    }
    delete rooms[roomId];
}

// ===== Bomb =====

function triggerBomb(room, roomId) {
    if (!room || room.wiped) return;
    if (room.bombActive) return;
    room.bombActive = true;

    // ⭐ اختر موقعاً جديداً عشوائياً للقنبلة في كل مرة
    const pos = findBombSpawnPos(room);
    room.bombX = pos.x;
    room.bombY = pos.y;

    const dur = computeBombTimer(room.wave);
    room.bombExpireAt = Date.now() + dur * 1000;

    io.to(roomId).emit('bomb_spawned', {
        x: Math.round(room.bombX), y: Math.round(room.bombY),
        duration: dur, expireAt: room.bombExpireAt
    });

    room.bombTimerHandle = setTimeout(() => {
        const r = rooms[roomId];
        if (!r || r.wiped) return;
        r.bombActive = false;
        io.to(roomId).emit('bomb_exploded', { x: Math.round(r.bombX), y: Math.round(r.bombY) });
        for (const uid in r.players) {
            const pl = r.players[uid];
            if (pl.hp <= 0) continue;
            pl.hp = 0;
            if (pl.online && pl.id && !pl.isGhost) {
                io.to(pl.id).emit('player_died', { id: pl.id, name: pl.name, cause: 'bomb' });
            }
        }
        safeSetTimeout(roomId, () => {
            const r2 = rooms[roomId];
            if (!r2 || r2.wiped) return;
            flushWaveStats(roomId);
            io.to(roomId).emit('team_wipe');
            endRoom(roomId);
        }, RESPAWN_MS);
    }, dur * 1000);
}

// ===== Socket =====

io.on('connection', (socket) => {

    socket.voiceChannel = null;
    socket.voiceUid = null;
    socket.voiceName = null;
    socket.voiceMuted = false;

    socket.on('voice_join', (data) => {
        if (!data || !data.channelId || !data.uid) return;
        if (socket.voiceChannel) {
            socket.to('voice_' + socket.voiceChannel).emit('voice_peer_left', { uid: socket.voiceUid });
            socket.leave('voice_' + socket.voiceChannel);
        }
        socket.voiceChannel = data.channelId;
        socket.voiceUid = data.uid;
        socket.voiceName = data.name || 'Player';
        socket.join('voice_' + data.channelId);

        const peers = [];
        const room = io.sockets.adapter.rooms.get('voice_' + data.channelId);
        if (room) {
            for (const sid of room) {
                const s = io.sockets.sockets.get(sid);
                if (s && s.voiceUid && s.voiceUid !== data.uid) {
                    peers.push({ uid: s.voiceUid, name: s.voiceName, muted: !!s.voiceMuted });
                }
            }
        }
        socket.emit('voice_peers', peers);
        socket.to('voice_' + data.channelId).emit('voice_peer_joined', {
            uid: data.uid, name: socket.voiceName
        });
    });

    socket.on('voice_leave', () => {
        if (!socket.voiceChannel) return;
        socket.to('voice_' + socket.voiceChannel).emit('voice_peer_left', { uid: socket.voiceUid });
        socket.leave('voice_' + socket.voiceChannel);
        socket.voiceChannel = null;
        socket.voiceUid = null;
    });

    socket.on('voice_data', (data) => {
        if (!socket.voiceChannel || !socket.voiceUid) return;
        if (!data || !data.chunk) return;
        socket.to('voice_' + socket.voiceChannel).emit('voice_data', {
            fromUid: socket.voiceUid,
            seq: data.seq || 0,
            chunk: data.chunk
        });
    });

    socket.on('voice_mute_state', (data) => {
        if (!socket.voiceChannel) return;
        socket.voiceMuted = !!(data && data.muted);
        socket.to('voice_' + socket.voiceChannel).emit('voice_mute_state', {
            uid: socket.voiceUid, muted: socket.voiceMuted
        });
    });

    socket.on('disconnect', () => {
        if (socket.voiceChannel) {
            socket.to('voice_' + socket.voiceChannel).emit('voice_peer_left', { uid: socket.voiceUid });
            socket.leave('voice_' + socket.voiceChannel);
        }
        if (!socket.uid) return;
        onlineUsers.delete(socket.uid);
        const partyId = userPartyMap.get(socket.uid);
        if (partyId) {
            const party = activeParties.get(partyId);
            if (party) {
                const member = party.members.find(m => m.uid === socket.uid);
                if (member) { member.online = false; io.to(partyId).emit("party_update", party); }
            }
        }
        const roomId = socket.currentRoom;
        const uid = socket.uid;
        if (roomId && rooms[roomId] && rooms[roomId].players[uid]) {
            const r = rooms[roomId];
            const p = r.players[uid];
            p.online = false;
            if (!p.offlineAt) {
                p.offlineAt = Date.now();
                p.offlineReason = "disconnect";
                io.to(roomId).emit('player_offline', {
                    id: socket.id, uid: p.uid, name: p.name, slotNumber: p.slotNumber,
                    offlineAt: p.offlineAt, remaining: OFFLINE_GRACE_SECONDS
                });
            }
            savePlayerForce(p);
            if (p.deathTimer) clearTimeout(p.deathTimer);
            p.deathTimer = setTimeout(() => {
                const r2 = rooms[roomId];
                if (!r2 || r2.wiped) return;
                if (!r2.players[uid]) return;
                savePlayerForce(r2.players[uid]);
                io.to(roomId).emit('player_removed', {
                    id: r2.players[uid].id, uid: r2.players[uid].uid, slotNumber: r2.players[uid].slotNumber
                });
                delete r2.players[uid];
                const remaining = Object.values(r2.players);
                if (remaining.length === 0) { endRoom(roomId); return; }
                const anyOnlineAlive = remaining.some(pl => pl.online && pl.hp > 0);
                if (!anyOnlineAlive) {
                    flushWaveStats(roomId);
                    io.to(roomId).emit('team_wipe');
                    endRoom(roomId);
                }
            }, OFFLINE_DEATH_MS);
        }
    });

    socket.on("register_user", (data) => {
        if (!data || !data.uid) return;
        onlineUsers.set(data.uid, socket.id);
        socket.uid = data.uid;
        const partyId = userPartyMap.get(data.uid);
        if (partyId) {
            const party = activeParties.get(partyId);
            if (!party) { userPartyMap.delete(data.uid); socket.emit("party_update", { partyId: "", members: [] }); }
            else {
                const member = party.members.find(m => m.uid === data.uid);
                if (!member) { userPartyMap.delete(data.uid); socket.emit("party_update", { partyId: "", members: [] }); }
                else { member.online = true; socket.join(partyId); socket.emit("party_update", party); }
            }
        } else socket.emit("party_update", { partyId: "", members: [] });
    });

    socket.on("invite_to_party", (data) => {
        if (!data) return;
        const { senderUid, senderName, targetUid } = data;
        const senderLevel = data.senderLevel || 1;
        const senderHullId = data.senderHullId || "bot";
        const senderSkinPath = data.senderSkinPath || "bt/bt.png";
        let targetSocketId = onlineUsers.get(targetUid);
        if (targetSocketId && !io.sockets.sockets.has(targetSocketId)) { onlineUsers.delete(targetUid); targetSocketId = null; }
        if (!targetSocketId) {
            for (const roomId in rooms) {
                const room = rooms[roomId];
                if (room.players[targetUid] && room.players[targetUid].id) {
                    const sid = room.players[targetUid].id;
                    if (io.sockets.sockets.has(sid)) { targetSocketId = sid; onlineUsers.set(targetUid, sid); break; }
                }
            }
        }
        if (!targetSocketId) {
            for (const [sid, s] of io.sockets.sockets) {
                if (s.uid === targetUid) { targetSocketId = sid; onlineUsers.set(targetUid, sid); break; }
            }
        }
        if (!targetSocketId) { socket.emit("party_error", { message: "Player is offline" }); return; }

        let partyId = userPartyMap.get(senderUid);
        let party = partyId ? activeParties.get(partyId) : null;
        if (!party || !party.members.some(m => m.uid === senderUid)) {
            if (partyId) {
                userPartyMap.delete(senderUid);
                if (party && party.members.length === 0) { activeParties.delete(partyId); partyRoomMap.delete(partyId); }
            }
            partyId = "party_" + Math.random().toString(36).substring(2, 9);
            party = {
                partyId, leaderUid: senderUid,
                members: [{
                    uid: senderUid, username: senderName || "Commander",
                    level: senderLevel, hullId: senderHullId, skinPath: senderSkinPath,
                    isLeader: true, online: true
                }]
            };
            activeParties.set(partyId, party);
            userPartyMap.set(senderUid, partyId);
            socket.join(partyId);
            socket.emit("party_update", party);
        }
        io.to(targetSocketId).emit("party_invite_received", { senderUid, senderName, partyId });
    });

    socket.on("join_party", (data) => {
        if (!data) return;
        const { uid, username, level, hullId, skinPath, partyId } = data;
        socket.join(partyId);
        let party = activeParties.get(partyId);
        if (!party) { party = { partyId, leaderUid: uid, members: [] }; activeParties.set(partyId, party); }
        const existingIdx = party.members.findIndex(m => m.uid === uid);
        if (existingIdx === -1) {
            party.members.push({
                uid, username, level: parseInt(level) || 1,
                hullId: hullId || "bot", skinPath: skinPath || "bt/bt.png",
                isLeader: (party.leaderUid === uid), online: true
            });
        } else {
            party.members[existingIdx].username = username;
            party.members[existingIdx].level = parseInt(level) || 1;
            party.members[existingIdx].hullId = hullId || "bot";
            party.members[existingIdx].skinPath = skinPath || "bt/bt.png";
            party.members[existingIdx].online = true;
        }
        userPartyMap.set(uid, partyId);
        io.to(partyId).emit("party_update", party);
    });

    socket.on("leave_party", (data) => { if (data) handleUserLeavingParty(socket, data.uid, data.partyId); });

    socket.on("user_offline", (data) => {
        if (!data || !data.uid) return;
        const partyId = userPartyMap.get(data.uid);
        if (!partyId) return;
        const party = activeParties.get(partyId);
        if (!party) return;
        const member = party.members.find(m => m.uid === data.uid);
        if (member) { member.online = false; io.to(partyId).emit("party_update", party); }
    });

    socket.on("user_online", (data) => {
        if (!data || !data.uid) return;
        const partyId = userPartyMap.get(data.uid);
        if (!partyId) return;
        const party = activeParties.get(partyId);
        if (!party) { userPartyMap.delete(data.uid); return; }
        const member = party.members.find(m => m.uid === data.uid);
        if (member) { member.online = true; io.to(partyId).emit("party_update", party); }
    });

    socket.on("request_party_refresh", (data) => {
        if (!data || !data.uid) return;
        const partyId = userPartyMap.get(data.uid);
        if (!partyId) { socket.emit("party_update", { partyId: "", members: [] }); return; }
        const party = activeParties.get(partyId);
        if (!party) { userPartyMap.delete(data.uid); socket.emit("party_update", { partyId: "", members: [] }); return; }
        socket.join(partyId);
        socket.emit("party_update", party);
    });

    socket.on("party_start_matchmaking", (data) => {
        if (!data) return;
        const { partyId, mode } = data;
        const party = activeParties.get(partyId);
        if (!party) return;
        if (party.leaderUid !== socket.uid) return;
        if (partyRoomLocks.get(partyId)) { io.to(partyId).emit("party_matchmaking_started", { mode }); return; }
        partyRoomLocks.set(partyId, true);
        try {
            let existingRoomId = partyRoomMap.get(partyId);
            if (existingRoomId) {
                const existingRoom = rooms[existingRoomId];
                if (!existingRoom || existingRoom.wiped) { partyRoomMap.delete(partyId); existingRoomId = null; }
                else if (existingRoom.mode !== mode) {
                    const strangers = Object.values(existingRoom.players).filter(p => !p.uid);
                    if (strangers.length === 0 && Object.keys(existingRoom.players).length === 0) endRoom(existingRoomId);
                    else existingRoom.partyId = null;
                    partyRoomMap.delete(partyId);
                    existingRoomId = null;
                }
            }
            if (existingRoomId) { io.to(partyId).emit("party_matchmaking_started", { mode, roomId: existingRoomId }); return; }
            const leaderPlayer = party.members.find(m => m.uid === party.leaderUid);
            const startLevel = leaderPlayer ? leaderPlayer.level : 1;
            const startTier = levelToTier(startLevel);
            const newRoomId = createRoom(mode, startTier, partyId);
            partyRoomMap.set(partyId, newRoomId);
            io.to(partyId).emit("party_matchmaking_started", { mode, roomId: newRoomId });
        } finally { partyRoomLocks.delete(partyId); }
    });

    socket.on("party_cancel_matchmaking", (data) => {
        if (!data) return;
        const party = activeParties.get(data.partyId);
        if (!party) return;
        if (party.leaderUid !== socket.uid) return;
        io.to(data.partyId).emit("party_matchmaking_canceled");
    });

    socket.on('check_active_session', (data) => {
        const uid = data && data.uid;
        if (!uid || typeof uid !== 'string') { socket.emit('no_active_session'); return; }
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.wiped) continue;
            const player = room.players[uid];
            if (player) {
                const anyAlive = Object.values(room.players).some(p => p.hp > 0);
                if (anyAlive) {
                    socket.emit('active_session_found', {
                        roomId, wave: room.wave, level: player.level,
                        hp: player.hp, maxHp: player.maxHp, maxSpeed: player.maxSpeed,
                        x: Math.round(player.x), y: Math.round(player.y), heading: Math.round(player.heading),
                        worldSize: room.worldSize, islands: room.islands,
                        hullId: player.hullId, skinPath: player.skinPath,
                        xp: player.xp || 0, tier: room.tier
                    });
                    return;
                }
            }
        }
        if (wipedRoomsLog.has(uid)) { wipedRoomsLog.delete(uid); socket.emit('previous_team_wipe'); return; }
        socket.emit('no_active_session');
    });

    socket.on('reconnect_session', (data) => {
        if (!data) { socket.emit('session_recovery_failed'); return; }
        const { uid, roomId, hullId, skinPath, finisherId } = data;
        if (!uid || !roomId) { socket.emit('session_recovery_failed'); return; }
        const room = rooms[roomId];
        if (!room || room.wiped) { socket.emit('session_recovery_failed'); return; }
        const player = room.players[uid];
        if (!player) { socket.emit('session_recovery_failed'); return; }

        if (player.hp <= 0) {
            const otherAlivePlayers = Object.values(room.players).filter(p => p.uid !== uid && p.hp > 0 && p.online && !p.isGhost);
            if (otherAlivePlayers.length > 0) {
                const sp = randomSpawnNearSafe(room.worldSize / 2, room.worldSize / 2, 300, 1200, room.islands, room.worldSize, undefined);
                player.x = sp.x; player.y = sp.y;
                player.hp = player.maxHp;
                player.lastDamageTime = 0;
                setTimeout(() => {
                    socket.emit('player_respawned', { id: socket.id, x: Math.round(player.x), y: Math.round(player.y) });
                }, 500);
            } else { socket.emit('session_recovery_failed'); return; }
        }

        if (player.deathTimer) { clearTimeout(player.deathTimer); player.deathTimer = null; }
        player.offlineAt = 0;
        player.offlineReason = null;
        player.online = true;
        player.isGhost = false;
        player.id = socket.id;
        player.lastMoveTime = Date.now();
        player.currentRoom = roomId;

        if (hullId && hullId !== player.hullId) {
            player.hullId = hullId;
            const stats = getShipStats(hullId);
            player.maxHp = stats.hp;
            player.maxSpeed = stats.speed;
            if (player.hp > player.maxHp) player.hp = player.maxHp;
        }
        if (skinPath) player.skinPath = skinPath;
        if (finisherId) player.finisherId = finisherId;

        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.username = player.name;
        socket.uid = player.uid;
        socket.mode = room.mode;

        socket.emit('session_recovered', {
            wave: room.wave, level: player.level,
            hp: player.hp, maxHp: player.maxHp, maxSpeed: player.maxSpeed,
            torpedoSpeed: getTorpedoSpeed(room),
            hullId: player.hullId, skinPath: player.skinPath,
            worldSize: room.worldSize, islands: room.islands,
            slotNumber: player.slotNumber || 1,
            superCharges: player.superCharges || 0,
            killsSinceSuperCharge: player.killsSinceSuperCharge || 0,
            xp: player.xp || 0, tier: room.tier
        });

        const packsPayload = Object.values(room.healthPacks).map(hp => ({
            id: hp.id, x: Math.round(hp.x), y: Math.round(hp.y),
            remaining: Math.max(0, (hp.expiresAt - Date.now()) / 1000)
        }));
        if (packsPayload.length > 0) socket.emit('health_packs_state', packsPayload);

        if (room.bombActive) {
            socket.emit('bomb_spawned', {
                x: Math.round(room.bombX), y: Math.round(room.bombY),
                duration: (room.bombExpireAt - Date.now()) / 1000,
                expireAt: room.bombExpireAt
            });
        }

        if (room.prisonPhase) {
            socket.emit('prison_started', {
                wave: room.wave,
                duration: Math.max(0, (room.prisonEndsAt - Date.now()) / 1000),
                barrierRadius: room.prisonBarrierRadius,
                pillarX: Math.round(room.pillarX),
                pillarY: Math.round(room.pillarY),
                totalBots: room.totalBotsForWave
            });
            emitPrisonVisibleBotsToSocket(socket, room);
        }

        io.to(roomId).emit('player_online', { id: socket.id, uid: uid, slotNumber: player.slotNumber });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, uid: uid, name: player.name,
            x: Math.round(player.x), y: Math.round(player.y),
            heading: Math.round(player.heading),
            hullId: player.hullId, skinPath: player.skinPath, finisherId: player.finisherId,
            slotNumber: player.slotNumber
        });

        const existing = Object.values(room.players).filter(p => p.uid !== uid).map(p => ({
            id: p.id, uid: p.uid, name: p.name,
            x: Math.round(p.x), y: Math.round(p.y),
            heading: Math.round(p.heading),
            hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId,
            slotNumber: p.slotNumber || 0,
            remaining: p.offlineAt ? computeRemaining(p.offlineAt) : 0
        }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        if (!room.prisonPhase) {
            const botsPayload = Object.values(room.bots).map(b => {
                const payload = {
                    id: b.id, x: Math.round(b.x), y: Math.round(b.y),
                    heading: Math.round(b.heading), hp: b.hp,
                    role: b.role, isChaser: !!b.isChaser, shielded: false
                };
                b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
                return payload;
            });
            socket.emit('bots_update', botsPayload);
        }
    });

    socket.on('join_match', async (data) => {
        if (!data) return;
        const { mode, username, uid, hullId, skinPath, finisherId, partyId } = data;
        if (!uid || typeof uid !== 'string') { socket.emit('mode_rejected'); return; }

        if (socket.currentRoom) {
            const oldRoom = rooms[socket.currentRoom];
            if (oldRoom && socket.uid && oldRoom.players[socket.uid]) {
                if (oldRoom.players[socket.uid].deathTimer) {
                    clearTimeout(oldRoom.players[socket.uid].deathTimer);
                    oldRoom.players[socket.uid].deathTimer = null;
                }
                savePlayerForce(oldRoom.players[socket.uid]);
                const oldId = oldRoom.players[socket.uid].id;
                delete oldRoom.players[socket.uid];
                io.to(socket.currentRoom).emit('player_left', { id: oldId });
                if (Object.keys(oldRoom.players).length === 0) endRoom(socket.currentRoom);
            }
            socket.leave(socket.currentRoom);
        }
        cleanSocket(socket);

        for (const rId in rooms) {
            const r = rooms[rId];
            if (r.players[uid]) {
                if (r.players[uid].deathTimer) { clearTimeout(r.players[uid].deathTimer); r.players[uid].deathTimer = null; }
                savePlayerForce(r.players[uid]);
                const oldId = r.players[uid].id;
                delete r.players[uid];
                io.to(rId).emit('player_left', { id: oldId });
                if (Object.keys(r.players).length === 0) endRoom(rId);
            }
        }

        socket.username = username || 'Commander';
        socket.uid = uid;
        socket.mode = mode || '4VBOT';

        if (socket.mode !== '1VBOT' && socket.mode !== '4VBOT') { socket.emit('mode_rejected'); return; }

        const userStats = await fetchUserStats(uid);
        const startXp = userStats.xp;
        const startLevel = userStats.level;
        const startKills = userStats.kills || 0;
        socket.startLevel = startLevel;

        let startFinisher = finisherId || userStats.finisherId;
        if (!startFinisher) {
            startFinisher = getBestFinisherForLevel(startLevel) || 'none';
        }

        const playerTier = levelToTier(startLevel);

        let roomId = null;
        if (partyId) {
            roomId = partyRoomMap.get(partyId);
            if (roomId) {
                const r = rooms[roomId];
                if (!r || r.wiped || r.mode !== socket.mode) { partyRoomMap.delete(partyId); roomId = null; }
            }
            if (!roomId) {
                const party = activeParties.get(partyId);
                let startTier = playerTier;
                if (party) {
                    const leader = party.members.find(m => m.uid === party.leaderUid);
                    if (leader) startTier = levelToTier(leader.level);
                }
                if (!partyRoomLocks.get(partyId)) {
                    partyRoomLocks.set(partyId, true);
                    try { roomId = createRoom(socket.mode, startTier, partyId); partyRoomMap.set(partyId, roomId); }
                    finally { partyRoomLocks.delete(partyId); }
                } else {
                    roomId = partyRoomMap.get(partyId);
                    if (!roomId) { roomId = createRoom(socket.mode, startTier, partyId); partyRoomMap.set(partyId, roomId); }
                }
            }
        } else {
            roomId = findRoomForTier(socket.mode, playerTier, null);
            if (!roomId) roomId = createRoom(socket.mode, playerTier);
        }

        const room = rooms[roomId];
        if (!room) { socket.emit('mode_rejected'); return; }

        socket.join(roomId);
        socket.currentRoom = roomId;

        let sx = room.worldSize / 2, sy = room.worldSize / 2;
        let bestDist = -1;
        for (let attempt = 0; attempt < 40; attempt++) {
            const cand = randomSpawnNearSafe(room.worldSize / 2, room.worldSize / 2, 300, 1500, room.islands, room.worldSize, undefined);
            let minD = Infinity;
            for (const bid in room.bots) {
                const b = room.bots[bid];
                const d = dist2(cand.x, cand.y, b.x, b.y);
                if (d < minD) minD = d;
            }
            if (minD > bestDist) { bestDist = minD; sx = cand.x; sy = cand.y; }
            if (bestDist > 4000 * 4000) break;
        }

        const validHullId = hullId || bestShipForLevel(startLevel);
        const stats = getShipStats(validHullId);
        const assignedSlot = findFreeSlot(room);

        room.players[socket.uid] = {
            id: socket.id, uid: socket.uid, name: socket.username,
            x: sx, y: sy, heading: 0,
            maxHp: stats.hp, hp: stats.hp, maxSpeed: stats.speed,
            kills: 0, level: startLevel,
            xp: startXp,
            totalKillsAtStart: startKills,
            sessionKillsSaved: 0,
            online: true, isGhost: false, deathTimer: null,
            hullId: validHullId,
            skinPath: skinPath || 'bt/bot/bot.png',
            finisherId: startFinisher,
            slotNumber: assignedSlot,
            offlineAt: 0, offlineReason: null,
            vx: 0, vy: 0, lastX: sx, lastY: sy,
            lastDamageTime: 0, lastHitBotTime: 0,
            lastMoveTime: Date.now(),
            lastSaveAt: 0,
            superCharges: 0,
            killsSinceSuperCharge: 0,
            shieldUntil: 0,
            currentRoom: roomId
        };

        socket.emit('match_found', {
            matchId: roomId, role: 'Player',
            spawnX: Math.round(sx), spawnY: Math.round(sy), spawnHeading: 0,
            opponentId: '', serverId: socket.id,
            wave: room.wave, playerLevel: startLevel,
            mode: socket.mode, maxHp: stats.hp, maxSpeed: stats.speed,
            torpedoSpeed: getTorpedoSpeed(room),
            worldSize: room.worldSize, islands: room.islands || [],
            hullId: room.players[socket.uid].hullId,
            skinPath: room.players[socket.uid].skinPath,
            slotNumber: assignedSlot, tier: room.tier, xp: startXp
        });

        const packsPayload = Object.values(room.healthPacks).map(hp => ({
            id: hp.id, x: Math.round(hp.x), y: Math.round(hp.y),
            remaining: Math.max(0, (hp.expiresAt - Date.now()) / 1000)
        }));
        if (packsPayload.length > 0) socket.emit('health_packs_state', packsPayload);

        if (room.bombActive) {
            socket.emit('bomb_spawned', {
                x: Math.round(room.bombX), y: Math.round(room.bombY),
                duration: (room.bombExpireAt - Date.now()) / 1000,
                expireAt: room.bombExpireAt
            });
        }

        const existing = Object.values(room.players).filter(p => p.uid !== socket.uid).map(p => ({
            id: p.id, uid: p.uid, name: p.name,
            x: Math.round(p.x), y: Math.round(p.y),
            heading: Math.round(p.heading),
            hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId,
            slotNumber: p.slotNumber || 0,
            remaining: p.offlineAt ? computeRemaining(p.offlineAt) : 0
        }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, uid: socket.uid, name: socket.username,
            x: Math.round(sx), y: Math.round(sy), heading: 0,
            hullId: room.players[socket.uid].hullId,
            skinPath: room.players[socket.uid].skinPath,
            finisherId: room.players[socket.uid].finisherId,
            slotNumber: assignedSlot
        });

        if (Object.keys(room.bots).length === 0 && !room.prisonPhase) {
            spawnWave(roomId);
        } else if (room.prisonPhase) {
            socket.emit('prison_started', {
                wave: room.wave,
                duration: Math.max(0, (room.prisonEndsAt - Date.now()) / 1000),
                barrierRadius: room.prisonBarrierRadius,
                pillarX: Math.round(room.pillarX),
                pillarY: Math.round(room.pillarY),
                totalBots: room.totalBotsForWave
            });
            emitPrisonVisibleBotsToSocket(socket, room);
        } else {
            const botsPayload = Object.values(room.bots).map(b => {
                const payload = {
                    id: b.id, x: Math.round(b.x), y: Math.round(b.y),
                    heading: Math.round(b.heading), hp: b.hp,
                    role: b.role, isChaser: !!b.isChaser, shielded: false
                };
                b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
                return payload;
            });
            socket.emit('bots_update', botsPayload);
        }
        sendLeaderboard(roomId);
    });

    socket.on('player_fired', (data) => {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p) return;
        socket.to(socket.currentRoom).emit('player_fired', {
            id: socket.id, x: data.x, y: data.y,
            heading: data.heading, hullId: data.hullId || p.hullId
        });
    });

    socket.on('player_moved', (data) => {
        if (!data) return;
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (!isFinite(data.x) || !isFinite(data.y)) return;
        if (Math.abs(data.x) > MAX_PLAYER_COORD || Math.abs(data.y) > MAX_PLAYER_COORD) return;
        const room = rooms[socket.currentRoom];
        if (!room || !room.players[socket.uid]) return;
        const p = room.players[socket.uid];
        p.x = data.x; p.y = data.y;
        p.heading = typeof data.heading === 'number' && isFinite(data.heading) ? data.heading : p.heading;
        if (data.hullId && data.hullId !== p.hullId) p.hullId = data.hullId;
        if (data.skinPath) p.skinPath = data.skinPath;
        if (data.finisherId) p.finisherId = data.finisherId;
        p.lastMoveTime = Date.now();

        if (p.isGhost) {
            p.isGhost = false;
            if (p.deathTimer) { clearTimeout(p.deathTimer); p.deathTimer = null; }
            p.offlineAt = 0;
            p.offlineReason = null;
            io.to(socket.currentRoom).emit('player_online', { id: socket.id, uid: p.uid, slotNumber: p.slotNumber });
            io.to(socket.currentRoom).emit('player_respawned', { id: socket.id, x: Math.round(p.x), y: Math.round(p.y) });
        }

        socket.to(socket.currentRoom).emit('player_moved', {
            id: socket.id, uid: p.uid,
            x: Math.round(p.x), y: Math.round(p.y),
            heading: Math.round(p.heading),
            hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId,
            slotNumber: p.slotNumber || 0,
            remaining: p.offlineAt ? computeRemaining(p.offlineAt) : 0
        });
    });

    socket.on('prison_release_request', () => {
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped || !room.prisonPhase) return;
        const p = room.players[socket.uid];
        if (!p || p.hp <= 0) return;

        const dx = p.x - room.pillarX;
        const dy = p.y - room.pillarY;
        const distSq = dx * dx + dy * dy;
        if (distSq > PRISON_PILLAR_RADIUS * PRISON_PILLAR_RADIUS) return;

        const remaining = Math.max(0, room.prisonEndsAt - Date.now());
        const remainingRatio = remaining / PRISON_DURATION_MS;
        let xpMult = PRISON_MIN_XP_MULT + remainingRatio * (PRISON_MAX_XP_MULT - PRISON_MIN_XP_MULT);
        xpMult = Math.max(PRISON_MIN_XP_MULT, Math.min(PRISON_MAX_XP_MULT, xpMult));
        xpMult = Math.round(xpMult * 100) / 100;

        releaseBots(socket.currentRoom, socket.id, p.name, xpMult);
    });

    socket.on('hit_bot', (data) => {
        if (!data || data.botId === undefined || data.botId === null) return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const bot = room.bots[data.botId];
        if (!bot || bot.hp <= 0) return;
        if (bot.inPrison) return;
        const p = room.players[socket.uid];
        if (!p) return;

        const now = Date.now();
        if (p.lastHitBotTime && (now - p.lastHitBotTime) < HIT_BOT_MIN_INTERVAL_MS) return;
        p.lastHitBotTime = now;

        if (bot.shieldUntil && now < bot.shieldUntil) {
            io.to(socket.id).emit('bot_shield_block', { botId: data.botId });
            return;
        }

        const shipTier = getShipTier(p.hullId);
        const shots = shotsNeeded(shipTier, room.tier);
        const botMaxHp = bot.maxHp || bot.hp;
        const dmgPerShot = Math.ceil(botMaxHp / shots);
        bot.hp -= dmgPerShot;

        if (bot.hp <= 0.001) {
            delete room.bots[data.botId];
            room.botsKilledThisWave++;
            p.kills = (p.kills || 0) + 1;

            awardKillXp(p, room);

            room.roomKillCounter++;
            if (room.roomKillCounter % HEALTH_DROP_EVERY_KILLS === 0) {
                const packId = room.healthPackIdCounter++;
                room.healthPacks[packId] = {
                    id: packId,
                    x: bot.x, y: bot.y,
                    expiresAt: Date.now() + HEALTH_PACK_DURATION_MS
                };
                io.to(socket.currentRoom).emit('health_pack_spawned', {
                    id: packId,
                    x: Math.round(bot.x), y: Math.round(bot.y),
                    duration: HEALTH_PACK_DURATION_MS / 1000
                });
            }

            if ((p.superCharges || 0) < MAX_SUPER_CHARGES) {
                p.killsSinceSuperCharge = (p.killsSinceSuperCharge || 0) + 1;
                if (p.killsSinceSuperCharge >= SUPER_CHARGE_EVERY_KILLS) {
                    p.killsSinceSuperCharge = 0;
                    p.superCharges = Math.min(MAX_SUPER_CHARGES, (p.superCharges || 0) + 1);
                    io.to(p.id).emit('super_charge_update', { charges: p.superCharges, progress: 0, justCharged: true });
                } else {
                    io.to(p.id).emit('super_charge_update', {
                        charges: p.superCharges || 0,
                        progress: p.killsSinceSuperCharge,
                        justCharged: false
                    });
                }
            }

            if (!room.bombActive && room.bombSchedule) {
                room.bombKillsCount++;
                if (room.bombKillsCount >= room.bombSchedule.killsPerBomb &&
                    room.bombBombsTriggered < room.bombSchedule.bombs) {
                    room.bombKillsCount = 0;
                    room.bombBombsTriggered++;
                    triggerBomb(room, socket.currentRoom);
                }
            }

            const isWaveComplete = (room.botsKilledThisWave >= room.totalBotsForWave);
            const remainingBots = Math.max(0, room.totalBotsForWave - room.botsKilledThisWave);

            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id, byName: p.name,
                finisherId: p.finisherId || data.finisherId || 'none',
                isLastBot: isWaveComplete,
                remainingBots
            });

            if (isWaveComplete) {
                room.wave += 1;
                for (const uid in room.players) {
                    const pl = room.players[uid];
                    pl.hp = pl.maxHp;
                }
                flushWaveStats(socket.currentRoom);
                for (const uid in room.players) {
                    const pl = room.players[uid];
                    if (pl.online && pl.id && !pl.isGhost) {
                        io.to(pl.id).emit('level_up', { wave: room.wave, level: pl.level });
                        io.to(pl.id).emit('hp_update', { hp: pl.hp });
                    }
                }
                const rid = socket.currentRoom;
                safeSetTimeout(rid, () => startPrisonPhase(rid), 2500);
            }
        } else {
            io.to(socket.currentRoom).emit('bot_hp', { botId: data.botId, hp: bot.hp });
        }
    });

    socket.on('bot_hit_player', (data) => {
        if (!data) return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p || p.hp <= 0) return;

        if (p.shieldUntil && p.shieldUntil > Date.now()) {
            io.to(socket.id).emit('hp_update', { hp: p.hp });
            return;
        }

        const now = Date.now();
        const isCrash = data.source === 'crash';
        const isLethal = data.isLethal === true;

        if (!isCrash && !isLethal) {
            const cooldown = getPlayerDamageCooldownMs(room);
            if (p.lastDamageTime && (now - p.lastDamageTime) < cooldown) {
                io.to(socket.id).emit('hp_update', { hp: p.hp });
                return;
            }
        }

        let serverDamage;
        if (isLethal) serverDamage = p.hp;
        else if (isCrash) serverDamage = Math.max(botDamageForRoom(room), p.maxHp * 0.5);
        else serverDamage = botDamageForRoom(room);

        const isNewbiePlayer = p.level && p.level < NEWBIE_LEVEL_THRESHOLD;
        if (isNewbiePlayer && !isLethal) {
            serverDamage = Math.round(serverDamage / 3);
        }

        serverDamage = Math.min(serverDamage, MAX_DAMAGE_PER_HIT);

        p.lastDamageTime = now;
        p.hp -= serverDamage;
        if (!isFinite(p.hp) || p.hp < 0) p.hp = 0;

        if (p.hp <= 0) {
            p.hp = 0;
            io.to(socket.currentRoom).emit('player_died', { id: socket.id, name: p.name });
            const roomIdAtDeath = socket.currentRoom;
            const uidAtDeath = socket.uid;
            safeSetTimeout(roomIdAtDeath, () => {
                const r = rooms[roomIdAtDeath];
                if (!r || r.wiped) return;
                const remaining = Object.values(r.players);
                if (remaining.length === 0) { endRoom(roomIdAtDeath); return; }
                const allDeadAndNoGhosts = remaining.every(pl => pl.hp <= 0 && !pl.isGhost);
                if (allDeadAndNoGhosts) {
                    flushWaveStats(roomIdAtDeath);
                    io.to(roomIdAtDeath).emit('team_wipe');
                    for (const uid in r.players) { wipedRoomsLog.add(uid); setTimeout(() => wipedRoomsLog.delete(uid), 5 * 60 * 1000); }
                    endRoom(roomIdAtDeath);
                    return;
                }
                const currentPlayer = r.players[uidAtDeath];
                if (currentPlayer && currentPlayer.hp <= 0) {
                    const sp = randomSpawnNearSafe(r.worldSize / 2, r.worldSize / 2, 300, 1200, r.islands, r.worldSize, undefined);
                    currentPlayer.x = sp.x; currentPlayer.y = sp.y;
                    currentPlayer.hp = currentPlayer.maxHp;
                    currentPlayer.lastDamageTime = 0;
                    if (currentPlayer.online && currentPlayer.id) {
                        io.to(currentPlayer.id).emit('player_respawned', { x: Math.round(sp.x), y: Math.round(sp.y) });
                    }
                }
            }, RESPAWN_MS);
        } else {
            io.to(socket.id).emit('hp_update', { hp: p.hp });
        }
    });

    socket.on('health_pack_collect', (data) => {
        if (!data || data.id === undefined) return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p || p.hp <= 0) return;
        if (p.hp >= p.maxHp) return;

        const pack = room.healthPacks[data.id];
        if (!pack) return;

        const dx = p.x - pack.x;
        const dy = p.y - pack.y;
        if (Math.sqrt(dx * dx + dy * dy) > HEALTH_PACK_PICKUP_RADIUS) return;

        const healAmount = Math.round(p.maxHp * HEALTH_HEAL_PERCENT);
        p.hp = Math.min(p.maxHp, p.hp + healAmount);
        delete room.healthPacks[data.id];

        io.to(socket.id).emit('hp_update', { hp: p.hp, healed: true, healAmount: healAmount });
        io.to(socket.currentRoom).emit('health_pack_removed', { id: data.id, byId: socket.id });
    });

    socket.on('player_shield_activate', () => {
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p || p.hp <= 0) return;
        if (!p.superCharges || p.superCharges <= 0) return;
        if (p.shieldUntil && p.shieldUntil > Date.now()) return;

        p.superCharges--;
        p.shieldUntil = Date.now() + SHIELD_DURATION_MS;

        io.to(socket.currentRoom).emit('player_shield_activated', {
            id: socket.id, uid: socket.uid,
            duration: SHIELD_DURATION_MS / 1000
        });

        io.to(socket.id).emit('super_charge_update', {
            charges: p.superCharges,
            progress: p.killsSinceSuperCharge || 0,
            justCharged: false
        });
    });

    socket.on('bomb_disarm_request', () => {
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped || !room.bombActive) return;
        const p = room.players[socket.uid];
        if (!p) return;

        const dx = p.x - room.bombX;
        const dy = p.y - room.bombY;
        if (dx * dx + dy * dy > BOMB_DISARM_RADIUS * BOMB_DISARM_RADIUS) return;

        room.bombActive = false;
        if (room.bombTimerHandle) { clearTimeout(room.bombTimerHandle); room.bombTimerHandle = null; }

        io.to(socket.currentRoom).emit('bomb_disarmed', {
            x: Math.round(room.bombX), y: Math.round(room.bombY),
            byId: socket.id, byName: p.name
        });

        for (const uid in room.players) {
            const pl = room.players[uid];
            if (!pl) continue;
            let gain = BOMB_DISARM_XP;
            if (pl.level && pl.level < NEWBIE_LEVEL_THRESHOLD) {
                gain = Math.round(gain * NEWBIE_XP_MULTIPLIER);
            }
            applyXpGain(pl, gain);
        }

        if (room.botsSpawnedThisWave < room.totalBotsForWave) {
            const need = room.totalBotsForWave - room.botsSpawnedThisWave;
            const canSpawn = Math.min(need, MAX_BOTS_ON_FIELD - Object.keys(room.bots).length);
            for (let i = 0; i < canSpawn; i++) {
                // ⭐ هؤلاء يظهرون حول اللاعب (surprise) لأنهم هجوم مضاد فوري
                spawnSingleBot(room, p.x, p.y, SURPRISE_SPAWN_MIN, SURPRISE_SPAWN_MAX,
                    botHPForRoom(room), true, p.heading);
            }
        }
    });

    socket.on('leave_match', () => leaveRoom(socket, true));
    socket.on('temp_leave_match', () => leaveRoom(socket, false));
});

function leaveRoom(socket, immediate) {
    const roomId = socket.currentRoom;
    const room = roomId ? rooms[roomId] : null;
    if (!room) { cleanSocket(socket); return; }
    const playerUid = socket.uid;
    const socketId = socket.id;
    const player = room.players[playerUid];
    if (!player) { cleanSocket(socket); return; }

    if (immediate) {
        if (player.deathTimer) { clearTimeout(player.deathTimer); player.deathTimer = null; }
        savePlayerForce(player);
        const finalize = () => {
            const r = rooms[roomId];
            if (!r || !r.players[playerUid]) return;
            io.to(roomId).emit('player_removed', {
                id: player.id, uid: playerUid, slotNumber: player.slotNumber
            });
            delete r.players[playerUid];
            io.to(roomId).emit('player_left', { id: socketId });
            const s = io.sockets.sockets.get(socketId);
            if (s) { s.leave(roomId); cleanSocket(s); }
            const remaining = Object.values(r.players);
            if (remaining.length === 0) { endRoom(roomId); return; }
            const anyOnlineAlive = remaining.some(pl => pl.online && pl.hp > 0 && !pl.isGhost);
            if (!anyOnlineAlive) {
                io.to(roomId).emit('team_wipe');
                endRoom(roomId);
            }
        };
        finalize();
    } else {
        player.online = false;
        if (!player.offlineAt) {
            player.offlineAt = Date.now();
            player.offlineReason = "temp_leave";
            io.to(roomId).emit('player_offline', {
                id: socketId, uid: playerUid, name: player.name, slotNumber: player.slotNumber,
                offlineAt: player.offlineAt, remaining: OFFLINE_GRACE_SECONDS
            });
        }
        savePlayerForce(player);
        if (player.deathTimer) clearTimeout(player.deathTimer);
        player.deathTimer = setTimeout(() => {
            const r = rooms[roomId];
            if (!r || r.wiped) return;
            if (!r.players[playerUid]) return;
            savePlayerForce(r.players[playerUid]);
            io.to(roomId).emit('player_removed', {
                id: r.players[playerUid].id, uid: playerUid, slotNumber: r.players[playerUid].slotNumber
            });
            delete r.players[playerUid];
            const remaining = Object.values(r.players);
            if (remaining.length === 0) { endRoom(roomId); return; }
            const anyOnlineAlive = remaining.some(pl => pl.online && pl.hp > 0 && !pl.isGhost);
            if (!anyOnlineAlive) {
                io.to(roomId).emit('team_wipe');
                endRoom(roomId);
            }
        }, OFFLINE_DEATH_MS);
    }
}

app.get('/', (req, res) => res.send('Grand3D XP/Tier v6.4 - Edge Spawn + Smart Islands + Random Bomb/Pillar'));

setInterval(() => {
    const now = Date.now();
    for (const id in rooms) {
        const r = rooms[id];
        if (Object.keys(r.players).length === 0 && (now - r.createdAt) > 30000) endRoom(id);
    }
}, 60000);

setInterval(() => {
    for (const [partyId, party] of activeParties.entries()) {
        if (party.members.length === 0) {
            activeParties.delete(partyId);
            partyRoomMap.delete(partyId);
            partyRoomLocks.delete(partyId);
        }
    }
}, 30000);

server.listen(PORT, () => console.log(`Server v6.3 running on port ${PORT}`));
