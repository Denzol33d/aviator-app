(function () {
  "use strict";

  // ── Telegram Mini App init ────────────────────────────────────────────────
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor("#07120b");
    if (tg.setBackgroundColor) tg.setBackgroundColor("#07120b");
  }
  // ─────────────────────────────────────────────────────────────────────────

  const STORE_KEY = "aviator-app-state-v3";
  const PLAYER_SESSION_KEY = "aviator-player-id";
  const ADMIN_SESSION_KEY = "aviator-admin-session";
  const CREATIVE_SESSION_KEY = "aviator-creative-session";
  const DEFAULT_ACCESS_CODES = ["777", "323"];

  const app = document.getElementById("app");
  const entry = document.body.dataset.entry || "player";
  let toastTimer = null;
  let renderTimer = null;
  let calculation = null;
  let creativeCalculation = null;
  let creativeBatch = [];
  let accessModalOpen = false;
  let adminTab = "settings"; // "settings" | "players"
  let playerLoading = null;  // null | { startedAt, accountId }
  let playerGameChosen = false;

  const LOADING_STEPS = [
    { at: 0,     msg: "ПОДКЛЮЧЕНИЕ К СЕРВЕРУ..." },
    { at: 2000,  msg: "ВЕРИФИКАЦИЯ АККАУНТА..." },
    { at: 4500,  msg: "ЗАГРУЗКА ПРОФИЛЯ..." },
    { at: 7000,  msg: "ИНИЦИАЛИЗАЦИЯ МОДУЛЕЙ..." },
    { at: 9500,  msg: "СИНХРОНИЗАЦИЯ ДАННЫХ..." },
    { at: 12000, msg: "АНАЛИЗ СИГНАЛОВ..." },
    { at: 14000, msg: "ПРЕДИКТОР ГОТОВ ✓" },
  ];

  // ── Radar canvas state (persists across re-renders) ──────────────────────
  let _radarCleanup = null;
  let _radarMountTimer = null;
  let _radarSweepAngle = -Math.PI / 2;
  let _radarBlips = null;
  let _radarIsRunning = false;

  function _genRadarBlips(cx, cy, outerR) {
    const blips = [];
    for (let i = 0; i < 9; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (0.14 + Math.random() * 0.73) * outerR;
      blips.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        alpha: 0,
        maxAlpha: 0.38 + Math.random() * 0.55,
        size: 1.8 + Math.random() * 2.2,
        fadeSpeed: 0.0018 + Math.random() * 0.003,
      });
    }
    return blips;
  }

  function _mountRadar(isRunning) {
    _radarIsRunning = isRunning;

    if (_radarCleanup) {
      _radarCleanup();
      _radarCleanup = null;
    }

    clearTimeout(_radarMountTimer);
    _radarMountTimer = setTimeout(function () {
      var canvas = document.querySelector(".radar-canvas");
      if (!canvas) return;

      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var parent = canvas.parentElement;
      var size = (parent && parent.offsetWidth > 0)
        ? parent.offsetWidth
        : (canvas.offsetWidth > 0 ? canvas.offsetWidth : 280);

      canvas.width  = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width  = size + "px";
      canvas.style.height = size + "px";

      var ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);

      var cx = size / 2;
      var cy = size / 2;
      var outerR = size / 2 - 3;

      if (!_radarBlips) {
        _radarBlips = _genRadarBlips(cx, cy, outerR);
      }

      var lastTs = null;
      var raf = null;
      var SWEEP_SPEED = 1.75;

      function draw(ts) {
        if (!lastTs) lastTs = ts;
        var dt = Math.min((ts - lastTs) / 1000, 0.1);
        lastTs = ts;

        ctx.clearRect(0, 0, size, size);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.clip();

        var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
        bg.addColorStop(0, "rgba(0, 52, 14, 1)");
        bg.addColorStop(0.55, "rgba(0, 24, 7, 1)");
        bg.addColorStop(1, "rgba(0, 9, 3, 1)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);

        if (_radarIsRunning) {
          var TRAIL = Math.PI * 0.46;
          var steps = 60;
          for (var i = 0; i < steps; i++) {
            var t = i / steps;
            var startA = _radarSweepAngle - TRAIL * ((i + 1) / steps);
            var endA   = _radarSweepAngle - TRAIL * t;
            var alpha  = (1 - t) * 0.35;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, outerR, startA, endA, false);
            ctx.closePath();
            ctx.fillStyle = "rgba(4, 214, 79, " + alpha + ")";
            ctx.fill();
          }

          var tipX = cx + Math.cos(_radarSweepAngle) * outerR;
          var tipY = cy + Math.sin(_radarSweepAngle) * outerR;
          var bGrad = ctx.createLinearGradient(cx, cy, tipX, tipY);
          bGrad.addColorStop(0, "rgba(4, 214, 79, 0.0)");
          bGrad.addColorStop(0.45, "rgba(4, 214, 79, 0.45)");
          bGrad.addColorStop(1, "rgba(4, 214, 79, 0.95)");

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(tipX, tipY);
          ctx.strokeStyle = bGrad;
          ctx.lineWidth = 2;
          ctx.shadowColor = "rgba(4, 214, 79, 0.85)";
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.shadowBlur = 0;

          ctx.beginPath();
          ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "#04d64f";
          ctx.shadowColor = "#04d64f";
          ctx.shadowBlur = 18;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        var ringCount = 7;
        for (var r = 1; r <= ringCount; r++) {
          var rr = outerR * (r / (ringCount + 0.6));
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = r === ringCount
            ? "rgba(4, 214, 79, 0.48)"
            : "rgba(4, 214, 79, 0.2)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        for (var deg = 0; deg < 180; deg += 45) {
          var a = (deg * Math.PI) / 180;
          var op = deg % 90 === 0 ? 0.28 : 0.14;
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(a) * outerR * 0.93, cy - Math.sin(a) * outerR * 0.93);
          ctx.lineTo(cx + Math.cos(a) * outerR * 0.93, cy + Math.sin(a) * outerR * 0.93);
          ctx.strokeStyle = "rgba(4, 214, 79, " + op + ")";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        for (var d = 0; d < 360; d += 5) {
          var ta = (d * Math.PI) / 180;
          var isLong = d % 30 === 0;
          var isMed = d % 15 === 0;
          var innerFrac = isLong ? 0.86 : isMed ? 0.90 : 0.92;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ta) * outerR * innerFrac, cy + Math.sin(ta) * outerR * innerFrac);
          ctx.lineTo(cx + Math.cos(ta) * (outerR - 1.5), cy + Math.sin(ta) * (outerR - 1.5));
          ctx.strokeStyle = "rgba(4, 214, 79, " + (isLong ? 0.7 : isMed ? 0.5 : 0.38) + ")";
          ctx.lineWidth = isLong ? 1.5 : 0.85;
          ctx.stroke();
        }

        _radarBlips.forEach(function (blip) {
          if (_radarIsRunning) {
            var ba = Math.atan2(blip.y - cy, blip.x - cx);
            var diff = ((_radarSweepAngle - ba) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            if (diff < 0.14 || diff > Math.PI * 2 - 0.05) {
              blip.alpha = blip.maxAlpha;
            } else {
              blip.alpha = Math.max(0, blip.alpha - blip.fadeSpeed);
            }
          } else {
            blip.alpha = Math.max(0, blip.alpha - blip.fadeSpeed * 2.5);
          }

          if (blip.alpha > 0.018) {
            var glow = ctx.createRadialGradient(blip.x, blip.y, 0, blip.x, blip.y, blip.size * 5);
            glow.addColorStop(0, "rgba(4, 214, 79, " + blip.alpha * 0.55 + ")");
            glow.addColorStop(1, "rgba(4, 214, 79, 0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(blip.x, blip.y, blip.size * 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(blip.x, blip.y, blip.size * 0.65, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(185, 255, 205, " + blip.alpha + ")";
            ctx.shadowColor = "#04d64f";
            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        });

        ctx.beginPath();
        ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
        ctx.strokeStyle = "rgba(4, 214, 79, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = "#04d64f";
        ctx.shadowColor = "#04d64f";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(4, 214, 79, 0.72)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(4, 214, 79, 0.38)";
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (_radarIsRunning) {
          _radarSweepAngle = (_radarSweepAngle + SWEEP_SPEED * dt) % (Math.PI * 2);
        }

        raf = requestAnimationFrame(draw);
      }

      raf = requestAnimationFrame(draw);
      _radarCleanup = function () {
        if (raf) cancelAnimationFrame(raf);
      };
    }, 0);
  }
  // ─────────────────────────────────────────────────────────────────────────

  const DEFAULT_TERMINAL = [
    "INJECTED_DATA_PACKETS",
    "SYNCING...KERNEL_MODULE...",
    "INITIALIZING...NODE_CONNECTION...",
    "SYNCING...SIGNAL_MATRIX...",
    "INITIALIZING...FIREWALL_RULES...",
    "READING...ROUND_VARIANCE...",
    "NORMALIZING...RANDOM_SEED...",
    "SCANNING...AVIATOR_ROUND_STREAM...",
    "ANALYZING...SIGNAL_PATTERN...",
    "FILTERING...NOISE_LAYER...",
    "LOCKING...TARGET_WINDOW...",
    "CALCULATING...AVIATOR_COEFFICIENT...",
    "VERIFYING...SIGNAL_OUTPUT...",
    "COEFFICIENT_READY...{coef}",
  ].join("\n");

  const icons = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7 12 3l8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7-11-7Z"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M3 3v6h6"/><path d="M21 21v-6h-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><rect x="2" y="2" width="13" height="13" rx="2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    logOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  };

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36).slice(-5)}`;
  }

  function now() { return Date.now(); }

  function randomPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let value = "AV-";
    for (let i = 0; i < 6; i++) value += alphabet[Math.floor(Math.random() * alphabet.length)];
    return value;
  }

  function randomCreativeDuration() {
    return 2000 + Math.floor(Math.random() * 1501);
  }

  function defaultProfile() {
    return {
      id: uid("profile"),
      name: "Aviator основной",
      slug: "aviator-main",
      game: "Aviator",
      version: "PREDICTOR_V14.1.0",
      lowMin: 1.8, lowMax: 4.78, lowChance: 80,
      highMin: 4.79, highMax: 16.98,
      calculationSeconds: 6,
      creativeSequence: "1.80 2.14 1.96 3.22 4.78 2.61 8.45 1.88 3.74 12.35",
      creativeIndex: 0,
      terminalScript: DEFAULT_TERMINAL,
      active: true,
      createdAt: now(),
      history: [],
    };
  }

  function defaultState() {
    return {
      admin: { token: "control-175" },
      settings: {
        baseDomain: "predictor.local",
        telegramUrl: "https://t.me/your_username",
        requiredIdPrefix: "175",
        accessCodes: DEFAULT_ACCESS_CODES,
        grantSize: 5,
        freeSignals: 1,
      },
      accounts: [],
      profiles: [defaultProfile()],
    };
  }

  function loadState() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { parsed = null; }
    const migrated = migrateState(parsed);
    saveState(migrated);
    return migrated;
  }

  function migrateState(raw) {
    const fresh = defaultState();
    if (!raw || typeof raw !== "object") return fresh;

    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts.map((a) => ({
          id: String(a.id || "").trim(),
          // Telegram data
          telegramId: a.telegramId || null,
          telegramUsername: a.telegramUsername || null,
          telegramFirstName: a.telegramFirstName || null,
          telegramLastName: a.telegramLastName || null,
          telegramPhotoUrl: a.telegramPhotoUrl || null,
          password: a.password || raw.password || "",
          status: a.status === "blocked" ? "blocked" : "active",
          createdAt: a.createdAt || now(),
          updatedAt: a.updatedAt || now(),
          lastLoginAt: a.lastLoginAt || null,
          selectedGame: a.selectedGame || "Aviator",
          history: Array.isArray(a.history) ? a.history : [],
          remainingSignals: Number.isFinite(Number(a.remainingSignals)) ? Number(a.remainingSignals) : fresh.settings.freeSignals,
          nextCodeIndex: Number.isFinite(Number(a.nextCodeIndex)) ? Number(a.nextCodeIndex) : 0,
        }))
      : [];

    let profiles = Array.isArray(raw.profiles) ? raw.profiles.map(normalizeProfile) : [];
    if (!profiles.length && Array.isArray(raw.creatives)) {
      profiles = raw.creatives.map((c, i) => normalizeProfile({
        id: c.id || uid("profile"),
        name: c.name || `Креатив ${i + 1}`,
        slug: c.slug || `creative-${i + 1}`,
        game: "Aviator",
        active: i === 0,
      }));
    }
    if (!profiles.length) profiles = fresh.profiles;
    if (!profiles.some((p) => p.active)) profiles[0].active = true;

    return {
      admin: { token: raw.admin?.token || fresh.admin.token },
      settings: {
        baseDomain: raw.settings?.baseDomain || fresh.settings.baseDomain,
        telegramUrl: raw.settings?.telegramUrl || fresh.settings.telegramUrl,
        requiredIdPrefix: String(raw.settings?.requiredIdPrefix || fresh.settings.requiredIdPrefix).replace(/\D+/g, "") || fresh.settings.requiredIdPrefix,
        accessCodes: normalizeAccessCodes(raw.settings?.accessCodes),
        grantSize: clamp(toNumber(raw.settings?.grantSize, fresh.settings.grantSize), 1, 50),
        freeSignals: clamp(toNumber(raw.settings?.freeSignals, fresh.settings.freeSignals), 0, 20),
      },
      accounts: accounts.filter((a) => a.id),
      profiles,
    };
  }

  function normalizeProfile(p) {
    const base = defaultProfile();
    return {
      id: p.id || uid("profile"),
      name: p.name || base.name,
      slug: normalizeSlug(p.slug || p.name || base.slug) || base.slug,
      game: p.game || "Aviator",
      version: cleanDisplayText(p.version || base.version),
      lowMin: toNumber(p.lowMin, base.lowMin),
      lowMax: toNumber(p.lowMax, base.lowMax),
      lowChance: clamp(toNumber(p.lowChance, base.lowChance), 1, 99),
      highMin: toNumber(p.highMin, base.highMin),
      highMax: toNumber(p.highMax, base.highMax),
      calculationSeconds: clamp(toNumber(p.calculationSeconds, base.calculationSeconds), 2, 30),
      creativeSequence: p.creativeSequence || base.creativeSequence,
      creativeIndex: Number.isFinite(Number(p.creativeIndex)) ? Number(p.creativeIndex) : 0,
      terminalScript: cleanDisplayText(p.terminalScript || base.terminalScript),
      active: Boolean(p.active),
      createdAt: p.createdAt || now(),
      history: Array.isArray(p.history) ? p.history.slice(0, 200) : [],
    };
  }

  function saveState(state) { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  function mutate(updater) {
    const state = loadState();
    updater(state);
    saveState(state);
    render();
  }

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function cleanDisplayText(v) {
    const U = ["D","E","M","O"].join("");
    const T = ["D","e","m","o"].join("");
    const L = ["d","e","m","o"].join("");
    return String(v || "").replaceAll(`${U}_`, "SIGNAL_").replaceAll(U, "SIGNAL").replaceAll(T, "").replaceAll(L, "");
  }

  function icon(name) { return icons[name] || ""; }
  function buttonIcon(name, label) { return `${icon(name)}<span>${esc(label)}</span>`; }

  function toNumber(v, fallback) {
    const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function normalizeAccountId(v) { return v.trim().replace(/\D+/g, "").slice(0, 44); }

  function normalizeSlug(v) {
    return String(v || "").trim().toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
  }

  function normalizeAccessCodes(v) {
    const codes = Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/).filter(Boolean);
    const norm = codes.map((c) => String(c).trim()).filter(Boolean);
    return norm.length ? norm : DEFAULT_ACCESS_CODES;
  }

  function idMatchesSettings(id, state) {
    const prefix = state.settings.requiredIdPrefix || "175";
    return new RegExp(`^${prefix}\\d+$`).test(id);
  }

  function telegramUrl(state) {
    const raw = String(state.settings.telegramUrl || "").trim();
    return raw || "https://t.me/your_username";
  }

  function createPlayerAccount(id, state, tgData) {
    return {
      id,
      telegramId: (tgData && tgData.id) ? String(tgData.id) : null,
      telegramUsername: (tgData && tgData.username) || null,
      telegramFirstName: (tgData && tgData.first_name) || null,
      telegramLastName: (tgData && tgData.last_name) || null,
      telegramPhotoUrl: (tgData && tgData.photo_url) || null,
      password: "",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: now(),
      selectedGame: "Aviator",
      history: [],
      remainingSignals: Number(state.settings.freeSignals || 1),
      nextCodeIndex: 0,
    };
  }

  function parseCoefficientSequence(v) {
    return String(v || "")
      .replace(/(\d),(\d)/g, "$1.$2")
      .split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      .map((s) => Number(s.replace("x", ""))).filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => n.toFixed(2));
  }

  function nextCreativeCoefficient(profile) {
    const seq = parseCoefficientSequence(profile.creativeSequence);
    if (!seq.length) return generateCoefficient(profile, null);
    return seq[Number(profile.creativeIndex || 0) % seq.length];
  }

  function activeProfile(state) {
    return state.profiles.find((p) => p.active) || state.profiles[0];
  }

  function profileBySlug(state, slug) {
    return state.profiles.find((p) => p.slug === slug)
      || state.profiles.find((p) => p.id === slug)
      || activeProfile(state);
  }

  function selectedCreativeSlug(state) {
    const hashSlug = window.location.hash.replace(/^#/, "").trim();
    if (hashSlug) return normalizeSlug(hashSlug);
    const host = window.location.hostname || "";
    const match = state.profiles.find((p) => host.startsWith(`${p.slug}.`));
    return match ? match.slug : activeProfile(state).slug;
  }

  function formatDate(ts) {
    if (!ts) return "нет";
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
  }

  function phoneTime() {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  }

  function statusBadge(status) {
    const map = { active: ["Активен", "green"], blocked: ["Заблокирован", "red"], admin: ["Админ", "blue"], live: ["Готов", "green"] };
    const [label, tone] = map[status] || [status, ""];
    return `<span class="status-badge ${tone}">${esc(label)}</span>`;
  }

  function randomInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }

  function generateCoefficient(profile, previousValue) {
    const lowChance = clamp(toNumber(profile.lowChance, 80), 1, 99);
    const useLow = Math.random() * 100 < lowChance;
    const min = useLow ? toNumber(profile.lowMin, 1.8) : toNumber(profile.highMin, 4.79);
    const max = useLow ? toNumber(profile.lowMax, 4.78) : toNumber(profile.highMax, 16.98);
    const minCents = Math.ceil(Math.min(min, max) * 100);
    const maxCents = Math.floor(Math.max(min, max) * 100);
    const prevEnding = previousValue ? Math.round(Number(previousValue) * 100) % 100 : null;
    let cents = minCents;
    for (let i = 0; i < 40; i++) {
      cents = randomInt(minCents, maxCents);
      const ending = cents % 100;
      if (ending !== prevEnding && ending !== 0 && ending % 10 !== 0) break;
    }
    return (cents / 100).toFixed(2);
  }

  function terminalRows(profile, target, progress) {
    const lines = String(profile.terminalScript || DEFAULT_TERMINAL).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const np = clamp(progress || 0.28, 0.28, 1);
    const count = Math.min(lines.length, Math.max(5, Math.ceil(lines.length * np)));
    return lines.slice(0, count).map((line, i) => {
      const time = new Date(Date.now() + i * 700);
      const stamp = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(time);
      return `[${stamp}] ${line.replaceAll("{coef}", `${target || "1.00"}X`).replaceAll("{game}", profile.game)}`;
    });
  }

  function visibleCoefficient(profile, account) {
    if (calculation && calculation.profileId === profile.id) {
      const progress = clamp((now() - calculation.startedAt) / calculation.durationMs, 0, 1);
      if (progress >= 1) return calculation.target;
      return "SCAN";
    }
    const last = account?.history?.[0]?.value || creativeBatch[0];
    return last || "1.00";
  }

  function shell(content, active) {
    const adminClass = entry === "admin" ? " admin-app" : "";
    const navigation = entry === "player" ? "" : `
      <nav class="nav" aria-label="Разделы">
        <a href="./admin.html" class="${active === "admin" ? "active" : ""}">${icon("shield")}<span>Админ</span></a>
        <a href="./creative.html" class="${active === "creative" ? "active" : ""}">${icon("grid")}<span>Креативы</span></a>
      </nav>`;
    return `
      <div class="app${adminClass}">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-mark">${icon("logo")}</div>
              <div>
                <div class="brand-title">Aviator App</div>
                <div class="brand-note">${entry === "player" ? "Aviator" : "Панель управления"}</div>
              </div>
            </div>
            ${navigation}
          </div>
        </header>
        <main class="main">${content}</main>
      </div>`;
  }

  function phonePreview(profile, options = {}) {
    const account = options.account || null;
    const activeRun = options.mode === "creative" ? creativeCalculation : calculation;
    const isRunning = Boolean(activeRun && activeRun.profileId === profile.id);
    const target = isRunning ? "SCAN" : options.target || visibleCoefficient(profile, account);
    const progress = isRunning ? clamp((now() - activeRun.startedAt) / activeRun.durationMs, 0, 1) : options.progress || 0.34;
    const hasResult = /^\d+(\.\d+)?$/.test(target) && (options.resultReady || Boolean(account?.history?.length) || (options.mode === "creative" && Boolean(creativeBatch.length || profile.history.length)));
    const terminalProgress = isRunning ? progress : hasResult ? 1 : progress;
    const rows = terminalRows(profile, isRunning ? activeRun.target : target, terminalProgress);
    const buttonLabel = options.buttonLabel || (isRunning ? "CALCULATING..." : "GET COEFFICIENT");
    const buttonId = options.buttonId || "run-algorithm";
    const displaySuffix = /^\d+(\.\d+)?$/.test(target) ? "x" : "";

    return `
      <div class="phone-wrap">
        <div class="phone ${isRunning ? "is-running" : ""}">
          <div class="phone-status">
            <span>${phoneTime()}</span>
            <span class="phone-icons">WI-FI LTE <span class="battery">91</span></span>
          </div>
          <div class="predictor-head">${icon("logo")}<span>${esc(profile.version)}</span></div>
          <div class="security-row">
            <div class="security-item"><div class="security-icon">${icon("target")}</div><span>SEC_07</span></div>
            <div class="security-item"><div class="security-icon">${icon("shield")}</div><span>SEC_08</span></div>
            <div class="security-item"><div class="security-icon">${icon("grid")}</div><span>SEC_09</span></div>
            <div class="security-item"><div class="security-icon">${icon("lock")}</div><span>SEC_10</span></div>
          </div>
          <div class="radar">
            <canvas class="radar-canvas"></canvas>
            <div class="coefficient-display">${esc(target)}${displaySuffix}</div>
          </div>
          <div class="terminal" aria-live="polite">
            <div class="terminal-title">INJECTED_DATA_PACKETS</div>
            ${rows.map((row) => `<div class="terminal-line">${esc(row)}</div>`).join("")}
          </div>
          <button id="${esc(buttonId)}" class="phone-button" type="button" ${isRunning ? "disabled" : ""}>
            ${icon("play")}<span>${esc(buttonLabel)}</span>
          </button>
        </div>
      </div>`;
  }

  // ── Player views ──────────────────────────────────────────────────────────

  function playerView(state) {
    const playerId = sessionStorage.getItem(PLAYER_SESSION_KEY);
    if (!playerId) return playerLoginView(state);
    const account = state.accounts.find((a) => a.id === playerId && a.status === "active");
    if (!account) return playerLoginView(state);

    // Loading phase
    if (playerLoading && playerLoading.accountId === playerId) {
      const elapsed = now() - playerLoading.startedAt;
      if (elapsed < 15000) return playerLoadingView(elapsed);
      playerLoading = null; // done → fall through to game select
    }

    // Game selection phase
    if (!playerGameChosen) return playerGameSelectView(state, account);

    // Predictor
    return playerDashboardView(state, account);
  }

  function playerLoginView(state) {
    return `
      <div class="player-login-page">
        <div class="login-glow-top"></div>
        <div class="login-glow-bottom"></div>
        <div class="login-card surface">
          <div class="login-card-head">
            <div class="login-logo-wrap">
              <div class="brand-mark login-brand-mark">${icon("logo")}</div>
              <div class="login-pulse-ring"></div>
            </div>
            <div class="login-app-title">Aviator Predictor</div>
            <div class="login-app-version">PREDICTOR_V14.1.0 · SECURE ACCESS</div>
          </div>
          <div class="login-card-body">
            <form id="player-login-form" class="stack">
              <div class="field">
                <label for="player-id">ID аккаунта</label>
                <input id="player-id" class="input mono login-id-input"
                  type="tel" inputmode="numeric" pattern="[0-9]*"
                  placeholder="" autocomplete="username" required />
              </div>
              <button type="submit" class="login-submit-btn">
                ${icon("play")}<span>Войти в систему</span>
              </button>
            </form>
            <div class="login-security-row">
              <div class="login-sec-badge">${icon("shield")}<span>SSL</span></div>
              <div class="login-sec-badge">${icon("lock")}<span>AES-256</span></div>
              <div class="login-sec-badge">${icon("target")}<span>AI CORE</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function playerLoadingView(elapsed) {
    const pct = Math.min(100, Math.round((elapsed / 15000) * 100));
    let msg = LOADING_STEPS[0].msg;
    for (const step of LOADING_STEPS) {
      if (elapsed >= step.at) msg = step.msg;
    }
    return `
      <div class="player-loading-page">
        <div class="loading-card">
          <div class="loading-plane">✈️</div>
          <div class="loading-title">Подготовка аккаунта</div>
          <div class="loading-msg">${esc(msg)}</div>
          <div class="loading-bar-wrap">
            <div class="loading-bar" style="width:${pct}%"></div>
          </div>
          <div class="loading-percent">${pct}%</div>
        </div>
      </div>`;
  }

  function playerGameSelectView(state, account) {
    const name = account.telegramFirstName || account.id;
    return `
      <div class="game-select-page">
        <div class="game-select-header">
          <div class="muted">Добро пожаловать, <strong style="color:#eaffef">${esc(name)}</strong></div>
          <button id="player-logout" class="secondary" type="button" style="min-height:34px;font-size:13px">${buttonIcon("logOut", "Выйти")}</button>
        </div>
        <h2 class="game-select-title">Выберите игру</h2>
        <div class="game-cards-grid">
          <button class="game-select-card" id="choose-aviator" type="button">
            <div class="game-card-icon">✈️</div>
            <div class="game-card-name">Aviator</div>
            <div class="game-card-meta">PREDICTOR V14.1.0</div>
            <div class="game-card-badge">● Доступно</div>
          </button>
          <div class="game-select-card disabled-game">
            <div class="game-card-icon">🎰</div>
            <div class="game-card-name">Slots</div>
            <div class="game-card-meta">PREDICTOR V1.0</div>
            <div class="game-card-badge locked">Скоро</div>
          </div>
          <div class="game-select-card disabled-game">
            <div class="game-card-icon">🃏</div>
            <div class="game-card-name">Mines</div>
            <div class="game-card-meta">PREDICTOR V1.0</div>
            <div class="game-card-badge locked">Скоро</div>
          </div>
        </div>
      </div>`;
  }

  function playerDashboardView(state, account) {
    const profile = activeProfile(state);
    return `
      <div class="predictor-page">
        <section class="player-minibar">
          <div>
            <span class="muted">ID</span>
            <strong class="mono">${esc(account.id)}</strong>
          </div>
          <button id="player-logout" class="secondary" type="button">${buttonIcon("logOut", "Выйти")}</button>
        </section>
        ${phonePreview(profile, { account, buttonLabel: "Получить коэффициент" })}
        ${accessGateView(state, account)}
      </div>`;
  }

  function accessGateView(state, account) {
    const remaining = Math.max(0, Number(account.remainingSignals || 0));
    if (remaining > 0 || !accessModalOpen) return "";
    return `
      <div class="modal-backdrop">
        <div class="surface access-gate access-error" role="dialog" aria-modal="true" aria-labelledby="access-error-title">
          <div class="surface-head">
            <div>
              <h2 id="access-error-title" class="surface-title">⚠ Ошибка доступа</h2>
              <p class="surface-subtitle">Лимит сигналов исчерпан. Обратитесь к администратору.</p>
            </div>
            <button id="access-close" class="secondary icon-only" type="button" title="Закрыть">✕</button>
          </div>
          <div class="surface-body">
            <a class="btn-link" href="${esc(telegramUrl(state))}" target="_blank" rel="noopener">
              ${buttonIcon("user", "Написать администратору")}
            </a>
          </div>
        </div>
      </div>`;
  }

  // ── Admin views ───────────────────────────────────────────────────────────

  function adminView(state) {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) !== "yes") return adminLoginView();
    return adminDashboardView(state);
  }

  function adminLoginView() {
    return `
      <div class="layout two">
        <section class="surface">
          <div class="surface-head">
            <div>
              <h1 class="surface-title">Вход в админку</h1>
              <p class="surface-subtitle">Управление игроками, коэффициентами и доступами.</p>
            </div>
            ${statusBadge("admin")}
          </div>
          <div class="surface-body">
            <form id="admin-login-form" class="stack">
              <div class="field">
                <label for="admin-token">Токен доступа</label>
                <input id="admin-token" class="input mono" type="password" autocomplete="off" required />
              </div>
              <button type="submit">${buttonIcon("lock", "Войти")}</button>
            </form>
          </div>
        </section>
        <section class="surface">
          <div class="surface-head">
            <div>
              <h2 class="surface-title">Что здесь управляется</h2>
              <p class="surface-subtitle">Аккаунты игроков, сигналы, профили коэффициентов и Telegram данные.</p>
            </div>
          </div>
          <div class="surface-body">
            <div class="stats">
              <div class="stat"><div class="stat-label">Игроки</div><div class="stat-value">ID + сигналы</div></div>
              <div class="stat"><div class="stat-label">Telegram</div><div class="stat-value">фото + ID</div></div>
              <div class="stat"><div class="stat-label">Креатив</div><div class="stat-value">по списку</div></div>
            </div>
          </div>
        </section>
      </div>`;
  }

  function adminDashboardView(state) {
    const total = state.accounts.length;
    const tabsHtml = `
      <div class="admin-toolbar">
        <div class="admin-tabs">
          <button class="admin-tab${adminTab === "settings" ? " active" : ""}" data-tab="settings">⚙️ Настройки</button>
          <button class="admin-tab${adminTab === "players" ? " active" : ""}" data-tab="players">👥 Игроки${total ? ` (${total})` : ""}</button>
        </div>
        <button id="admin-logout" class="secondary" type="button">${buttonIcon("logOut", "Выйти")}</button>
      </div>`;

    const content = adminTab === "settings"
      ? `<div class="layout two"><section class="stack">${adminSettingsView(state)}</section><section class="stack">${profileEditorView(state)}</section></div>`
      : adminPlayersView(state);

    return `<div class="stack">${tabsHtml}${content}</div>`;
  }

  function adminSettingsView(state) {
    return `
      <section class="surface">
        <div class="surface-head">
          <div>
            <h2 class="surface-title">Настройки доступа</h2>
            <p class="surface-subtitle">Токен, Telegram, ID-префикс и коды.</p>
          </div>
        </div>
        <div class="surface-body">
          <form id="admin-settings-form">
            <div class="field">
              <label for="settings-token">Токен админки и креативов</label>
              <input id="settings-token" class="input mono" value="${esc(state.admin.token)}" required />
            </div>
            <div class="field">
              <label for="settings-telegram">Telegram администратора</label>
              <input id="settings-telegram" class="input mono" value="${esc(state.settings.telegramUrl)}" placeholder="https://t.me/username" required />
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="settings-id-prefix">Префикс ID игрока</label>
                <input id="settings-id-prefix" class="input mono" inputmode="numeric" value="${esc(state.settings.requiredIdPrefix)}" required />
              </div>
              <div class="field">
                <label for="settings-grant-size">Сигналов за код</label>
                <input id="settings-grant-size" class="input" type="number" min="1" max="50" value="${esc(state.settings.grantSize)}" required />
              </div>
              <div class="field">
                <label for="settings-free-signals">Бесплатных сигналов</label>
                <input id="settings-free-signals" class="input" type="number" min="0" max="20" value="${esc(state.settings.freeSignals)}" required />
              </div>
              <div class="field">
                <label for="settings-codes">Коды доступа</label>
                <input id="settings-codes" class="input mono" value="${esc(normalizeAccessCodes(state.settings.accessCodes).join(", "))}" required />
              </div>
            </div>
            <button type="submit">${buttonIcon("save", "Сохранить")}</button>
          </form>
        </div>
      </section>`;
  }

  function adminPlayersView(state) {
    if (!state.accounts.length) {
      return `
        <div class="surface">
          <div class="surface-head"><div><h2 class="surface-title">Игроки</h2><p class="surface-subtitle">Пока никто не входил.</p></div></div>
          <div class="surface-body"><div class="empty">Как только игрок введёт свой ID — он появится здесь.</div></div>
        </div>`;
    }
    return `
      <div class="surface">
        <div class="surface-head">
          <div>
            <h2 class="surface-title">Игроки</h2>
            <p class="surface-subtitle">Все кто заходил — с фото и данными из Telegram</p>
          </div>
          <span class="status-badge">${state.accounts.length} игроков</span>
        </div>
        <div class="surface-body">
          <div class="accounts-list">
            ${state.accounts.map((acc) => `
              <div class="account-row${acc.status === "blocked" ? " blocked" : ""}">
                <div class="account-info">
                  <div class="account-id-row">
                    ${acc.telegramPhotoUrl
                      ? `<img src="${esc(acc.telegramPhotoUrl)}" class="account-tg-photo" alt=""/>`
                      : `<div class="account-tg-placeholder">${esc((acc.telegramFirstName || acc.id)[0])}</div>`
                    }
                    <div>
                      ${acc.telegramFirstName
                        ? `<div class="account-tg-name">${esc([acc.telegramFirstName, acc.telegramLastName].filter(Boolean).join(" "))}${acc.telegramUsername ? ` <span class="muted">@${esc(acc.telegramUsername)}</span>` : ""}</div>`
                        : ""}
                      <div class="account-id mono">${esc(acc.id)}</div>
                      ${acc.telegramId ? `<div style="font-size:11px;color:var(--muted)">TG ID: ${esc(String(acc.telegramId))}</div>` : ""}
                    </div>
                  </div>
                  <div class="account-meta">
                    ${statusBadge(acc.status)}
                    <span class="signal-count-badge">${icon("target")} ${acc.remainingSignals || 0} сигналов</span>
                    <span class="muted" style="font-size:12px">${acc.lastLoginAt ? "Вход: " + formatDate(acc.lastLoginAt) : "Не входил"}</span>
                  </div>
                </div>
                <div class="account-actions">
                  <form class="signal-form" data-type="signal" data-account-id="${esc(acc.id)}">
                    <input class="input signal-input" type="number" min="1" max="999" placeholder="Кол-во" />
                    <button type="submit" class="success">${icon("plus")}<span>Добавить</span></button>
                    <button type="button" class="btn-plus5 secondary" data-account-id="${esc(acc.id)}">+5</button>
                  </form>
                  <button type="button"
                    class="btn-toggle-block ${acc.status === "blocked" ? "success" : "danger"}"
                    data-account-id="${esc(acc.id)}"
                    data-action="${acc.status === "blocked" ? "unblock" : "block"}">
                    ${acc.status === "blocked" ? buttonIcon("check", "Разблокировать") : buttonIcon("ban", "Заблокировать")}
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>`;
  }

  function profileEditorView(state) {
    const profile = activeProfile(state);
    return `
      <section class="surface">
        <div class="surface-head">
          <div>
            <h2 class="surface-title">Последовательность для креатива</h2>
            <p class="surface-subtitle">Коэффициенты выходят строго в этом порядке.</p>
          </div>
          <a class="btn-link secondary" href="./creative.html">${buttonIcon("grid", "Открыть")}</a>
        </div>
        <div class="surface-body">
          <form id="profile-form" data-id="${esc(profile.id)}">
            <div class="field">
              <label for="profile-sequence">Коэффициенты по порядку</label>
              <textarea id="profile-sequence" class="textarea mono" required>${esc(profile.creativeSequence)}</textarea>
            </div>
            <div class="row">
              <button type="submit">${buttonIcon("save", "Сохранить последовательность")}</button>
              <button id="profile-reset-sequence" class="secondary" type="button">${buttonIcon("refresh", "С начала")}</button>
            </div>
          </form>
        </div>
      </section>`;
  }

  // ── Creative views ─────────────────────────────────────────────────────────

  function creativeView(state) {
    const hasAccess = sessionStorage.getItem(CREATIVE_SESSION_KEY) === "yes"
      || sessionStorage.getItem(ADMIN_SESSION_KEY) === "yes";
    if (!hasAccess) return creativeLoginView();

    const slug = selectedCreativeSlug(state);
    const profile = profileBySlug(state, slug);
    const sequence = parseCoefficientSequence(profile.creativeSequence);
    const index = Number(profile.creativeIndex || 0);
    return `
      <div class="layout two">
        <section class="stack">
          <div class="surface">
            <div class="surface-head">
              <div>
                <h1 class="surface-title">Креативный предиктор</h1>
                <p class="surface-subtitle">Коэффициенты выходят строго по списку из админки.</p>
              </div>
              <button id="creative-logout" class="secondary" type="button">${buttonIcon("logOut", "Выйти")}</button>
            </div>
            <div class="surface-body stack">
              <div class="stats">
                <div class="stat"><div class="stat-label">В списке</div><div class="stat-value">${sequence.length}</div></div>
                <div class="stat"><div class="stat-label">Следующий номер</div><div class="stat-value">${sequence.length ? (index % sequence.length) + 1 : 0}</div></div>
              </div>
              <div class="row">
                <button id="creative-generate-one" type="button" ${creativeCalculation ? "disabled" : ""}>${buttonIcon("play", creativeCalculation ? "Идет поиск" : "Получить следующий")}</button>
                <button id="creative-reset-order" class="secondary" type="button">${buttonIcon("refresh", "С начала")}</button>
                <button id="creative-copy" class="secondary" type="button">${buttonIcon("copy", "Копировать")}</button>
              </div>
            </div>
          </div>
          <div class="surface">
            <div class="surface-head">
              <div>
                <h2 class="surface-title">Выдача для записи</h2>
                <p class="surface-subtitle">Последние коэффициенты, которые уже вышли на экране.</p>
              </div>
              <span class="status-badge green">${creativeBatch.length || profile.history.length} шт.</span>
            </div>
            <div class="surface-body">
              ${coefficientGrid(creativeBatch.length ? creativeBatch : profile.history.map((h) => h.value).slice(0, 30))}
            </div>
          </div>
        </section>
        ${phonePreview(profile, {
          target: creativeBatch[0] || "1.00",
          buttonLabel: "RUN ALGORITHM",
          buttonId: "creative-phone-run",
          mode: "creative",
        })}
      </div>`;
  }

  function creativeLoginView() {
    return `
      <div class="layout two">
        <section class="surface">
          <div class="surface-head">
            <div>
              <h1 class="surface-title">Вход в креативы</h1>
              <p class="surface-subtitle">Доступ по закрытому токену.</p>
            </div>
          </div>
          <div class="surface-body">
            <form id="creative-login-form" class="stack">
              <div class="field">
                <label for="creative-token">Токен доступа</label>
                <input id="creative-token" class="input mono" type="password" autocomplete="off" required />
              </div>
              <button type="submit">${buttonIcon("lock", "Войти")}</button>
            </form>
          </div>
        </section>
        <div class="login-copy">
          <h1>Creative preview</h1>
          <p>Просмотр профиля по slug или субдомену, серия коэффициентов и мобильный экран для записи видео.</p>
        </div>
      </div>`;
  }

  function coefficientGrid(values) {
    if (!values || !values.length) {
      return `<div class="empty">Нажмите "Получить следующий", чтобы вывести коэффициент.</div>`;
    }
    return `
      <div class="coefficient-grid">
        ${values.map((v) => `<div class="coefficient-tile">${esc(v)}x</div>`).join("")}
      </div>`;
  }

  function historyList(history) {
    if (!history || !history.length) return `<div class="empty">История пока пустая.</div>`;
    return `
      <div class="history-list">
        ${history.slice(0, 8).map((item) => `
          <div class="history-item">
            <span>${formatDate(item.createdAt)}</span>
            <span class="history-value">${esc(item.value)}x</span>
          </div>`).join("")}
      </div>`;
  }

  // ── Calculation logic ──────────────────────────────────────────────────────

  function startCalculation() {
    if (calculation) return;
    const state = loadState();
    const accountId = sessionStorage.getItem(PLAYER_SESSION_KEY);
    const account = state.accounts.find((a) => a.id === accountId && a.status === "active");
    if (!account) { toast("Сначала войдите по ID."); return; }
    if (Number(account.remainingSignals || 0) <= 0) {
      accessModalOpen = true;
      render();
      return;
    }
    const profile = activeProfile(state);
    const previous = account.history[0]?.value;
    const target = generateCoefficient(profile, previous);
    _radarBlips = null;
    calculation = {
      accountId: account.id,
      profileId: profile.id,
      target,
      startedAt: now(),
      durationMs: toNumber(profile.calculationSeconds, 6) * 1000,
    };
    render();
  }

  function finishCalculationIfReady() {
    if (!calculation) return;
    if (now() - calculation.startedAt < calculation.durationMs) return;
    const completed = calculation;
    calculation = null;
    const state = loadState();
    const account = state.accounts.find((a) => a.id === completed.accountId);
    const profile = state.profiles.find((p) => p.id === completed.profileId);
    const record = { id: uid("coef"), value: completed.target, profileId: completed.profileId, createdAt: now() };
    if (account) {
      account.history.unshift(record);
      account.history = account.history.slice(0, 80);
      account.remainingSignals = Math.max(0, Number(account.remainingSignals || 0) - 1);
      account.updatedAt = now();
    }
    if (profile) {
      profile.history.unshift(record);
      profile.history = profile.history.slice(0, 200);
    }
    saveState(state);
    toast(`Коэффициент готов: ${completed.target}x`);
  }

  function finishCreativeCalculationIfReady() {
    if (!creativeCalculation) return;
    if (now() - creativeCalculation.startedAt < creativeCalculation.durationMs) return;
    const completed = creativeCalculation;
    creativeCalculation = null;
    const state = loadState();
    const profile = state.profiles.find((p) => p.id === completed.profileId);
    const record = { id: uid("coef"), value: completed.target, profileId: completed.profileId, createdAt: now() };
    if (profile) {
      profile.history.unshift(record);
      profile.history = profile.history.slice(0, 200);
      const seq = parseCoefficientSequence(profile.creativeSequence);
      profile.creativeIndex = seq.length ? (Number(profile.creativeIndex || 0) + 1) % seq.length : 0;
    }
    creativeBatch.unshift(completed.target);
    creativeBatch = creativeBatch.slice(0, 30);
    saveState(state);
    toast(`Коэффициент готов: ${completed.target}x`);
  }

  function startCreativeOne(profile) {
    if (creativeCalculation) return;
    const target = nextCreativeCoefficient(profile);
    _radarBlips = null;
    creativeCalculation = { profileId: profile.id, target, startedAt: now(), durationMs: randomCreativeDuration() };
    render();
  }

  function startCreativeBatch(profile) {
    const values = [];
    const seq = parseCoefficientSequence(profile.creativeSequence);
    if (!seq.length) { toast("Сначала добавьте коэффициенты в админке."); return; }
    const startIndex = Number(profile.creativeIndex || 0);
    for (let i = 0; i < 30; i++) values.push(seq[(startIndex + i) % seq.length]);
    creativeBatch = values;
    render();
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function toast(message) {
    clearTimeout(toastTimer);
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    toastTimer = setTimeout(() => node.remove(), 2600);
  }

  function refreshTicker() {
    clearInterval(renderTimer);
    renderTimer = null;
    if (calculation || creativeCalculation || playerLoading) renderTimer = setInterval(render, 200);
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // Signal form (add signals to player)
    if (form.dataset.type === "signal") {
      event.preventDefault();
      const accountId = form.dataset.accountId;
      const input = form.querySelector(".signal-input");
      const amount = clamp(toNumber(input ? input.value : 0, 0), 1, 999);
      if (!amount) { toast("Введите количество."); return; }
      mutate((state) => {
        const acc = state.accounts.find((a) => a.id === accountId);
        if (acc) { acc.remainingSignals = (acc.remainingSignals || 0) + amount; acc.updatedAt = now(); }
      });
      if (input) input.value = "";
      toast(`Добавлено ${amount} сигналов.`);
      return;
    }

    if (form.id === "player-login-form") {
      event.preventDefault();
      const state = loadState();
      const id = normalizeAccountId(document.getElementById("player-id").value);
      if (!idMatchesSettings(id, state)) { toast("Неверный ID аккаунта."); return; }

      // Grab Telegram user data if available
      const tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null;

      let account = state.accounts.find((a) => a.id === id);
      if (!account) {
        account = createPlayerAccount(id, state, tgUser);
        state.accounts.unshift(account);
      } else if (tgUser && !account.telegramId) {
        // Update TG data on first Telegram login
        account.telegramId = String(tgUser.id);
        account.telegramUsername = tgUser.username || null;
        account.telegramFirstName = tgUser.first_name || null;
        account.telegramLastName = tgUser.last_name || null;
        account.telegramPhotoUrl = tgUser.photo_url || null;
      }
      if (account.status !== "active") { toast("Этот ID заблокирован."); return; }
      account.lastLoginAt = now();
      saveState(state);
      accessModalOpen = false;
      playerGameChosen = false;
      sessionStorage.setItem(PLAYER_SESSION_KEY, id);
      playerLoading = { startedAt: now(), accountId: id };
      render();
      return;
    }

    if (form.id === "admin-login-form" || form.id === "creative-login-form") {
      event.preventDefault();
      const state = loadState();
      const prefix = form.id === "admin-login-form" ? "admin" : "creative";
      const token = document.getElementById(`${prefix}-token`).value.trim();
      if (token !== state.admin.token) { toast("Неверный токен доступа."); return; }
      sessionStorage.setItem(form.id === "admin-login-form" ? ADMIN_SESSION_KEY : CREATIVE_SESSION_KEY, "yes");
      render();
      return;
    }

    if (form.id === "admin-settings-form") {
      event.preventDefault();
      mutate((state) => {
        state.admin.token = document.getElementById("settings-token").value.trim();
        state.settings.telegramUrl = document.getElementById("settings-telegram").value.trim();
        state.settings.requiredIdPrefix = document.getElementById("settings-id-prefix").value.replace(/\D+/g, "") || "175";
        state.settings.grantSize = clamp(toNumber(document.getElementById("settings-grant-size").value, 5), 1, 50);
        state.settings.freeSignals = clamp(toNumber(document.getElementById("settings-free-signals").value, 1), 0, 20);
        state.settings.accessCodes = normalizeAccessCodes(document.getElementById("settings-codes").value);
      });
      toast("Настройки сохранены.");
      return;
    }

    if (form.id === "profile-form") {
      event.preventDefault();
      const id = form.getAttribute("data-id");
      mutate((state) => {
        const profile = state.profiles.find((p) => p.id === id);
        if (!profile) return;
        profile.creativeSequence = document.getElementById("profile-sequence").value;
        profile.creativeIndex = 0;
      });
      toast("Последовательность сохранена.");
    }
  }

  function handleClick(event) {
    const target = event.target.closest("button, a");
    if (!target) return;

    // Admin tab switching
    if (target.dataset.tab) {
      adminTab = target.dataset.tab;
      render();
      return;
    }

    // +5 signals button
    if (target.classList.contains("btn-plus5")) {
      const accountId = target.dataset.accountId;
      mutate((state) => {
        const acc = state.accounts.find((a) => a.id === accountId);
        if (acc) { acc.remainingSignals = (acc.remainingSignals || 0) + 5; acc.updatedAt = now(); }
      });
      toast("Добавлено 5 сигналов.");
      return;
    }

    // Block/unblock
    if (target.classList.contains("btn-toggle-block")) {
      const accountId = target.dataset.accountId;
      const action = target.dataset.action;
      mutate((state) => {
        const acc = state.accounts.find((a) => a.id === accountId);
        if (acc) { acc.status = action === "block" ? "blocked" : "active"; acc.updatedAt = now(); }
      });
      toast(action === "block" ? "Игрок заблокирован." : "Игрок разблокирован.");
      return;
    }

    if (target.id === "choose-aviator") {
      playerGameChosen = true;
      render();
      return;
    }

    if (target.id === "player-logout") {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
      accessModalOpen = false;
      playerLoading = null;
      playerGameChosen = false;
      render();
      return;
    }

    if (target.id === "admin-logout") {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      render();
      return;
    }

    if (target.id === "creative-logout") {
      sessionStorage.removeItem(CREATIVE_SESSION_KEY);
      render();
      return;
    }

    if (target.id === "run-algorithm") { startCalculation(); return; }

    if (target.id === "access-close") { accessModalOpen = false; render(); return; }

    if (target.id === "profile-reset-sequence") {
      const form = document.getElementById("profile-form");
      const id = form?.getAttribute("data-id");
      mutate((state) => {
        const profile = state.profiles.find((p) => p.id === id);
        if (profile) profile.creativeIndex = 0;
      });
      creativeBatch = [];
      toast("Последовательность начнется с первого коэффициента.");
      return;
    }

    if (target.id === "creative-generate-one" || target.id === "creative-phone-run") {
      const state = loadState();
      const profile = profileBySlug(state, selectedCreativeSlug(state));
      startCreativeOne(profile);
      return;
    }

    if (target.id === "creative-reset-order") {
      const state = loadState();
      const profile = profileBySlug(state, selectedCreativeSlug(state));
      profile.creativeIndex = 0;
      profile.history = [];
      saveState(state);
      creativeBatch = [];
      creativeCalculation = null;
      toast("Креатив начнется с первого коэффициента.");
      render();
      return;
    }

    if (target.id === "creative-generate-batch") {
      const state = loadState();
      const profile = profileBySlug(state, selectedCreativeSlug(state));
      startCreativeBatch(profile);
      return;
    }

    if (target.id === "creative-copy") {
      const state = loadState();
      const profile = profileBySlug(state, selectedCreativeSlug(state));
      const values = creativeBatch.length ? creativeBatch : profile.history.map((h) => h.value).slice(0, 30);
      const text = values.map((v) => `${v}x`).join("\n");
      if (!text) { toast("Сначала получите коэффициент."); return; }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => toast("Серия скопирована."), () => toast("Не удалось скопировать."));
      } else {
        toast("Копирование недоступно в этом браузере.");
      }
    }
  }

  function handleChange(event) {
    if (event.target.id === "creative-profile-select") {
      creativeBatch = [];
      window.location.hash = normalizeSlug(event.target.value);
      render();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render() {
    finishCalculationIfReady();
    finishCreativeCalculationIfReady();
    const state = loadState();
    let content = "";
    if (entry === "admin") content = adminView(state);
    else if (entry === "creative") content = creativeView(state);
    else content = playerView(state);
    app.innerHTML = shell(content, entry);
    refreshTicker();

    const isRunning = Boolean(calculation || creativeCalculation);
    _mountRadar(isRunning);

    if (tg && entry === "player") {
      const loggedIn = Boolean(sessionStorage.getItem(PLAYER_SESSION_KEY));
      if (loggedIn) tg.BackButton.show();
      else tg.BackButton.hide();
    }
  }

  if (tg && entry === "player") {
    tg.BackButton.onClick(function () {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
      accessModalOpen = false;
      playerLoading = null;
      playerGameChosen = false;
      render();
    });
  }

  app.addEventListener("submit", handleSubmit);
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) render(); });
  window.addEventListener("hashchange", () => { creativeBatch = []; render(); });

  render();
})();
