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
        minutes: 15
    },
    studysapuri: {
        title: 'Studysapuri Business',
        subtitle: 'Input, dictation & key phrase extraction',
        minutes: 45
    },
    shadowing: {
        title: 'Shadowing',
        subtitle: 'Overlap Eigo Mimi’s sound patterns onto Studysapuri audio',
        minutes: 30
    },
    speak: {
        title: 'Speak',
        subtitle: 'Put your key phrases into practice via AI conversation',
        minutes: 30
    }
};

const TOTAL_MINUTES = BLOCK_ORDER.reduce((sum, key) => sum + BLOCK_CONFIG[key].minutes, 0);
const MINI_CIRCUMFERENCE = 2 * Math.PI * 34;

// State
let state = loadState();
let currentDate = startOfDay(new Date());
let currentTab = 'today';
const timers = {};

// DOM Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');
const prevDayBtn = document.getElementById('prevDayBtn');
const nextDayBtn = document.getElementById('nextDayBtn');
const currentDateLabel = document.getElementById('currentDateLabel');
const reviewDayToggle = document.getElementById('reviewDayToggle');
const minutesTodayLabel = document.getElementById('minutesTodayLabel');
const sessionsCompletedLabel = document.getElementById('sessionsCompletedLabel');
const progressBarFill = document.getElementById('progressBarFill');
const sessionList = document.getElementById('sessionList');
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
        if (raw && raw.logs) return raw;
    } catch (e) {
        // ignore malformed data and fall back to a fresh state
    }
    return { logs: {} };
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultLog() {
    const blocks = {};
    BLOCK_ORDER.forEach(key => { blocks[key] = { done: false }; });
    return {
        blocks,
        phrases: ['', '', ''],
        phrasesUsed: [false, false, false],
        isReviewDay: false,
        reviewChecks: {}
    };
}

function getLogOrDefault(dateKey) {
    return state.logs[dateKey] || defaultLog();
}

function ensureLog(dateKey) {
    if (!state.logs[dateKey]) state.logs[dateKey] = defaultLog();
    return state.logs[dateKey];
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

function getWeekKey(date) {
    return getDateKey(getMonday(date));
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

// ---- Derived data ----------------------------------------------------------

function calcMinutes(log) {
    return BLOCK_ORDER.reduce((sum, key) => sum + (log.blocks[key].done ? BLOCK_CONFIG[key].minutes : 0), 0);
}

function calcSessionsCompleted(log) {
    return BLOCK_ORDER.filter(key => log.blocks[key].done).length;
}

function getWeekPhrases(weekKey) {
    const set = new Set();
    Object.keys(state.logs).forEach(dateKey => {
        if (getWeekKey(dateFromKey(dateKey)) === weekKey) {
            const log = state.logs[dateKey];
            (log.phrases || []).forEach(p => {
                if (p && p.trim()) set.add(p.trim());
            });
        }
    });
    return Array.from(set);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
// Timers are driven by a fixed end timestamp rather than a per-second
// decrement, and that timestamp is persisted to localStorage. That way the
// remaining time can always be recomputed from the real clock, so a page
// reload (a new deploy, or the mobile browser suspending/killing the tab in
// the background) doesn't lose progress on a timer that was running.

const TIMER_STORAGE_KEY = 'englishLearningTrackerTimers';

function persistTimers() {
    const snapshot = {};
    BLOCK_ORDER.forEach(key => {
        const t = timers[key];
        snapshot[key] = { total: t.total, running: t.running, endTime: t.endTime, remaining: t.remaining };
    });
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(snapshot));
}

function freshTimer(blockKey) {
    const total = BLOCK_CONFIG[blockKey].minutes * 60;
    return { remaining: total, total, endTime: null, interval: null, running: false };
}

function initTimersForDate() {
    BLOCK_ORDER.forEach(key => {
        if (timers[key] && timers[key].interval) clearInterval(timers[key].interval);
        timers[key] = freshTimer(key);
    });
    localStorage.removeItem(TIMER_STORAGE_KEY);
}

function restoreTimers() {
    let persisted = null;
    try {
        persisted = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY));
    } catch (e) {
        persisted = null;
    }

    BLOCK_ORDER.forEach(key => {
        const saved = persisted && persisted[key];
        const total = BLOCK_CONFIG[key].minutes * 60;
        if (!saved || saved.total !== total) {
            timers[key] = freshTimer(key);
            return;
        }
        let remaining = saved.remaining;
        let running = saved.running;
        if (running && saved.endTime) {
            remaining = Math.round((saved.endTime - Date.now()) / 1000);
            if (remaining <= 0) {
                remaining = 0;
                running = false;
            }
        }
        timers[key] = {
            remaining: Math.max(0, remaining),
            total,
            endTime: running ? saved.endTime : null,
            interval: null,
            running: false
        };
        if (running) startTicking(key);
    });
}

function startTicking(blockKey) {
    const timer = timers[blockKey];
    timer.running = true;
    timer.interval = setInterval(() => {
        const remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
        timer.remaining = remaining;
        updateTimerDisplay(blockKey);
        if (remaining <= 0) completeBlockTimer(blockKey);
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
    timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
    timer.running = false;
    timer.endTime = null;
    persistTimers();
    updateTimerDisplay(blockKey);
    updateTimerButtons(blockKey);
}

function resetBlockTimer(blockKey) {
    const timer = timers[blockKey];
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.endTime = null;
    timer.remaining = timer.total;
    persistTimers();
    updateTimerDisplay(blockKey);
    updateTimerButtons(blockKey);
}

function completeBlockTimer(blockKey) {
    const timer = timers[blockKey];
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.endTime = null;
    timer.remaining = timer.total;
    persistTimers();
    playNotificationSound();
    if (Notification.permission === 'granted') {
        new Notification('Study session complete!', {
            body: `${BLOCK_CONFIG[blockKey].title} has finished`
        });
    }
    toggleDone(blockKey, true);
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

// ---- Mutations ---------------------------------------------------------

function toggleDone(blockKey, checked) {
    const log = ensureLog(getDateKey(currentDate));
    log.blocks[blockKey].done = checked;
    saveState();
    renderToday();
}

function updatePhrase(index, value) {
    const log = ensureLog(getDateKey(currentDate));
    log.phrases[index] = value;
    saveState();
    refreshSpeakCard();
}

function togglePhraseUsed(index, checked) {
    const log = ensureLog(getDateKey(currentDate));
    log.phrasesUsed[index] = checked;
    saveState();
}

function toggleReviewDay(checked) {
    const dateKey = getDateKey(currentDate);
    const log = ensureLog(dateKey);
    log.isReviewDay = checked;
    if (checked) {
        const weekPhrases = getWeekPhrases(getWeekKey(currentDate));
        weekPhrases.forEach(p => {
            if (!(p in log.reviewChecks)) log.reviewChecks[p] = false;
        });
    }
    saveState();
    renderToday();
}

function toggleReviewCheck(phrase, checked) {
    const log = ensureLog(getDateKey(currentDate));
    log.reviewChecks[phrase] = checked;
    saveState();
    renderToday();
}

function changeDate(delta) {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + delta);
    const today = startOfDay(new Date());
    if (next > today) return;
    currentDate = next;
    initTimersForDate();
    renderToday();
}

// ---- Rendering: Today view ----------------------------------------------

function buildStudysapuriExtra(log, isReview) {
    if (isReview) {
        const weekPhrases = getWeekPhrases(getWeekKey(currentDate));
        if (weekPhrases.length === 0) {
            return `<div class="extra-block"><p class="empty-note">No key phrases logged yet this week.</p></div>`;
        }
        const checkedCount = weekPhrases.filter(p => log.reviewChecks[p]).length;
        return `
            <div class="extra-block review-block">
                <p class="extra-label">📘 Weekly phrase review (${checkedCount}/${weekPhrases.length})</p>
                <ul class="review-phrase-list">
                    ${weekPhrases.map(p => `
                        <li>
                            <label class="review-check">
                                <input type="checkbox" class="review-check-input" data-phrase="${escapeAttr(p)}" ${log.reviewChecks[p] ? 'checked' : ''}>
                                <span>${escapeHtml(p)}</span>
                            </label>
                        </li>`).join('')}
                </ul>
            </div>`;
    }
    return `
        <div class="extra-block">
            <p class="extra-label">✏️ Key phrases to use next (up to 3/day)</p>
            <div class="phrase-inputs">
                ${[0, 1, 2].map(i => `
                    <input type="text" class="phrase-input" data-index="${i}" placeholder="Key phrase ${i + 1}" value="${escapeAttr(log.phrases[i] || '')}">
                `).join('')}
            </div>
        </div>`;
}

function buildSpeakExtra(log, isReview) {
    if (isReview) {
        const weekPhrases = getWeekPhrases(getWeekKey(currentDate));
        const checkedCount = weekPhrases.filter(p => log.reviewChecks[p]).length;
        return `<div class="extra-block"><p class="extra-label">🔁 Review day: retest this week's phrases in conversation (${checkedCount}/${weekPhrases.length})</p></div>`;
    }
    const nonEmpty = log.phrases.filter(p => p && p.trim());
    if (nonEmpty.length === 0) {
        return `<div class="extra-block"><p class="empty-note">Phrases you log in Studysapuri will appear here.</p></div>`;
    }
    return `
        <div class="extra-block">
            <p class="extra-label">💬 Use in conversation</p>
            <ul class="speak-phrase-list">
                ${log.phrases.map((p, i) => (p && p.trim()) ? `
                    <li>
                        <label class="review-check">
                            <input type="checkbox" class="phrase-used-input" data-index="${i}" ${log.phrasesUsed[i] ? 'checked' : ''}>
                            <span>${escapeHtml(p)}</span>
                        </label>
                    </li>` : '').join('')}
            </ul>
        </div>`;
}

function refreshSpeakCard() {
    const dateKey = getDateKey(currentDate);
    const log = getLogOrDefault(dateKey);
    const isReview = log.isReviewDay;
    const card = document.querySelector('.session-card[data-block="speak"] .extra-block-wrap');
    if (card) card.innerHTML = buildSpeakExtra(log, isReview);
}

function renderSessionCard(blockKey, log, isReview) {
    const cfg = BLOCK_CONFIG[blockKey];
    const done = log.blocks[blockKey].done;
    const index = BLOCK_ORDER.indexOf(blockKey) + 1;

    let extraHtml = '';
    if (blockKey === 'studysapuri') extraHtml = buildStudysapuriExtra(log, isReview);
    if (blockKey === 'speak') extraHtml = `<div class="extra-block-wrap">${buildSpeakExtra(log, isReview)}</div>`;

    const subtitle = (isReview && blockKey === 'studysapuri') ? 'Phrase review & retest' : cfg.subtitle;

    return `
        <div class="session-card ${done ? 'done' : ''}" data-block="${blockKey}">
            <div class="session-card-header">
                <div class="session-title">
                    <span class="session-index">${index}</span>
                    <div>
                        <h3>${cfg.title} <span class="session-minutes">(${cfg.minutes} min)</span></h3>
                        <p class="session-subtitle">${subtitle}</p>
                    </div>
                </div>
                <label class="done-checkbox">
                    <input type="checkbox" class="done-input" data-block="${blockKey}" ${done ? 'checked' : ''}>
                    <span>Done</span>
                </label>
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
    reviewDayToggle.checked = log.isReviewDay;
    nextDayBtn.disabled = currentDate >= today;

    const minutes = calcMinutes(log);
    const completed = calcSessionsCompleted(log);
    minutesTodayLabel.textContent = minutes;
    sessionsCompletedLabel.textContent = `Sessions completed: ${completed} / ${BLOCK_ORDER.length}`;
    progressBarFill.style.width = `${Math.min(100, (minutes / TOTAL_MINUTES) * 100)}%`;

    sessionList.innerHTML = BLOCK_ORDER.map(key => renderSessionCard(key, log, log.isReviewDay)).join('');

    syncAllTimerDisplays();
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
    const totalPhrases = allLogs.reduce((sum, log) => sum + log.phrases.filter(p => p && p.trim()).length, 0);
    const reviewDays = allLogs.filter(log => log.isReviewDay).length;

    const stats = [
        { icon: '🔥', value: computeCurrentStreak(), label: 'Current Streak' },
        { icon: '🏆', value: computeLongestStreak(), label: 'Longest Streak' },
        { icon: '📚', value: daysStudied, label: 'Total Study Days' },
        { icon: '⏱️', value: `${totalHours}h`, label: 'Total Study Time' },
        { icon: '💡', value: totalPhrases, label: 'Total Phrases Logged' },
        { icon: '🔁', value: reviewDays, label: 'Review Days Completed' }
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
        historyTableBody.innerHTML = `<tr><td colspan="5" class="empty-note">No records yet</td></tr>`;
        return;
    }
    historyTableBody.innerHTML = sortedKeys.slice(0, 60).map(dateKey => {
        const log = state.logs[dateKey];
        const completed = calcSessionsCompleted(log);
        const minutes = calcMinutes(log);
        const phraseCount = log.phrases.filter(p => p && p.trim()).length;
        return `
            <tr>
                <td>${formatDateLabel(dateFromKey(dateKey))}</td>
                <td>${completed} / 4</td>
                <td>${minutes} min</td>
                <td>${phraseCount}</td>
                <td>${log.isReviewDay ? '✓' : '-'}</td>
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
        saveState();
        initTimersForDate();
        renderToday();
        renderCumulative();
        alert('Data imported successfully.');
    };
    reader.readAsText(file);
}

// ---- Event wiring --------------------------------------------------------

function setupEventListeners() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentTab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.toggle('active', b === btn));
            views.forEach(v => v.classList.toggle('active', v.id === `${currentTab}View`));
            if (currentTab === 'cumulative') renderCumulative();
        });
    });

    prevDayBtn.addEventListener('click', () => changeDate(-1));
    nextDayBtn.addEventListener('click', () => changeDate(1));

    reviewDayToggle.addEventListener('change', (e) => toggleReviewDay(e.target.checked));

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
            togglePhraseUsed(parseInt(e.target.dataset.index, 10), e.target.checked);
        } else if (e.target.classList.contains('review-check-input')) {
            toggleReviewCheck(e.target.dataset.phrase, e.target.checked);
        }
    });

    sessionList.addEventListener('input', (e) => {
        if (e.target.classList.contains('phrase-input')) {
            updatePhrase(parseInt(e.target.dataset.index, 10), e.target.value);
        }
    });

    exportBtn.addEventListener('click', exportData);
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importData(file);
        importFileInput.value = '';
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
