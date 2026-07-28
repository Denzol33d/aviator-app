(function () {
  "use strict";

  // ── Telegram Mini App init ────────────────────────────────────────────────
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand(); // разворачиваем на весь экран
    // Устанавливаем цвет хедера под тему апп
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

  // ── Radar canvas state (persists across re-renders) ──────────────────────
  let _radarCleanup = null;
  let _radarMountTimer = null;
  let _radarSweepAngle = -Math.PI / 2; // start at top
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

    // Cancel previous animation
    if (_radarCleanup) {
      _radarCleanup();
      _radarCleanup = null;
    }

    // Defer until DOM is painted
    clearTimeout(_radarMountTimer);
    _radarMountTimer = setTimeout(function () {
      var canvas = document.querySelector(".radar-canvas");
      if (!canvas) return;

      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Надёжный размер: сначала родитель, затем сам элемент, fallback 280
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
      var SWEEP_SPEED = 1.75; // rad/s

      function draw(ts) {
        if (!lastTs) lastTs = ts;
        var dt = Math.min((ts - lastTs) / 1000, 0.1);
        lastTs = ts;

        ctx.clearRect(0, 0, size, size);

        // ── Clip to circle ────────────────────────────────────────────────
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.clip();

        // ── Background ───────────────────────────────────────────────────
        var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
        bg.addColorStop(0, "rgba(0, 52, 14, 1)");
        bg.addColorStop(0.55, "rgba(0, 24, 7, 1)");
        bg.addColorStop(1, "rgba(0, 9, 3, 1)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);

        // ── Sweep trail + beam ───────────────────────────────────────────
        if (_radarIsRunning) {
          var TRAIL = Math.PI * 0.46; // ~83° хвост
          var steps = 60;
          for (var i = 0; i < steps; i++) {
            var t = i / steps;
            // FIX: startA < endA — рисуем маленький сектор, не большой!
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

          // Beam line (gradient from center to tip)
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

          // Beam tip glowing dot
          ctx.beginPath();
          ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "#04d64f";
          ctx.shadowColor = "#04d64f";
          ctx.shadowBlur = 18;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // ── Concentric rings ─────────────────────────────────────────────
        var ringCount = 7;
        for (var r = 1; r <= ringCount; r++) {
          var rr = outerR * (r / (ringCount + 0.6));
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle =
            r === ringCount
              ? "rgba(4, 214, 79, 0.48)"
              : "rgba(4, 214, 79, 0.2)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // ── Cross-hair lines (4 axes = 8 directions) ─────────────────────
        for (var deg = 0; deg < 180; deg += 45) {
          var a = (deg * Math.PI) / 180;
          var op = deg % 90 === 0 ? 0.28 : 0.14;
          ctx.beginPath();
          ctx.moveTo(
            cx - Math.cos(a) * outerR * 0.93,
            cy - Math.sin(a) * outerR * 0.93
          );
          ctx.lineTo(
            cx + Math.cos(a) * outerR * 0.93,
            cy + Math.sin(a) * outerR * 0.93
          );
          ctx.strokeStyle = "rgba(4, 214, 79, " + op + ")";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // ── Outer tick marks ─────────────────────────────────────────────
        for (var d = 0; d < 360; d += 5) {
          var ta = (d * Math.PI) / 180;
          var isLong = d % 30 === 0;
          var isMed = d % 15 === 0;
          var innerFrac = isLong ? 0.86 : isMed ? 0.90 : 0.92;
          ctx.beginPath();
          ctx.moveTo(
            cx + Math.cos(ta) * outerR * innerFrac,
            cy + Math.sin(ta) * outerR * innerFrac
          );
          ctx.lineTo(
            cx + Math.cos(ta) * (outerR - 1.5),
            cy + Math.sin(ta) * (outerR - 1.5)
          );
          ctx.strokeStyle =
            "rgba(4, 214, 79, " + (isLong ? 0.7 : isMed ? 0.5 : 0.38) + ")";
          ctx.lineWidth = isLong ? 1.5 : 0.85;
          ctx.stroke();
        }

        // ── Blips ─────────────────────────────────────────────────────────
        _radarBlips.forEach(function (blip) {
          if (_radarIsRunning) {
            var ba = Math.atan2(blip.y - cy, blip.x - cx);
            var diff =
              ((_radarSweepAngle - ba) % (Math.PI * 2) + Math.PI * 2) %
              (Math.PI * 2);
            if (diff < 0.14 || diff > Math.PI * 2 - 0.05) {
              blip.alpha = blip.maxAlpha;
            } else {
              blip.alpha = Math.max(0, blip.alpha - blip.fadeSpeed);
            }
          } else {
            blip.alpha = Math.max(0, blip.alpha - blip.fadeSpeed * 2.5);
          }

          if (blip.alpha > 0.018) {
            // Glow halo
            var glow = ctx.createRadialGradient(
              blip.x,
              blip.y,
              0,
              blip.x,
              blip.y,
              blip.size * 5
            );
            glow.addColorStop(0, "rgba(4, 214, 79, " + blip.alpha * 0.55 + ")");
            glow.addColorStop(1, "rgba(4, 214, 79, 0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(blip.x, blip.y, blip.size * 5, 0, Math.PI * 2);
            ctx.fill();

            // Core dot
            ctx.beginPath();
            ctx.arc(blip.x, blip.y, blip.size * 0.65, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(185, 255, 205, " + blip.alpha + ")";
            ctx.shadowColor = "#04d64f";
            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        });

        // ── Center cross + dot ────────────────────────────────────────────
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy);
        ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx, cy + 5);
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

        ctx.restore(); // end clip

        // ── Outer border ring ─────────────────────────────────────────────
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(4, 214, 79, 0.72)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(4, 214, 79, 0.38)";
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Advance sweep angle
        if (_radarIsRunning) {
          _radarSweepAngle =
            (_radarSweepAngle + SWEEP_SPEED * dt) % (Math.PI * 2);
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
    logo:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7 12 3l8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    play:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7-11-7Z"/></svg>',
    save:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
    plus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M3 3v6h6"/><path d="M21 21v-6h-6"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><rect x="2" y="2" width="13" height="13" rx="2"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>',
    grid:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    target:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    lock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    logOut:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
  };

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now()
      .toString(36)
      .slice(-5)}`;
  }

  function now() {
    return Date.now();
  }

  function randomPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let value = "AV-";
    for (let index = 0; index < 6; index += 1) {
      value += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
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
      lowMin: 1.8,
      lowMax: 4.78,
      lowChance: 80,
      highMin: 4.79,
      highMax: 16.98,
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
      admin: {
        token: "control-175",
      },
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
    try {
      parsed = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch (error) {
      parsed = null;
    }

    const migrated = migrateState(parsed);
    saveState(migrated);
    return migrated;
  }

  function migrateState(raw) {
    const fresh = defaultState();
    if (!raw || typeof raw !== "object") return fresh;

    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts.map((account) => ({
          id: String(account.id || "").trim(),
          password: account.password || raw.password || "",
          status: account.status === "blocked" ? "blocked" : "active",
          createdAt: account.createdAt || now(),
          updatedAt: account.updatedAt || now(),
          lastLoginAt: account.lastLoginAt || null,
          selectedGame: account.selectedGame || "Aviator",
          history: Array.isArray(account.history) ? account.history : [],
          remainingSignals: Number.isFinite(Number(account.remainingSignals))
            ? Number(account.remainingSignals)
            : fresh.settings.freeSignals,
          nextCodeIndex: Number.isFinite(Number(account.nextCodeIndex))
            ? Number(account.nextCodeIndex)
            : 0,
        }))
      : [];

    let profiles = Array.isArray(raw.profiles)
      ? raw.profiles.map(normalizeProfile)
      : [];

    if (!profiles.length && Array.isArray(raw.creatives)) {
      profiles = raw.creatives.map((creative, index) =>
        normalizeProfile({
          id: creative.id || uid("profile"),
          name: creative.name || `Креатив ${index + 1}`,
          slug: creative.slug || `creative-${index + 1}`,
          game: "Aviator",
          active: index === 0,
        })
      );
    }

    if (!profiles.length) profiles = fresh.profiles;
    if (!profiles.some((profile) => profile.active)) profiles[0].active = true;

    return {
      admin: {
        token: raw.admin?.token || fresh.admin.token,
      },
      settings: {
        baseDomain: raw.settings?.baseDomain || fresh.settings.baseDomain,
        telegramUrl: raw.settings?.telegramUrl || fresh.settings.telegramUrl,
        requiredIdPrefix:
          String(raw.settings?.requiredIdPrefix || fresh.settings.requiredIdPrefix)
            .replace(/\D+/g, "") || fresh.settings.requiredIdPrefix,
        accessCodes: normalizeAccessCodes(raw.settings?.accessCodes),
        grantSize: clamp(toNumber(raw.settings?.grantSize, fresh.settings.grantSize), 1, 50),
        freeSignals: clamp(toNumber(raw.settings?.freeSignals, fresh.settings.freeSignals), 0, 20),
      },
      accounts: accounts.filter((account) => account.id),
      profiles,
    };
  }

  function normalizeProfile(profile) {
    const base = defaultProfile();
    return {
      id: profile.id || uid("profile"),
      name: profile.name || base.name,
      slug: normalizeSlug(profile.slug || profile.name || base.slug) || base.slug,
      game: profile.game || "Aviator",
      version: cleanDisplayText(profile.version || base.version),
      lowMin: toNumber(profile.lowMin, base.lowMin),
      lowMax: toNumber(profile.lowMax, base.lowMax),
      lowChance: clamp(toNumber(profile.lowChance, base.lowChance), 1, 99),
      highMin: toNumber(profile.highMin, base.highMin),
      highMax: toNumber(profile.highMax, base.highMax),
      calculationSeconds: clamp(toNumber(profile.calculationSeconds, base.calculationSeconds), 2, 30),
      creativeSequence: profile.creativeSequence || base.creativeSequence,
      creativeIndex: Number.isFinite(Number(profile.creativeIndex))
        ? Number(profile.creativeIndex)
        : 0,
      terminalScript: cleanDisplayText(profile.terminalScript || base.terminalScript),
      active: Boolean(profile.active),
      createdAt: profile.createdAt || now(),
      history: Array.isArray(profile.history) ? profile.history.slice(0, 200) : [],
    };
  }

  function saveState(state) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function mutate(updater) {
    const state = loadState();
    updater(state);
    saveState(state);
    render();
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cleanDisplayText(value) {
    const oldUpper = ["D", "E", "M", "O"].join("");
    const oldTitle = ["D", "e", "m", "o"].join("");
    const oldLower = ["d", "e", "m", "o"].join("");
    return String(value || "")
      .replaceAll(`${oldUpper}_`, "SIGNAL_")
      .replaceAll(oldUpper, "SIGNAL")
      .replaceAll(oldTitle, "")
      .replaceAll(oldLower, "");
  }

  function icon(name) {
    return icons[name] || "";
  }

  function buttonIcon(name, label) {
    return `${icon(name)}<span>${esc(label)}</span>`;
  }

  function toNumber(value, fallback) {
    const normalized =
      typeof value === "string" ? Number(value.trim().replace(",", ".")) : Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeAccountId(value) {
    return value.trim().replace(/\D+/g, "").slice(0, 44);
  }

  function normalizeSlug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42);
  }

  function normalizeAccessCodes(value) {
    const codes = Array.isArray(value)
      ? value
      : String(value || "")
          .split(/[\s,;]+/)
          .filter(Boolean);
    const normalized = codes.map((code) => String(code).trim()).filter(Boolean);
    return normalized.length ? normalized : DEFAULT_ACCESS_CODES;
  }

  function idMatchesSettings(id, state) {
    const prefix = state.settings.requiredIdPrefix || "175";
    return new RegExp(`^${prefix}\\d+$`).test(id);
  }

  function expectedAccessCode(account, state) {
    const codes = normalizeAccessCodes(state.settings.accessCodes);
    return codes[account.nextCodeIndex % codes.length];
  }

  function telegramUrl(state) {
    const raw = String(state.settings.telegramUrl || "").trim();
    return raw || "https://t.me/your_username";
  }

  function createPlayerAccount(id, state) {
    return {
      id,
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

  function parseCoefficientSequence(value) {
    return String(value || "")
      .replace(/(\d),(\d)/g, "$1.$2")
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => Number(item.replace("x", "")))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => item.toFixed(2));
  }

  function nextCreativeCoefficient(profile) {
    const sequence = parseCoefficientSequence(profile.creativeSequence);
    if (!sequence.length) return generateCoefficient(profile, null);
    return sequence[Number(profile.creativeIndex || 0) % sequence.length];
  }

  function activeProfile(state) {
    return state.profiles.find((profile) => profile.active) || state.profiles[0];
  }

  function profileBySlug(state, slug) {
    return (
      state.profiles.find((profile) => profile.slug === slug) ||
      state.profiles.find((profile) => profile.id === slug) ||
      activeProfile(state)
    );
  }

  function selectedCreativeSlug(state) {
    const hashSlug = window.location.hash.replace(/^#/, "").trim();
    if (hashSlug) return normalizeSlug(hashSlug);

    const host = window.location.hostname || "";
    const match = state.profiles.find((profile) => host.startsWith(`${profile.slug}.`));
    return match ? match.slug : activeProfile(state).slug;
  }

  function formatDate(timestamp) {
    if (!timestamp) return "нет";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function phoneTime() {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  }

  function dateCode() {
    return new Intl.DateTimeFormat("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll(".", "-");
  }

  function statusBadge(status) {
    const map = {
      active: ["Активен", "green"],
      blocked: ["Заблокирован", "red"],
      admin: ["Админ", "blue"],
      live: ["Готов", "green"],
    };
    const [label, tone] = map[status] || [status, ""];
    return `<span class="status-badge ${tone}">${esc(label)}</span>`;
  }

  function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function generateCoefficient(profile, previousValue) {
    const lowChance = clamp(toNumber(profile.lowChance, 80), 1, 99);
    const useLow = Math.random() * 100 < lowChance;
    const min = useLow ? toNumber(profile.lowMin, 1.8) : toNumber(profile.highMin, 4.79);
    const max = useLow ? toNumber(profile.lowMax, 4.78) : toNumber(profile.highMax, 16.98);
    const minCents = Math.ceil(Math.min(min, max) * 100);
    const maxCents = Math.floor(Math.max(min, max) * 100);
    const previousEnding = previousValue
      ? Math.round(Number(previousValue) * 100) % 100
      : null;
    let cents = minCents;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      cents = randomInt(minCents, maxCents);
      const ending = cents % 100;
      if (ending !== previousEnding && ending !== 0 && ending % 10 !== 0) break;
    }

    return (cents / 100).toFixed(2);
  }

  function terminalRows(profile, target, progress) {
    const lines = String(profile.terminalScript || DEFAULT_TERMINAL)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const normalizedProgress = clamp(progress || 0.28, 0.28, 1);
    const count = Math.min(
      lines.length,
      Math.max(5, Math.ceil(lines.length * normalizedProgress))
    );
    return lines.slice(0, count).map((line, index) => {
      const time = new Date(Date.now() + index * 700);
      const stamp = new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(time);
      return `[${stamp}] ${line
        .replaceAll("{coef}", `${target || "1.00"}X`)
        .replaceAll("{game}", profile.game)}`;
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
    const navigation =
      entry === "player"
        ? ""
        : `
            <nav class="nav" aria-label="Разделы">
              <a href="./admin.html" class="${active === "admin" ? "active" : ""}">${icon("shield")}<span>Админ</span></a>
              <a href="./creative.html" class="${active === "creative" ? "active" : ""}">${icon("grid")}<span>Креативы</span></a>
            </nav>
          `;
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
        <main class="main">
          ${content}
        </main>
      </div>
    `;
  }

  function phonePreview(profile, options = {}) {
    const account = options.account || null;
    const activeRun = options.mode === "creative" ? creativeCalculation : calculation;
    const isRunning = Boolean(activeRun && activeRun.profileId === profile.id);
    const target = isRunning ? "SCAN" : options.target || visibleCoefficient(profile, account);
    const progress = isRunning
      ? clamp((now() - activeRun.startedAt) / activeRun.durationMs, 0, 1)
      : options.progress || 0.34;
    const hasResult =
      /^\d+(\.\d+)?$/.test(target) &&
      (options.resultReady ||
        Boolean(account?.history?.length) ||
        (options.mode === "creative" && Boolean(creativeBatch.length || profile.history.length)));
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
          <div class="predictor-head">
            ${icon("logo")}
            <span>${esc(profile.version)}</span>
          </div>
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
      </div>
    `;
  }

  function playerView(state) {
    const playerId = sessionStorage.getItem(PLAYER_SESSION_KEY);
    const account = state.accounts.find((item) => item.id === playerId && item.status === "active");
    if (!account) return playerLoginView(state);
    return playerDashboardView(state, account);
  }

  function playerLoginView(state) {
    return `
      <div class="player-login-only">
        <section class="surface">
          <div class="surface-head">
            <div>
              <h1 class="surface-title">Вход игрока</h1>
              <p class="surface-subtitle">Введите цифровой ID аккаунта.</p>
            </div>
          </div>
          <div class="surface-body">
            <form id="player-login-form" class="stack">
              <div class="field">
                <label for="player-id">ID аккаунта</label>
                <input id="player-id" class="input mono" type="tel" inputmode="numeric" pattern="[0-9]*" autocomplete="username" required />
              </div>
              <button type="submit">${buttonIcon("play", "Войти")}</button>
            </form>
          </div>
        </section>
      </div>
    `;
  }

  function playerDashboardView(state, account) {
    const profile = activeProfile(state);
    const remaining = Math.max(0, Number(account.remainingSignals || 0));
    return `
      <div class="predictor-page">
        <section class="player-minibar">
          <div>
            <span class="muted">ID</span>
            <strong class="mono">${esc(account.id)}</strong>
          </div>
          <button id="player-logout" class="secondary" type="button">${buttonIcon("logOut", "Выйти")}</button>
        </section>
        ${phonePreview(profile, {
          account,
          buttonLabel: "Получить коэффициент",
        })}
        ${accessGateView(state, account)}
      </div>
    `;
  }

  function accessGateView(state, account) {
    const remaining = Math.max(0, Number(account.remainingSignals || 0));
    if (remaining > 0 || !accessModalOpen) return "";
    return `
      <div class="modal-backdrop">
        <div class="surface access-gate access-error" role="dialog" aria-modal="true" aria-labelledby="access-error-title">
          <div class="surface-head">
            <div>
              <h2 id="access-error-title" class="surface-title">Ошибка доступа</h2>
              <p class="surface-subtitle">Доступ к следующему сигналу ограничен. Напишите администратору в Telegram и запросите пароль.</p>
            </div>
            <button id="access-close" class="secondary icon-only" type="button" title="Закрыть">x</button>
          </div>
          <div class="surface-body stack">
            <a class="btn-link" href="${esc(telegramUrl(state))}" target="_blank" rel="noopener">
              ${buttonIcon("user", "Написать администратору")}
            </a>
            <form id="access-code-form" class="inline-form">
              <input id="access-code" class="input mono" type="password" inputmode="numeric" placeholder="Код доступа" autocomplete="off" required />
              <button type="submit">${buttonIcon("lock", "Активировать")}</button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  function historyList(history) {
    if (!history || !history.length) {
      return `<div class="empty">История пока пустая.</div>`;
    }
    return `
      <div class="history-list">
        ${history
          .slice(0, 8)
          .map(
            (item) => `
              <div class="history-item">
                <span>${formatDate(item.createdAt)}</span>
                <span class="history-value">${esc(item.value)}x</span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

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
              <p class="surface-subtitle">Управление игроками, кодами доступа, креативами и распределением коэффициентов.</p>
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
              <p class="surface-subtitle">Аккаунты игроков, доступы, профили коэффициентов, тексты командной строки и ссылки для креативов.</p>
            </div>
          </div>
          <div class="surface-body">
            <div class="stats">
              <div class="stat"><div class="stat-label">Игроки</div><div class="stat-value">ID + доступ</div></div>
              <div class="stat"><div class="stat-label">Коды</div><div class="stat-value">777 / 323</div></div>
              <div class="stat"><div class="stat-label">Креатив</div><div class="stat-value">по списку</div></div>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function adminDashboardView(state) {
    return `
      <div class="layout two">
        <section class="stack">
          ${adminSettingsView(state)}
        </section>
        <section class="stack">
          ${profileEditorView(state)}
        </section>
      </div>
    `;
  }

  function adminSettingsView(state) {
    return `
      <section class="surface">
        <div class="surface-head">
          <div>
            <h2 class="surface-title">Настройки доступа</h2>
            <p class="surface-subtitle">Токен доступа, Telegram, ID-префикс и коды.</p>
          </div>
          <button id="admin-logout" class="secondary" type="button">${buttonIcon("logOut", "Выйти")}</button>
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
      </section>
    `;
  }

  function profileEditorView(state) {
    const profile = activeProfile(state);
    return `
      <section class="surface">
        <div class="surface-head">
          <div>
            <h2 class="surface-title">Последовательность для креатива</h2>
            <p class="surface-subtitle">Впишите коэффициенты. На странице креатива они будут выпадать ровно в этом порядке.</p>
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
      </section>
    `;
  }

  function creativeView(state) {
    const hasAccess =
      sessionStorage.getItem(CREATIVE_SESSION_KEY) === "yes" ||
      sessionStorage.getItem(ADMIN_SESSION_KEY) === "yes";
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
                <div class="stat">
                  <div class="stat-label">В списке</div>
                  <div class="stat-value">${sequence.length}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Следующий номер</div>
                  <div class="stat-value">${sequence.length ? (index % sequence.length) + 1 : 0}</div>
                </div>
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
              ${coefficientGrid(creativeBatch.length ? creativeBatch : profile.history.map((item) => item.value).slice(0, 30))}
            </div>
          </div>
        </section>
        ${phonePreview(profile, {
          target: creativeBatch[0] || "1.00",
          buttonLabel: "RUN ALGORITHM",
          buttonId: "creative-phone-run",
          mode: "creative",
        })}
      </div>
    `;
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
      </div>
    `;
  }

  function coefficientGrid(values) {
    if (!values || !values.length) {
      return `<div class="empty">Нажмите "Получить следующий", чтобы вывести коэффициент.</div>`;
    }
    return `
      <div class="coefficient-grid">
        ${values
          .map((value) => `<div class="coefficient-tile">${esc(value)}x</div>`)
          .join("")}
      </div>
    `;
  }

  function startCalculation() {
    if (calculation) return;
    const state = loadState();
    const accountId = sessionStorage.getItem(PLAYER_SESSION_KEY);
    const account = state.accounts.find((item) => item.id === accountId && item.status === "active");
    if (!account) {
      toast("Сначала войдите по ID.");
      return;
    }
    if (Number(account.remainingSignals || 0) <= 0) {
      accessModalOpen = true;
      render();
      return;
    }
    const profile = activeProfile(state);
    const previous = account.history[0]?.value;
    const target = generateCoefficient(profile, previous);
    // Reset blips so they re-scatter for a new scan
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
    const account = state.accounts.find((item) => item.id === completed.accountId);
    const profile = state.profiles.find((item) => item.id === completed.profileId);
    const record = {
      id: uid("coef"),
      value: completed.target,
      profileId: completed.profileId,
      createdAt: now(),
    };

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
    const profile = state.profiles.find((item) => item.id === completed.profileId);
    const record = {
      id: uid("coef"),
      value: completed.target,
      profileId: completed.profileId,
      createdAt: now(),
    };

    if (profile) {
      profile.history.unshift(record);
      profile.history = profile.history.slice(0, 200);
      const sequence = parseCoefficientSequence(profile.creativeSequence);
      profile.creativeIndex = sequence.length
        ? (Number(profile.creativeIndex || 0) + 1) % sequence.length
        : 0;
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
    creativeCalculation = {
      profileId: profile.id,
      target,
      startedAt: now(),
      durationMs: randomCreativeDuration(),
    };
    render();
  }

  function startCreativeBatch(profile) {
    const values = [];
    const sequence = parseCoefficientSequence(profile.creativeSequence);
    if (!sequence.length) {
      toast("Сначала добавьте коэффициенты в админке.");
      return;
    }
    const startIndex = Number(profile.creativeIndex || 0);
    for (let index = 0; index < 30; index += 1) {
      values.push(sequence[(startIndex + index) % sequence.length]);
    }
    creativeBatch = values;
    render();
  }

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
    if (calculation || creativeCalculation) {
      renderTimer = setInterval(render, 220);
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === "player-login-form") {
      event.preventDefault();
      const state = loadState();
      const id = normalizeAccountId(document.getElementById("player-id").value);
      if (!idMatchesSettings(id, state)) {
        toast("Неверный ID аккаунта.");
        return;
      }
      let account = state.accounts.find((item) => item.id === id);
      if (!account) {
        account = createPlayerAccount(id, state);
        state.accounts.unshift(account);
      }
      if (account.status !== "active") {
        toast("Этот ID заблокирован.");
        return;
      }
      account.lastLoginAt = now();
      saveState(state);
      accessModalOpen = false;
      sessionStorage.setItem(PLAYER_SESSION_KEY, id);
      render();
      return;
    }

    if (form.id === "access-code-form") {
      event.preventDefault();
      const state = loadState();
      const id = sessionStorage.getItem(PLAYER_SESSION_KEY);
      const account = state.accounts.find((item) => item.id === id && item.status === "active");
      if (!account) {
        toast("Сначала войдите по ID.");
        return;
      }
      const input = document.getElementById("access-code").value.trim();
      const expected = expectedAccessCode(account, state);
      if (input !== expected) {
        toast("Неверный код доступа.");
        return;
      }
      account.remainingSignals = Number(account.remainingSignals || 0) + Number(state.settings.grantSize || 5);
      const codes = normalizeAccessCodes(state.settings.accessCodes);
      account.nextCodeIndex = (Number(account.nextCodeIndex || 0) + 1) % codes.length;
      account.updatedAt = now();
      saveState(state);
      accessModalOpen = false;
      toast(`Доступ открыт: ${state.settings.grantSize} сигналов.`);
      render();
      return;
    }

    if (form.id === "admin-login-form" || form.id === "creative-login-form") {
      event.preventDefault();
      const state = loadState();
      const prefix = form.id === "admin-login-form" ? "admin" : "creative";
      const token = document.getElementById(`${prefix}-token`).value.trim();
      if (token !== state.admin.token) {
        toast("Неверный токен доступа.");
        return;
      }
      sessionStorage.setItem(
        form.id === "admin-login-form" ? ADMIN_SESSION_KEY : CREATIVE_SESSION_KEY,
        "yes"
      );
      render();
      return;
    }

    if (form.id === "admin-settings-form") {
      event.preventDefault();
      mutate((state) => {
        state.admin.token = document.getElementById("settings-token").value.trim();
        state.settings.telegramUrl = document.getElementById("settings-telegram").value.trim();
        state.settings.requiredIdPrefix =
          document.getElementById("settings-id-prefix").value.replace(/\D+/g, "") || "175";
        state.settings.grantSize = clamp(
          toNumber(document.getElementById("settings-grant-size").value, 5),
          1,
          50
        );
        state.settings.freeSignals = clamp(
          toNumber(document.getElementById("settings-free-signals").value, 1),
          0,
          20
        );
        state.settings.accessCodes = normalizeAccessCodes(
          document.getElementById("settings-codes").value
        );
      });
      toast("Настройки сохранены.");
      return;
    }

    if (form.id === "profile-form") {
      event.preventDefault();
      const id = form.getAttribute("data-id");
      mutate((state) => {
        const profile = state.profiles.find((item) => item.id === id);
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

    if (target.id === "player-logout") {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
      accessModalOpen = false;
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

    if (target.id === "run-algorithm") {
      startCalculation();
      return;
    }

    if (target.id === "access-close") {
      accessModalOpen = false;
      render();
      return;
    }

    if (target.id === "profile-reset-sequence") {
      const form = document.getElementById("profile-form");
      const id = form?.getAttribute("data-id");
      mutate((state) => {
        const profile = state.profiles.find((item) => item.id === id);
        if (profile) profile.creativeIndex = 0;
      });
      creativeBatch = [];
      toast("Последовательность начнется с первого коэффициента.");
      return;
    }

    if (
      target.id === "creative-generate-one" ||
      target.id === "creative-phone-run"
    ) {
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
      const values = creativeBatch.length
        ? creativeBatch
        : profile.history.map((item) => item.value).slice(0, 30);
      const text = values.map((value) => `${value}x`).join("\n");
      if (!text) {
        toast("Сначала получите коэффициент.");
        return;
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
          () => toast("Серия скопирована."),
          () => toast("Не удалось скопировать автоматически.")
        );
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

    // Mount radar canvas after DOM update
    const isRunning = Boolean(calculation || creativeCalculation);
    _mountRadar(isRunning);

    // Telegram: показываем кнопку «назад» когда игрок залогинен
    if (tg && entry === "player") {
      const loggedIn = Boolean(sessionStorage.getItem(PLAYER_SESSION_KEY));
      if (loggedIn) {
        tg.BackButton.show();
      } else {
        tg.BackButton.hide();
      }
    }
  }

  // Telegram: кнопка «назад» → выход из аккаунта игрока
  if (tg && entry === "player") {
    tg.BackButton.onClick(function () {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
      accessModalOpen = false;
      render();
    });
  }

  app.addEventListener("submit", handleSubmit);
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  window.addEventListener("storage", (event) => {
    if (event.key === STORE_KEY) render();
  });
  window.addEventListener("hashchange", () => {
    creativeBatch = [];
    render();
  });

  render();
})();
