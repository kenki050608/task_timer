// ==========================================================================
// Business English Study Tracker
// Tracks a daily 120-minute routine combining Eigo Mimi, Studysapuri
// Business, and Speak.
// ==========================================================================

const STORAGE_KEY = 'englishLearningTrackerData';

const BLOCK_ORDER = ['eigomimi', 'studysapuri', 'shadowing', 'speak'];

const BLOCK_CONFIG = {
    eigomimi: {
        title: 'Eigo Mimi',
        subtitle: 'Pronunciation warm-up & sound training',
        minutes: 15,
        logoUrl: 'eigomimi-logo.png',
        logoLabel: 'Pronunciation'
    },
    studysapuri: {
        title: 'Studysapuri Business',
        subtitle: 'Input, dictation & vocabulary/idiom logging',
        minutes: 45,
        logoUrl: 'studysapuri-logo.png',
        logoLabel: 'Input'
    },
    shadowing: {
        title: 'Shadowing',
        subtitle: 'Overlap Eigo Mimi’s sound patterns onto Studysapuri audio',
        minutes: 30,
        logoUrl: 'studysapuri-logo.png',
        logoLabel: 'Shadowing'
    },
    speak: {
        title: 'Speak',
        subtitle: 'Put your vocabulary & idioms into practice via AI conversation',
        minutes: 30,
        logoUrl: 'speak-logo.png',
        logoLabel: 'Speaking'
    }
};

const NOTEBOOK_TYPES = ['vocab', 'idioms'];
const NOTEBOOK_CONFIG = {
    vocab: { label: 'Vocabulary Notebook', icon: '📕', termPlaceholder: 'Word', notePlaceholder: 'Meaning (optional)' },
    idioms: { label: 'Idiom Notebook', icon: '📗', termPlaceholder: 'Idiom / phrase', notePlaceholder: 'Meaning (optional)' }
};

const TOTAL_MINUTES = BLOCK_ORDER.reduce((sum, key) => sum + BLOCK_CONFIG[key].minutes, 0);
const MINI_CIRCUMFERENCE = 2 * Math.PI * 34;

// State
let state = loadState();
let currentDate = startOfDay(new Date());
let currentTab = 'today';
let trackedTodayKey = getDateKey(new Date());
const timers = {};

// DOM Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');
const prevDayBtn = document.getElementById('prevDayBtn');
const nextDayBtn = document.getElementById('nextDayBtn');
const currentDateLabel = document.getElementById('currentDateLabel');
const minutesTodayLabel = document.getElementById('minutesTodayLabel');
const sessionsCompletedLabel = document.getElementById('sessionsCompletedLabel');
const progressBarFill = document.getElementById('progressBarFill');
const sessionList = document.getElementById('sessionList');
const notebookPages = { vocab: document.getElementById('vocabPage'), idioms: document.getElementById('idiomsPage') };
const statsGrid = document.getElementById('statsGrid');
const heatmap = document.getElementById('heatmap');
const historyTableBody = document.getElementById('historyTableBody');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');

// ---- Storage helpers ----------------------------------------------------

function loadState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (raw && raw.logs) {
            if (!Array.isArray(raw.vocab)) raw.vocab = [];
            if (!Array.isArray(raw.idioms)) raw.idioms = [];
            return raw;
        }
    } catch (e) {
        // ignore malformed data and fall back to a fresh state
    }
    return { logs: {}, vocab: [], idioms: [] };
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultLog() {
    const blocks = {};
    BLOCK_ORDER.forEach(key => { blocks[key] = { done: false, secondsSpent: 0 }; });
    return { blocks };
}

function getLogOrDefault(dateKey) {
    return state.logs[dateKey] || defaultLog();
}

function ensureLog(dateKey) {
    if (!state.logs[dateKey]) state.logs[dateKey] = defaultLog();
    return state.logs[dateKey];
}

function makeId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Date helpers ---------------------------------------------------------

function startOfDay(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dateFromKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function getMonday(date) {
    const d = startOfDay(date);
    const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    d.setDate(d.getDate() - day);
    return d;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(date) {
    return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} (${WEEKDAY_LABELS[date.getDay()]})`;
}

function formatMMSS(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMinutesValue(minutes) {
    const rounded = Math.round(minutes * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ---- Derived data ----------------------------------------------------------

function calcBlockSeconds(log, blockKey) {
    const total = BLOCK_CONFIG[blockKey].minutes * 60;
    const block = log.blocks[blockKey];
    const spent = block.secondsSpent || 0;
    // Once done, credit at least the full block duration, but don't cap it there —
    // studying beyond the nominal time (e.g. running Eigo Mimi again after finishing
    // it) should still count the extra time toward the day's and cumulative totals.
    return block.done ? Math.max(total, spent) : spent;
}

function calcMinutes(log) {
    return BLOCK_ORDER.reduce((sum, key) => sum + calcBlockSeconds(log, key), 0) / 60;
}

function calcSessionsCompleted(log) {
    return BLOCK_ORDER.filter(key => log.blocks[key].done).length;
}

function getDayEntries(dateKey, type) {
    return (state[type] || []).filter(entry => entry.dateKey === dateKey);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function handleLogoError(imgEl) {
    imgEl.replaceWith(document.createTextNode(imgEl.alt));
}

function escapeAttr(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ---- Timers ----------------------------------------------------------------
//
// Each block tracks total elapsed seconds for the day (log.blocks[key].secondsSpent),
// persisted and capped at that block's nominal duration. The countdown widget
// (timers[key]) represents the current attempt only: remaining/total drive the
// display, while lastBankRemaining marks the last point its progress was
// credited to secondsSpent. Progress is credited ("banked") on every tick while
// running, and on pause/reset/complete/restore, so:
//   - stopping partway (pause, reset, closing the app) still counts that
//     elapsed time toward the day's total and the cumulative stats
//   - a block is marked done automatically once secondsSpent reaches the
//     block's full duration, whether that happens in one continuous run or
//     across several interrupted attempts
//
// The end timestamp (not a plain per-second decrement) is what's persisted,
// so remaining time survives page reloads and backgrounding.

const TIMER_STORAGE_KEY = 'englishLearningTrackerTimers';

function bankProgress(blockKey) {
    const timer = timers[blockKey];
    const delta = timer.lastBankRemaining - timer.remaining;
    if (delta <= 0) return;
    timer.lastBankRemaining = timer.remaining;
    const log = ensureLog(getDateKey(currentDate));
    const block = log.blocks[blockKey];
    const newSeconds = (block.secondsSpent || 0) + delta;
    block.secondsSpent = newSeconds;
    if (newSeconds >= timer.total) block.done = true;
    saveState();
}

function freshTimer(blockKey) {
    const total = BLOCK_CONFIG[blockKey].minutes * 60;
    return { remaining: total, total, endTime: null, interval: null, running: false, lastBankRemaining: total };
}

function initTimersForDate() {
    BLOCK_ORDER.forEach(key => {
        const timer = timers[key];
        if (timer) {
            if (timer.running && timer.endTime) {
                timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
                bankProgress(key);
            }
            if (timer.interval) clearInterval(timer.interval);
        }
        timers[key] = freshTimer(key);
    });
    localStorage.removeItem(TIMER_STORAGE_KEY);
}

function persistTimers() {
    const snapshot = { savedDateKey: getDateKey(new Date()), timers: {} };
    BLOCK_ORDER.forEach(key => {
        const t = timers[key];
        snapshot.timers[key] = {
            total: t.total,
            running: t.running,
            endTime: t.endTime,
            remaining: t.remaining,
            lastBankRemaining: t.lastBankRemaining
        };
    });
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(snapshot));
}

function restoreTimers() {
    let persisted = null;
    try {
        persisted = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY));
    } catch (e) {
        persisted = null;
    }

    const todayKey = getDateKey(new Date());
    if (!persisted || persisted.savedDateKey !== todayKey) {
        // No saved state, or it belongs to a previous day — start the day fresh.
        BLOCK_ORDER.forEach(key => { timers[key] = freshTimer(key); });
        localStorage.removeItem(TIMER_STORAGE_KEY);
        return;
    }

    BLOCK_ORDER.forEach(key => {
        const saved = persisted.timers[key];
        const total = BLOCK_CONFIG[key].minutes * 60;
        if (!saved || saved.total !== total) {
            timers[key] = freshTimer(key);
            return;
        }
        let remaining = saved.remaining;
        const wasRunning = saved.running;
        if (wasRunning && saved.endTime) {
            remaining = Math.max(0, Math.round((saved.endTime - Date.now()) / 1000));
        }
        timers[key] = {
            remaining,
            total,
            endTime: null,
            interval: null,
            running: false,
            lastBankRemaining: saved.lastBankRemaining != null ? saved.lastBankRemaining : total
        };
        // Credit whatever elapsed while the app was closed or backgrounded.
        bankProgress(key);

        const log = ensureLog(todayKey);
        if (wasRunning && timers[key].remaining > 0 && !log.blocks[key].done) {
            timers[key].endTime = Date.now() + timers[key].remaining * 1000;
            startTicking(key);
        }
    });
}

function checkDateRollover() {
    const todayKey = getDateKey(new Date());
    if (todayKey === trackedTodayKey) return;
    const wasViewingToday = getDateKey(currentDate) === trackedTodayKey;
    trackedTodayKey = todayKey;
    initTimersForDate();
    if (wasViewingToday) currentDate = startOfDay(new Date());
    renderToday();
}

function startTicking(blockKey) {
    const timer = timers[blockKey];
    timer.running = true;
    timer.interval = setInterval(() => {
        timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
        bankProgress(blockKey);
        updateTimerDisplay(blockKey);
        updateProgressSummaryDisplay();
        const log = ensureLog(getDateKey(currentDate));
        if (timer.remaining <= 0 || log.blocks[blockKey].done) {
            completeBlockTimer(blockKey);
        }
    }, 1000);
}

function startBlockTimer(blockKey) {
    const timer = timers[blockKey];
    if (timer.running || timer.remaining <= 0) return;
    timer.endTime = Date.now() + timer.remaining * 1000;
    startTicking(blockKey);
    persistTimers();
    updateTimerButtons(blockKey);
}

function pauseBlockTimer(blockKey) {
    const timer = timers[blockKey];
    if (!timer.running) return;
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
    timer.endTime = null;
    bankProgress(blockKey);
    persistTimers();
    renderToday();
}

function resetBlockTimer(blockKey) {
    // Reset is a deliberate wipe: unlike pausing or closing the app (which bank
    // whatever time has elapsed so far), pressing Reset discards this block's
    // recorded time for the day entirely, clearing it from the day's total and
    // history too.
    const timer = timers[blockKey];
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.endTime = null;
    timer.remaining = timer.total;
    timer.lastBankRemaining = timer.total;
    persistTimers();

    const log = ensureLog(getDateKey(currentDate));
    log.blocks[blockKey].secondsSpent = 0;
    log.blocks[blockKey].done = false;
    saveState();

    renderToday();
}

function completeBlockTimer(blockKey) {
    const timer = timers[blockKey];
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.endTime = null;
    timer.remaining = timer.total;
    timer.lastBankRemaining = timer.total;
    persistTimers();

    const log = ensureLog(getDateKey(currentDate));
    log.blocks[blockKey].secondsSpent = Math.max(timer.total, log.blocks[blockKey].secondsSpent || 0);
    log.blocks[blockKey].done = true;
    saveState();

    playNotificationSound();
    if (Notification.permission === 'granted') {
        new Notification('Study session complete!', {
            body: `${BLOCK_CONFIG[blockKey].title} has finished`
        });
    }
    renderToday();
}

function playNotificationSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;
    oscillator.start();
    setTimeout(() => oscillator.stop(), 200);
}

function updateTimerDisplay(blockKey) {
    const timer = timers[blockKey];
    const display = document.getElementById(`display-${blockKey}`);
    const ring = document.getElementById(`ring-${blockKey}`);
    if (display) display.textContent = formatMMSS(timer.remaining);
    if (ring) {
        const progress = timer.remaining / timer.total;
        ring.style.strokeDasharray = MINI_CIRCUMFERENCE;
        ring.style.strokeDashoffset = MINI_CIRCUMFERENCE * (1 - progress);
    }
}

function updateTimerButtons(blockKey) {
    const card = document.querySelector(`.session-card[data-block="${blockKey}"]`);
    if (!card) return;
    const timer = timers[blockKey];
    const startBtn = card.querySelector('.timer-start');
    const pauseBtn = card.querySelector('.timer-pause');
    if (startBtn) startBtn.disabled = timer.running;
    if (pauseBtn) pauseBtn.disabled = !timer.running;
}

function syncAllTimerDisplays() {
    BLOCK_ORDER.forEach(key => {
        updateTimerDisplay(key);
        updateTimerButtons(key);
    });
}

function updateProgressSummaryDisplay() {
    const dateKey = getDateKey(currentDate);
    const log = getLogOrDefault(dateKey);
    const minutes = calcMinutes(log);
    const completed = calcSessionsCompleted(log);
    minutesTodayLabel.textContent = formatMinutesValue(minutes);
    sessionsCompletedLabel.textContent = `Sessions completed: ${completed} / ${BLOCK_ORDER.length}`;
    progressBarFill.style.width = `${Math.min(100, (minutes / TOTAL_MINUTES) * 100)}%`;
}

// ---- Mutations ---------------------------------------------------------

function toggleDone(blockKey, checked) {
    const log = ensureLog(getDateKey(currentDate));
    log.blocks[blockKey].done = checked;
    saveState();
    renderToday();
}

function addNotebookEntry(type, term, note) {
    const trimmedTerm = (term || '').trim();
    if (!trimmedTerm) return;
    const entry = { id: makeId(), term: trimmedTerm, note: (note || '').trim(), dateKey: getDateKey(new Date()), used: false };
    state[type].push(entry);
    saveState();
    renderNotebookPages();
    renderToday();
}

function deleteNotebookEntry(type, id) {
    state[type] = state[type].filter(entry => entry.id !== id);
    saveState();
    renderNotebookPages();
    renderToday();
    if (currentTab === 'cumulative') renderCumulative();
}

function toggleNotebookUsed(type, id, checked) {
    const entry = (state[type] || []).find(e => e.id === id);
    if (entry) entry.used = checked;
    saveState();
}

function changeDate(delta) {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + delta);
    const today = startOfDay(new Date());
    if (next > today) return;
    initTimersForDate();
    currentDate = next;
    renderToday();
}

// ---- Rendering: Today view ----------------------------------------------

function buildSpeakExtra() {
    const dateKey = getDateKey(currentDate);
    const entries = [
        ...getDayEntries(dateKey, 'vocab').map(e => ({ ...e, type: 'vocab' })),
        ...getDayEntries(dateKey, 'idioms').map(e => ({ ...e, type: 'idioms' }))
    ];
    if (entries.length === 0) {
        return '';
    }
    return `
        <div class="extra-block">
            <p class="extra-label">💬 Use in conversation</p>
            <ul class="speak-phrase-list">
                ${entries.map(e => `
                    <li>
                        <label class="review-check">
                            <input type="checkbox" class="phrase-used-input" data-type="${e.type}" data-id="${e.id}" ${e.used ? 'checked' : ''}>
                            <span>${NOTEBOOK_CONFIG[e.type].icon} ${escapeHtml(e.term)}${e.note ? ` — ${escapeHtml(e.note)}` : ''}</span>
                        </label>
                    </li>`).join('')}
            </ul>
        </div>`;
}

function renderSessionCard(blockKey, log) {
    const cfg = BLOCK_CONFIG[blockKey];
    const done = log.blocks[blockKey].done;
    const index = BLOCK_ORDER.indexOf(blockKey) + 1;

    const extraHtml = blockKey === 'speak' ? buildSpeakExtra() : '';
    const subtitle = cfg.subtitle;
    const logoClass = cfg.logoLabel ? 'session-logo session-logo-custom' : 'session-logo';
    const titleHtml = cfg.logoUrl
        ? `<img src="${escapeAttr(cfg.logoUrl)}" alt="${escapeAttr(cfg.title)}" title="${escapeAttr(cfg.title)}" class="${logoClass}" onerror="handleLogoError(this)">${cfg.logoLabel ? ` ${escapeHtml(cfg.logoLabel)}` : ''}`
        : cfg.title;

    return `
        <div class="session-card ${done ? 'done' : ''}" data-block="${blockKey}">
            <div class="session-card-header">
                <div class="session-title">
                    <span class="session-index">${index}</span>
                    <div>
                        <h3>${titleHtml}</h3>
                        <p class="session-subtitle">${subtitle}</p>
                    </div>
                </div>
                <div class="session-done-col">
                    <label class="done-checkbox">
                        <input type="checkbox" class="done-input" data-block="${blockKey}" ${done ? 'checked' : ''}>
                        <span>Done</span>
                    </label>
                    <span class="session-minutes">(${cfg.minutes} min)</span>
                </div>
            </div>
            <div class="session-timer">
                <div class="mini-timer">
                    <svg class="mini-timer-svg" viewBox="0 0 80 80">
                        <circle class="mini-timer-bg" cx="40" cy="40" r="34"></circle>
                        <circle class="mini-timer-progress" cx="40" cy="40" r="34" id="ring-${blockKey}"></circle>
                    </svg>
                    <span class="mini-timer-display" id="display-${blockKey}">${formatMMSS(cfg.minutes * 60)}</span>
                </div>
                <div class="mini-timer-controls">
                    <button class="btn-small btn-primary timer-start" data-block="${blockKey}">Start</button>
                    <button class="btn-small btn-secondary timer-pause" data-block="${blockKey}" disabled>Pause</button>
                    <button class="btn-small btn-danger timer-reset" data-block="${blockKey}">Reset</button>
                </div>
            </div>
            ${extraHtml}
        </div>`;
}

function renderToday() {
    const dateKey = getDateKey(currentDate);
    const log = getLogOrDefault(dateKey);
    const today = startOfDay(new Date());
    const isToday = dateKey === getDateKey(today);

    currentDateLabel.textContent = formatDateLabel(currentDate) + (isToday ? ' (Today)' : '');
    nextDayBtn.disabled = currentDate >= today;

    updateProgressSummaryDisplay();

    sessionList.innerHTML = BLOCK_ORDER.map(key => renderSessionCard(key, log)).join('');

    syncAllTimerDisplays();
}

// ---- Rendering: Notebooks view -------------------------------------------

function renderNotebookListItem(entry, type, { showDate } = {}) {
    return `
        <li class="notebook-item" data-type="${type}" data-id="${entry.id}">
            <span class="notebook-term">${escapeHtml(entry.term)}</span>${entry.note ? ` <span class="notebook-note">— ${escapeHtml(entry.note)}</span>` : ''}
            ${showDate ? `<span class="notebook-date">${formatDateLabel(dateFromKey(entry.dateKey))}</span>` : ''}
            <button class="notebook-delete" data-type="${type}" data-id="${entry.id}" aria-label="Delete">×</button>
        </li>`;
}

function renderNotebookCard(type) {
    const cfg = NOTEBOOK_CONFIG[type];

    const allEntries = [...(state[type] || [])].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    const listHtml = allEntries.length === 0
        ? `<p class="empty-note">No entries yet — add your first one above.</p>`
        : `<ul class="notebook-list-full">${allEntries.map(e => renderNotebookListItem(e, type, { showDate: true })).join('')}</ul>`;

    return `
        <div class="card notebook-page-card" data-type="${type}">
            <h3>${cfg.icon} ${cfg.label}</h3>
            <div class="notebook-add-row">
                <input type="text" class="phrase-input notebook-term-input" data-type="${type}" placeholder="${cfg.termPlaceholder}">
                <input type="text" class="phrase-input notebook-note-input" data-type="${type}" placeholder="${cfg.notePlaceholder}">
                <button class="btn-small btn-primary notebook-add-btn" data-type="${type}">Add</button>
            </div>
            <div class="notebook-list-wrap">
                ${listHtml}
            </div>
        </div>`;
}

function renderNotebookPages() {
    NOTEBOOK_TYPES.forEach(type => {
        notebookPages[type].innerHTML = renderNotebookCard(type);
    });
}

// ---- Rendering: Cumulative view -----------------------------------------

function isLogStudied(log) {
    return log && BLOCK_ORDER.some(key => log.blocks[key].done);
}

function computeCurrentStreak() {
    let streak = 0;
    const d = startOfDay(new Date());
    while (true) {
        const key = getDateKey(d);
        if (isLogStudied(state.logs[key])) {
            streak++;
            d.setDate(d.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

function computeLongestStreak() {
    const sortedKeys = Object.keys(state.logs)
        .filter(key => isLogStudied(state.logs[key]))
        .sort();
    if (sortedKeys.length === 0) return 0;

    let longest = 1;
    let current = 1;
    for (let i = 1; i < sortedKeys.length; i++) {
        const prev = dateFromKey(sortedKeys[i - 1]);
        const curr = dateFromKey(sortedKeys[i]);
        const diffDays = Math.round((curr - prev) / 86400000);
        current = diffDays === 1 ? current + 1 : 1;
        longest = Math.max(longest, current);
    }
    return longest;
}

function renderStatsGrid() {
    const allLogs = Object.values(state.logs);
    const daysStudied = allLogs.filter(isLogStudied).length;
    const totalMinutes = allLogs.reduce((sum, log) => sum + calcMinutes(log), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);

    const stats = [
        { icon: '🔥', value: computeCurrentStreak(), label: 'Current Streak' },
        { icon: '🏆', value: computeLongestStreak(), label: 'Longest Streak' },
        { icon: '📚', value: daysStudied, label: 'Total Study Days' },
        { icon: '⏱️', value: `${totalHours}h`, label: 'Total Study Time' },
        { icon: '📕', value: (state.vocab || []).length, label: 'Vocabulary Logged' },
        { icon: '📗', value: (state.idioms || []).length, label: 'Idioms Logged' }
    ];

    statsGrid.innerHTML = stats.map(s => `
        <div class="stat-card">
            <div class="stat-icon">${s.icon}</div>
            <div class="stat-value">${s.value}</div>
            <div class="stat-label">${s.label}</div>
        </div>`).join('');
}

function renderHeatmap() {
    const today = startOfDay(new Date());
    const startMonday = getMonday(today);
    startMonday.setDate(startMonday.getDate() - 11 * 7);

    let cells = '';
    for (let week = 0; week < 12; week++) {
        for (let day = 0; day < 7; day++) {
            const date = new Date(startMonday);
            date.setDate(date.getDate() + week * 7 + day);
            if (date > today) {
                cells += `<div class="heatmap-cell level-empty"></div>`;
                continue;
            }
            const dateKey = getDateKey(date);
            const log = state.logs[dateKey];
            const completed = log ? calcSessionsCompleted(log) : 0;
            cells += `<div class="heatmap-cell level-${completed}" title="${formatDateLabel(date)}: ${completed}/4 sessions"></div>`;
        }
    }
    heatmap.innerHTML = cells;
}

function renderHistoryTable() {
    const sortedKeys = Object.keys(state.logs).sort().reverse();
    if (sortedKeys.length === 0) {
        historyTableBody.innerHTML = `<tr><td colspan="4" class="empty-note">No records yet</td></tr>`;
        return;
    }
    historyTableBody.innerHTML = sortedKeys.slice(0, 60).map(dateKey => {
        const log = state.logs[dateKey];
        const completed = calcSessionsCompleted(log);
        const minutes = calcMinutes(log);
        const wordCount = getDayEntries(dateKey, 'vocab').length + getDayEntries(dateKey, 'idioms').length;
        return `
            <tr>
                <td>${formatDateLabel(dateFromKey(dateKey))}</td>
                <td>${completed} / 4</td>
                <td>${formatMinutesValue(minutes)} min</td>
                <td>${wordCount}</td>
            </tr>`;
    }).join('');
}

function renderCumulative() {
    renderStatsGrid();
    renderHeatmap();
    renderHistoryTable();
}

// ---- Backup / restore ------------------------------------------------------

function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eigo-tracker-backup-${getDateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try {
            parsed = JSON.parse(reader.result);
        } catch (e) {
            alert('Failed to read the file. Please select a valid backup file.');
            return;
        }
        if (!parsed || typeof parsed !== 'object' || typeof parsed.logs !== 'object') {
            alert('This file was not recognized as a valid study data backup.');
            return;
        }
        if (!confirm('This will overwrite this device\'s records with the selected file. Continue?')) return;
        state = parsed;
        if (!Array.isArray(state.vocab)) state.vocab = [];
        if (!Array.isArray(state.idioms)) state.idioms = [];
        saveState();
        initTimersForDate();
        renderToday();
        renderNotebookPages();
        renderCumulative();
        alert('Data imported successfully.');
    };
    reader.readAsText(file);
}

// ---- Event wiring --------------------------------------------------------

function submitNotebookEntry(type) {
    const block = notebookPages[type].querySelector(`.notebook-page-card[data-type="${type}"]`);
    if (!block) return;
    const termInput = block.querySelector('.notebook-term-input');
    const noteInput = block.querySelector('.notebook-note-input');
    addNotebookEntry(type, termInput.value, noteInput.value);
}

function wireNotebookContainer(container) {
    container.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.notebook-add-btn');
        if (addBtn) { submitNotebookEntry(addBtn.dataset.type); return; }
        const delBtn = e.target.closest('.notebook-delete');
        if (delBtn) { deleteNotebookEntry(delBtn.dataset.type, delBtn.dataset.id); return; }
    });

    container.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const input = e.target.closest('.notebook-term-input, .notebook-note-input');
        if (!input) return;
        e.preventDefault();
        submitNotebookEntry(input.dataset.type);
    });
}

function setupEventListeners() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentTab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.toggle('active', b === btn));
            views.forEach(v => v.classList.toggle('active', v.id === `${currentTab}View`));
            if (currentTab === 'today') renderToday();
            if (currentTab === 'vocab' || currentTab === 'idioms') renderNotebookPages();
            if (currentTab === 'cumulative') renderCumulative();
        });
    });

    prevDayBtn.addEventListener('click', () => changeDate(-1));
    nextDayBtn.addEventListener('click', () => changeDate(1));

    sessionList.addEventListener('click', (e) => {
        const startBtn = e.target.closest('.timer-start');
        if (startBtn) { startBlockTimer(startBtn.dataset.block); return; }
        const pauseBtn = e.target.closest('.timer-pause');
        if (pauseBtn) { pauseBlockTimer(pauseBtn.dataset.block); return; }
        const resetBtn = e.target.closest('.timer-reset');
        if (resetBtn) { resetBlockTimer(resetBtn.dataset.block); return; }
    });

    sessionList.addEventListener('change', (e) => {
        if (e.target.classList.contains('done-input')) {
            toggleDone(e.target.dataset.block, e.target.checked);
        } else if (e.target.classList.contains('phrase-used-input')) {
            toggleNotebookUsed(e.target.dataset.type, e.target.dataset.id, e.target.checked);
        }
    });

    wireNotebookContainer(notebookPages.vocab);
    wireNotebookContainer(notebookPages.idioms);

    exportBtn.addEventListener('click', exportData);
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importData(file);
        importFileInput.value = '';
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkDateRollover();
    });
}

// ---- Init ------------------------------------------------------------------

function init() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        });
    }
    restoreTimers();
    setupEventListeners();
    renderToday();
}

init();
