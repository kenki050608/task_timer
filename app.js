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
const quizState = { vocab: null, idioms: null };

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
            if (!raw.resumeNotes || typeof raw.resumeNotes !== 'object') raw.resumeNotes = {};
            return raw;
        }
    } catch (e) {
        // ignore malformed data and fall back to a fresh state
    }
    return { logs: {}, vocab: [], idioms: [], resumeNotes: {} };
}

function getResumeNote(blockKey) {
    return (state.resumeNotes && state.resumeNotes[blockKey]) || '';
}

function setResumeNote(blockKey, value) {
    if (!state.resumeNotes) state.resumeNotes = {};
    state.resumeNotes[blockKey] = value;
    saveState();
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
    const rounded = Math.floor(totalSeconds);
    const m = Math.floor(rounded / 60);
    const s = rounded % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMinutesValue(minutes) {
    const rounded = Math.round(minutes * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ---- Derived data ----------------------------------------------------------

function calcBlockSeconds(log, blockKey) {
    // Study time is only ever written when the End button is pressed — Done is
    // purely a "this item is finished" marker and never affects the time count.
    return log.blocks[blockKey].secondsSpent || 0;
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
// Each timer tracks elapsed real time since it was last started, counting
// down while under the block's nominal duration and then continuing to count
// UP (overtime) past it — the widget never auto-stops. Study time is only
// ever written to the day's log when the End button is pressed; Start,
// Pause, and Reset only affect the widget itself:
//   - Pause freezes the elapsed time so Start can resume it later
//   - Reset discards the widget's elapsed time and returns it to a fresh
//     countdown, without recording anything
//   - End records the widget's current elapsed time into that day's total
//     (adding to whatever was already recorded today for that block), then
//     resets the widget for next time
// Done is a separate, independent "this item is finished" marker (used for
// the sessions-completed count) and never affects the time count.

const TIMER_STORAGE_KEY = 'englishLearningTrackerTimers';

function computeElapsed(timer) {
    return timer.elapsedBase + (timer.running ? (Date.now() - timer.runStart) / 1000 : 0);
}

function freshTimer(blockKey) {
    const total = BLOCK_CONFIG[blockKey].minutes * 60;
    return { total, elapsedBase: 0, running: false, runStart: null, interval: null, overtimeNotified: false };
}

function initTimersForDate() {
    BLOCK_ORDER.forEach(key => {
        const timer = timers[key];
        if (timer && timer.interval) clearInterval(timer.interval);
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
            elapsedBase: t.elapsedBase,
            runStart: t.runStart,
            overtimeNotified: t.overtimeNotified
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
        if (!saved || saved.total !== total || typeof saved.elapsedBase !== 'number' || !isFinite(saved.elapsedBase)) {
            timers[key] = freshTimer(key);
            return;
        }
        const wasRunning = saved.running;
        const elapsed = saved.elapsedBase + (wasRunning && saved.runStart ? (Date.now() - saved.runStart) / 1000 : 0);
        if (!isFinite(elapsed)) {
            timers[key] = freshTimer(key);
            return;
        }
        timers[key] = {
            total,
            elapsedBase: elapsed,
            running: false,
            runStart: null,
            interval: null,
            overtimeNotified: !!saved.overtimeNotified || elapsed >= total
        };
        if (wasRunning) startTicking(key);
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
    timer.runStart = Date.now();
    timer.interval = setInterval(() => {
        const elapsed = computeElapsed(timer);
        if (elapsed >= timer.total && !timer.overtimeNotified) {
            timer.overtimeNotified = true;
            playNotificationSound();
            if (Notification.permission === 'granted') {
                new Notification("Time's up!", {
                    body: `${BLOCK_CONFIG[blockKey].title} is now counting overtime`
                });
            }
        }
        updateTimerDisplay(blockKey);
    }, 1000);
}

function startBlockTimer(blockKey) {
    const timer = timers[blockKey];
    if (timer.running) return;
    startTicking(blockKey);
    persistTimers();
    updateTimerButtons(blockKey);
}

function pauseBlockTimer(blockKey) {
    const timer = timers[blockKey];
    if (!timer.running) return;
    timer.elapsedBase = computeElapsed(timer);
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.runStart = null;
    persistTimers();
    updateTimerDisplay(blockKey);
    updateTimerButtons(blockKey);
}

function resetBlockTimer(blockKey) {
    const timer = timers[blockKey];
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.runStart = null;
    timer.elapsedBase = 0;
    timer.overtimeNotified = false;
    persistTimers();
    updateTimerDisplay(blockKey);
    updateTimerButtons(blockKey);

    const log = ensureLog(getDateKey(currentDate));
    if (log.blocks[blockKey].secondsSpent) {
        log.blocks[blockKey].secondsSpent = 0;
        saveState();
    }
    updateProgressSummaryDisplay();
}

function endBlockTimer(blockKey) {
    const timer = timers[blockKey];
    const elapsed = Math.round(computeElapsed(timer));
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.runStart = null;
    timer.elapsedBase = 0;
    timer.overtimeNotified = false;
    persistTimers();
    updateTimerDisplay(blockKey);
    updateTimerButtons(blockKey);

    if (elapsed > 0) {
        const log = ensureLog(getDateKey(currentDate));
        log.blocks[blockKey].secondsSpent = (log.blocks[blockKey].secondsSpent || 0) + elapsed;
        saveState();
    }
    updateProgressSummaryDisplay();
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
    const rawElapsed = computeElapsed(timer);
    const elapsed = isFinite(rawElapsed) ? rawElapsed : 0;
    const isOvertime = elapsed >= timer.total;
    const display = document.getElementById(`display-${blockKey}`);
    const ring = document.getElementById(`ring-${blockKey}`);
    if (display) {
        display.textContent = isOvertime ? `+${formatMMSS(elapsed - timer.total)}` : formatMMSS(timer.total - elapsed);
        display.classList.toggle('overtime', isOvertime);
    }
    if (ring) {
        const remaining = Math.max(0, timer.total - elapsed);
        const progress = remaining / timer.total;
        ring.style.strokeDasharray = MINI_CIRCUMFERENCE;
        ring.style.strokeDashoffset = MINI_CIRCUMFERENCE * (1 - progress);
        ring.classList.toggle('overtime', isOvertime);
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
    const entry = { id: makeId(), term: trimmedTerm, note: (note || '').trim(), dateKey: getDateKey(new Date()) };
    state[type].push(entry);
    saveState();
    renderNotebookPages();
}

function deleteNotebookEntry(type, id) {
    state[type] = state[type].filter(entry => entry.id !== id);
    saveState();
    renderNotebookPages();
    if (currentTab === 'cumulative') renderCumulative();
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

function renderSessionCard(blockKey, log) {
    const cfg = BLOCK_CONFIG[blockKey];
    const done = log.blocks[blockKey].done;
    const index = BLOCK_ORDER.indexOf(blockKey) + 1;

    const subtitle = cfg.subtitle;
    const logoClass = cfg.logoLabel ? 'session-logo session-logo-custom' : 'session-logo';
    const titleHtml = cfg.logoUrl
        ? `<img src="${escapeAttr(cfg.logoUrl)}" alt="${escapeAttr(cfg.title)}" title="${escapeAttr(cfg.title)}" class="${logoClass}" onerror="handleLogoError(this)">${cfg.logoLabel ? ` ${escapeHtml(cfg.logoLabel)}` : ''}`
        : cfg.title;

    const resumeNoteHtml = `
        <div class="extra-block">
            <p class="extra-label">📍 Resume point for next time</p>
            <input type="text" class="phrase-input resume-note-input" data-block="${blockKey}" value="${escapeAttr(getResumeNote(blockKey))}">
        </div>`;

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
                    <button class="btn-small btn-end timer-end" data-block="${blockKey}">End</button>
                </div>
            </div>
            ${resumeNoteHtml}
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

// ---- Quiz ------------------------------------------------------------------

function pickQuizQuestion(type) {
    const entries = state[type] || [];
    if (entries.length === 0) return null;
    const entry = entries[Math.floor(Math.random() * entries.length)];
    let direction = Math.random() < 0.5 ? 'termToNote' : 'noteToTerm';
    if (!entry.note && direction === 'noteToTerm') direction = 'termToNote';
    return { entry, direction };
}

function startQuiz(type) {
    const question = pickQuizQuestion(type);
    if (!question) return;
    quizState[type] = { current: question, revealed: false, count: 1 };
    renderNotebookPages();
}

function revealQuiz(type) {
    const quiz = quizState[type];
    if (!quiz || quiz.revealed) return;
    quiz.revealed = true;
    renderNotebookPages();
}

function nextQuizQuestion(type) {
    const quiz = quizState[type];
    if (!quiz) return;
    quiz.current = pickQuizQuestion(type);
    quiz.revealed = false;
    quiz.count++;
    renderNotebookPages();
}

function endQuiz(type) {
    quizState[type] = null;
    renderNotebookPages();
}

function renderQuizSection(type) {
    const quiz = quizState[type];
    const entries = state[type] || [];

    if (!quiz) {
        return `
            <div class="card quiz-card" data-type="${type}">
                <h3>🎲 Practice Quiz</h3>
                ${entries.length === 0
                    ? `<p class="empty-note">Add a few entries first to start a quiz.</p>`
                    : `<button class="btn btn-primary quiz-start-btn" data-type="${type}">Start Quiz</button>`}
            </div>`;
    }

    if (!quiz.current) {
        return `
            <div class="card quiz-card" data-type="${type}">
                <h3>🎲 Practice Quiz</h3>
                <p class="empty-note">No entries left to quiz on.</p>
                <button class="btn-small btn-secondary quiz-end-btn" data-type="${type}">End Quiz</button>
            </div>`;
    }

    const { entry, direction } = quiz.current;
    const promptLabel = direction === 'termToNote' ? 'What does this mean?' : "What's the word or phrase?";
    const prompt = direction === 'termToNote' ? entry.term : entry.note;
    const answer = direction === 'termToNote' ? (entry.note || '(no meaning saved)') : entry.term;

    return `
        <div class="card quiz-card" data-type="${type}">
            <div class="quiz-header">
                <h3>🎲 Practice Quiz</h3>
                <span class="quiz-score">Question ${quiz.count}</span>
            </div>
            <div class="quiz-tap-area" data-type="${type}">
                <p class="quiz-prompt-label">${promptLabel}</p>
                <p class="quiz-prompt">${escapeHtml(prompt)}</p>
                ${quiz.revealed
                    ? `<p class="quiz-answer">${escapeHtml(answer)}</p>`
                    : `<p class="quiz-tap-hint">Tap to reveal answer</p>`}
            </div>
            <div class="quiz-actions">
                ${quiz.revealed ? `<button class="btn-small btn-primary quiz-next-btn" data-type="${type}">NEXT</button>` : ''}
                <button class="btn-small btn-secondary quiz-end-btn" data-type="${type}">End Quiz</button>
            </div>
        </div>`;
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
        notebookPages[type].innerHTML = renderQuizSection(type) + renderNotebookCard(type);
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
        if (!state.resumeNotes || typeof state.resumeNotes !== 'object') state.resumeNotes = {};
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
        const startBtn = e.target.closest('.quiz-start-btn');
        if (startBtn) { startQuiz(startBtn.dataset.type); return; }
        const tapArea = e.target.closest('.quiz-tap-area');
        if (tapArea) { revealQuiz(tapArea.dataset.type); return; }
        const nextBtn = e.target.closest('.quiz-next-btn');
        if (nextBtn) { nextQuizQuestion(nextBtn.dataset.type); return; }
        const endBtn = e.target.closest('.quiz-end-btn');
        if (endBtn) { endQuiz(endBtn.dataset.type); return; }
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
        const endBtn = e.target.closest('.timer-end');
        if (endBtn) { endBlockTimer(endBtn.dataset.block); return; }
    });

    sessionList.addEventListener('change', (e) => {
        if (e.target.classList.contains('done-input')) {
            toggleDone(e.target.dataset.block, e.target.checked);
        }
    });

    sessionList.addEventListener('input', (e) => {
        if (e.target.classList.contains('resume-note-input')) {
            setResumeNote(e.target.dataset.block, e.target.value);
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
