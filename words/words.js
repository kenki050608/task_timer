// ==========================================================================
// ビジネス英単語 500 — 単語学習アプリ
// 例文つきの500語を、フラッシュカード／4択／例文穴埋めで覚えるための
// 学習アプリ。進捗は Leitner 方式の間隔反復で管理し、記録は
// localStorage にだけ保存する。
// ==========================================================================

const STORAGE_KEY = 'businessEnglishWords500';

// Leitner box -> 次に出題するまでの日数。box 4 以上（= 7日以上あけても
// 思い出せる状態）を「習得済み」として扱う。
const INTERVALS = [0, 1, 2, 4, 7, 14, 30];
const MAX_BOX = INTERVALS.length - 1;
const MASTERED_BOX = 4;
const LIST_PAGE_SIZE = 60;

const SCOPE_LABELS = {
    smart: 'おまかせ復習',
    new: '未学習',
    weak: '苦手',
    starred: '★ マーク',
    all: '全部'
};

const MODE_LABELS = {
    flash: 'フラッシュカード',
    en2ja: '英→日（意味を答える）',
    ja2en: '日→英（英語を答える）',
    cloze: '例文穴埋め',
    mix: 'ミックス'
};

const QUIZ_MODES = ['en2ja', 'ja2en', 'cloze'];

const WORDS_BY_NUM = new Map(WORDS.map((w) => [w.n, w]));
const CATEGORY_TITLE = new Map(CATEGORIES.map((c) => [c.id, c.title]));

let state = loadState();
let currentTab = 'study';
let session = null;
let listLimit = LIST_PAGE_SIZE;
let toastTimer = null;

const setup = {
    scope: 'smart',
    category: 'all',
    mode: 'flash',
    size: 20
};

// ==========================================================================
// State
// ==========================================================================

function defaultState() {
    return {
        version: 1,
        settings: { goal: 20, rate: 0.9, autoSpeak: true, inputMode: 'voice' },
        words: {},
        daily: {}
    };
}

function loadState() {
    const base = defaultState();
    let raw = null;
    try {
        raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (err) {
        raw = null;
    }
    if (!raw || typeof raw !== 'object') return base;
    return normalizeState(raw, base);
}

function normalizeState(raw, base) {
    const next = base;
    if (raw.settings && typeof raw.settings === 'object') {
        const goal = Number(raw.settings.goal);
        const rate = Number(raw.settings.rate);
        if (Number.isFinite(goal) && goal >= 1) next.settings.goal = Math.min(200, Math.round(goal));
        if (Number.isFinite(rate) && rate > 0) next.settings.rate = Math.min(2, Math.max(0.5, rate));
        next.settings.autoSpeak = raw.settings.autoSpeak !== false;
        if (raw.settings.inputMode === 'text' || raw.settings.inputMode === 'voice') {
            next.settings.inputMode = raw.settings.inputMode;
        }
    }
    if (raw.words && typeof raw.words === 'object') {
        Object.keys(raw.words).forEach((key) => {
            const num = Number(key);
            if (!WORDS_BY_NUM.has(num)) return;
            const p = raw.words[key];
            if (!p || typeof p !== 'object') return;
            next.words[num] = {
                box: clampInt(p.box, 0, MAX_BOX, 0),
                due: typeof p.due === 'string' ? p.due : null,
                seen: clampInt(p.seen, 0, 99999, 0),
                correct: clampInt(p.correct, 0, 99999, 0),
                wrong: clampInt(p.wrong, 0, 99999, 0),
                star: p.star === true,
                last: typeof p.last === 'string' ? p.last : null
            };
        });
    }
    if (raw.daily && typeof raw.daily === 'object') {
        Object.keys(raw.daily).forEach((key) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
            const d = raw.daily[key];
            if (!d || typeof d !== 'object') return;
            next.daily[key] = {
                studied: clampInt(d.studied, 0, 99999, 0),
                correct: clampInt(d.correct, 0, 99999, 0),
                wrong: clampInt(d.wrong, 0, 99999, 0)
            };
        });
    }
    return next;
}

// 500語中1語でも「0%」と出ないように、1%未満は小数第1位まで表示する。
function pctLabel(part, total) {
    if (!total) return '0%';
    const pct = (part / total) * 100;
    return `${pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
}

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        showToast('保存できませんでした（ブラウザの保存容量を確認してください）');
    }
}

function getProgress(num) {
    return state.words[num] || null;
}

function ensureProgress(num) {
    if (!state.words[num]) {
        state.words[num] = { box: 0, due: null, seen: 0, correct: 0, wrong: 0, star: false, last: null };
    }
    return state.words[num];
}

function statusOf(num) {
    const p = getProgress(num);
    if (!p || p.seen === 0) return 'new';
    if (p.box >= MASTERED_BOX) return 'mastered';
    return 'learning';
}

function isWeak(num) {
    const p = getProgress(num);
    return !!p && p.wrong >= 2 && p.box < MASTERED_BOX;
}

function isStarred(num) {
    const p = getProgress(num);
    return !!p && p.star === true;
}

function isDue(num, today) {
    const p = getProgress(num);
    if (!p || p.seen === 0) return false;
    if (!p.due) return true;
    return p.due <= today;
}

// ==========================================================================
// Dates
// ==========================================================================

function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function todayKey() {
    return dateKey(new Date());
}

function addDaysKey(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return dateKey(date);
}

function dayEntry(key) {
    if (!state.daily[key]) state.daily[key] = { studied: 0, correct: 0, wrong: 0 };
    return state.daily[key];
}

function currentStreak() {
    let key = todayKey();
    // 今日まだ学習していなくても、昨日までの連続記録は途切れていない。
    if (!state.daily[key] || state.daily[key].studied === 0) key = addDaysKey(key, -1);
    let streak = 0;
    while (state.daily[key] && state.daily[key].studied > 0) {
        streak += 1;
        key = addDaysKey(key, -1);
    }
    return streak;
}

// ==========================================================================
// Speech
// ==========================================================================

const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function speak(text) {
    if (!speechSupported || !text) return;
    try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'en-US';
        utter.rate = state.settings.rate;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
    } catch (err) {
        /* 読み上げ非対応の環境では黙って諦める */
    }
}

// ==========================================================================
// Queue building
// ==========================================================================

function poolForCategory() {
    if (setup.category === 'all') return WORDS.slice();
    const cat = Number(setup.category);
    return WORDS.filter((w) => w.cat === cat);
}

function buildQueue() {
    const today = todayKey();
    const pool = poolForCategory();
    let picked = [];

    if (setup.scope === 'smart') {
        const due = pool
            .filter((w) => isDue(w.n, today))
            .sort((a, b) => {
                const pa = getProgress(a.n);
                const pb = getProgress(b.n);
                const da = pa.due || '0000-00-00';
                const db = pb.due || '0000-00-00';
                if (da !== db) return da < db ? -1 : 1;
                return pa.box - pb.box;
            });
        const fresh = pool.filter((w) => statusOf(w.n) === 'new');
        picked = due.concat(fresh);
    } else if (setup.scope === 'new') {
        picked = pool.filter((w) => statusOf(w.n) === 'new');
    } else if (setup.scope === 'weak') {
        picked = pool.filter((w) => isWeak(w.n)).sort((a, b) => getProgress(b.n).wrong - getProgress(a.n).wrong);
    } else if (setup.scope === 'starred') {
        picked = pool.filter((w) => isStarred(w.n));
    } else {
        picked = shuffle(pool.slice());
    }

    return picked.slice(0, setup.size);
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ==========================================================================
// 答え合わせ
// 入力式（テキスト／音声）なので、表記ゆれと聞き取りのゆれを許容して
// 判定する。判定が厳しすぎたときのために、結果画面から「やっぱり正解に
// する」で自己申告もできる。
// ==========================================================================

function normalizeEn(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeJa(text) {
    return String(text)
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/[\s\u3000]/g, '')
        .replace(/[、。，．,.!！?？「」『』（）()・…~〜\-ー]/g, '')
        .toLowerCase();
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const row = [i];
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        prev = row;
    }
    return prev[b.length];
}

function similarity(a, b) {
    if (!a || !b) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function dropLeadingArticle(text) {
    return text.replace(/^(a|an|the|to) /, '');
}

// 英語の正解候補。見出し語のほか、例文中の活用形も正解とみなす。
function englishAnswers(word) {
    const set = new Set();
    const add = (text) => {
        const normalized = normalizeEn(text);
        if (normalized) set.add(normalized);
    };
    add(word.en);
    const target = blankTarget(word);
    if (target) add(target);
    return Array.from(set);
}

function judgeEnglish(input, word) {
    const answer = normalizeEn(input);
    if (!answer) return false;
    const stripped = dropLeadingArticle(answer);
    return englishAnswers(word).some((candidate) => {
        const ref = dropLeadingArticle(candidate);
        if (candidate === answer || ref === stripped) return true;
        // 打ち間違いと聞き取りのゆれを1文字ぶんだけ許す。
        if (ref.length >= 5 && levenshtein(ref, stripped) <= 1) return true;
        return false;
    });
}

// 日本語の正解候補。「草案／下書きする」「総意、合意」のように複数の訳が
// 入っている見出しは、どれか1つ言えれば正解にする。
function japaneseAnswers(word) {
    const parts = word.ja.split(/[／\/、]/).map(normalizeJa).filter(Boolean);
    return parts.length ? parts : [normalizeJa(word.ja)];
}

function judgeJapanese(input, word) {
    const answer = normalizeJa(input);
    if (!answer || answer.length < 2) return false;
    return japaneseAnswers(word).some((candidate) => {
        if (candidate === answer) return true;
        // 「議題のことです」のように言い足した場合も正解にする。
        if (candidate.length >= 2 && answer.includes(candidate)) return true;
        // 「事後に報告する」に対する「報告する」のような短い言い方も許す。
        if (candidate.includes(answer) && answer.length >= Math.max(2, candidate.length * 0.5)) return true;
        return similarity(candidate, answer) >= 0.7;
    });
}

function judgeAnswer(input, word, mode) {
    return mode === 'en2ja' ? judgeJapanese(input, word) : judgeEnglish(input, word);
}

// ==========================================================================
// 音声入力（Web Speech API）
// ==========================================================================

const SpeechRecognitionCtor = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
const recognitionSupported = !!SpeechRecognitionCtor;
let recognition = null;

function stopListening() {
    if (!recognition) return;
    const current = recognition;
    recognition = null;
    try {
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        current.abort();
    } catch (err) {
        /* すでに停止しているときは何もしない */
    }
}

// handlers: { onInterim(text), onFinal(alternatives), onError(code), onEnd() }
function startListening(lang, handlers) {
    if (!recognitionSupported) {
        handlers.onError('unsupported');
        return;
    }
    stopListening();
    if (speechSupported) window.speechSynthesis.cancel();
    let instance;
    try {
        instance = new SpeechRecognitionCtor();
    } catch (err) {
        handlers.onError('unsupported');
        return;
    }
    recognition = instance;
    instance.lang = lang;
    instance.interimResults = true;
    instance.maxAlternatives = 4;
    instance.continuous = false;
    instance.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        if (!result) return;
        if (!result.isFinal) {
            handlers.onInterim(result[0] ? result[0].transcript : '');
            return;
        }
        const alternatives = [];
        for (let i = 0; i < result.length; i += 1) alternatives.push(result[i].transcript);
        recognition = null;
        handlers.onFinal(alternatives);
    };
    instance.onerror = (event) => {
        recognition = null;
        handlers.onError(event.error || 'error');
    };
    instance.onend = () => {
        if (recognition === instance) recognition = null;
        handlers.onEnd();
    };
    try {
        instance.start();
    } catch (err) {
        recognition = null;
        handlers.onError('error');
    }
}

const RECOGNITION_ERRORS = {
    'not-allowed': 'マイクの使用が許可されていません。端末の設定で許可するか、テキスト入力に切り替えてください。',
    'service-not-allowed': 'マイクの使用が許可されていません。端末の設定で許可するか、テキスト入力に切り替えてください。',
    'no-speech': '聞き取れませんでした。もう一度話してください。',
    'audio-capture': 'マイクが見つかりません。テキスト入力に切り替えてください。',
    network: '音声認識に接続できません。テキスト入力に切り替えてください。',
    aborted: '',
    unsupported: 'この端末のブラウザは音声入力に対応していません。テキスト入力を使ってください。'
};

// 例文の中から、その単語（活用形を含む）を切り出す。
function blankTarget(word) {
    const first = word.en.split(' ')[0];
    const candidates = [
        word.en,
        word.en.replace(/e$/, ''),
        first,
        first.replace(/e$/, ''),
        first.replace(/y$/, 'i'),
        first.length > 5 ? first.slice(0, first.length - 2) : null
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const re = new RegExp(escapeRegExp(candidate) + "[a-z']*", 'i');
        const match = re.exec(word.ex);
        if (match) return match[0];
    }
    return null;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================================================
// Rendering helpers
// ==========================================================================

function el(id) {
    return document.getElementById(id);
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

function exampleHtml(word) {
    const target = blankTarget(word);
    const en = escapeHtml(word.ex);
    const highlighted = target
        ? en.replace(escapeHtml(target), `<b>${escapeHtml(target)}</b>`)
        : en;
    return `<div class="example">
        <div class="example-en">${highlighted}</div>
        <div class="example-ja">${escapeHtml(word.exJa)}</div>
    </div>`;
}

function showToast(message) {
    const toast = el('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

// ==========================================================================
// 学習タブ
// ==========================================================================

function renderSetup() {
    const today = todayKey();
    const done = state.daily[today] ? state.daily[today].studied : 0;
    const goal = state.settings.goal;
    el('todayDone').textContent = done;
    el('todayGoal').textContent = goal;
    el('todayBar').style.width = `${Math.min(100, (done / goal) * 100)}%`;
    el('todayStreak').textContent = `🔥 ${currentStreak()}日連続`;

    const dueCount = WORDS.filter((w) => isDue(w.n, today)).length;
    const newCount = WORDS.filter((w) => statusOf(w.n) === 'new').length;
    const mastered = WORDS.filter((w) => statusOf(w.n) === 'mastered').length;
    el('dueSummary').textContent = `復習すべき語 ${dueCount} ／ 未学習 ${newCount} ／ 習得済み ${mastered}`;

    renderInputChips();
    const queue = buildQueue();
    const hint = el('startHint');
    const startBtn = el('startBtn');
    if (queue.length === 0) {
        startBtn.disabled = true;
        startBtn.style.opacity = '0.5';
        hint.textContent = setup.scope === 'smart'
            ? '今日の復習はすべて終わりました。「全部」や「未学習」に切り替えると続けられます。'
            : 'この条件に当てはまる単語がありません。範囲を変えてください。';
    } else {
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        hint.textContent = `${SCOPE_LABELS[setup.scope]}／${MODE_LABELS[setup.mode]}／${queue.length}語で出題します。`;
    }
}

// 解答方法（音声／テキスト）のチップを、設定と端末の対応状況に合わせる。
function renderInputChips() {
    const mode = effectiveInputMode();
    document.querySelectorAll('#inputChips .chip, #settingsInputChips .chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.input === mode);
        if (chip.dataset.input === 'voice') chip.disabled = !recognitionSupported;
    });
    const hint = el('inputHint');
    if (!hint) return;
    if (setup.mode === 'flash') {
        hint.textContent = 'フラッシュカードは自分で正誤を選ぶので、解答方法は使いません。';
    } else if (!recognitionSupported) {
        hint.textContent = 'この端末のブラウザは音声入力に対応していないため、文字入力で出題します。';
    } else if (mode === 'voice') {
        hint.textContent = '声に出して答えます。カードの上でいつでも文字入力に切り替えられます。';
    } else {
        hint.textContent = '文字で答えます。カードの上でいつでも音声に切り替えられます。';
    }
}

function effectiveInputMode() {
    return recognitionSupported ? state.settings.inputMode : 'text';
}

function setInputMode(mode) {
    stopListening();
    state.settings.inputMode = mode;
    saveState();
    renderInputChips();
}

function startSession() {
    const words = buildQueue();
    if (words.length === 0) return;
    session = {
        items: words.map((w) => ({ num: w.n, mode: resolveMode(), repeat: false })),
        index: 0,
        graded: new Set(),
        requeued: new Set(),
        correct: 0,
        wrong: 0,
        missed: []
    };
    el('studySetup').hidden = true;
    el('studyResult').hidden = true;
    el('studySession').hidden = false;
    renderCard();
}

function resolveMode() {
    if (setup.mode !== 'mix') return setup.mode;
    return QUIZ_MODES[Math.floor(Math.random() * QUIZ_MODES.length)];
}

function renderSessionBar() {
    const total = session.items.length;
    const done = session.index;
    el('sessionBar').style.width = `${(done / total) * 100}%`;
    el('sessionCounter').textContent = `${Math.min(done + 1, total)} / ${total}`;
    el('sessionScore').textContent = `⭕ ${session.correct} ／ ❌ ${session.wrong}`;
}

function renderCard() {
    stopListening();
    if (!session || session.index >= session.items.length) {
        finishSession();
        return;
    }
    renderSessionBar();
    const item = session.items[session.index];
    const word = WORDS_BY_NUM.get(item.num);
    const area = el('cardArea');
    const head = `
        <div class="qcat"><span class="qnum">#${word.n}</span>${escapeHtml(CATEGORY_TITLE.get(word.cat))}${item.repeat ? '　🔁 もう一度' : ''}</div>
        <button class="star-toggle ${isStarred(word.n) ? 'on' : ''}" id="starBtn" aria-label="苦手マーク">${isStarred(word.n) ? '★' : '☆'}</button>`;

    if (item.mode === 'flash') {
        area.innerHTML = `<div class="qcard">
            ${head}
            <div class="qword">${escapeHtml(word.en)}</div>
            <button class="speak-btn" data-speak="${escapeHtml(word.en)}">🔊 発音</button>
            <div class="qprompt">意味を思い出したらタップ</div>
            <div class="card-actions"><button class="btn btn-primary" id="flipBtn">答えを見る</button></div>
        </div>`;
        el('flipBtn').addEventListener('click', () => revealFlash(word));
    } else if (item.mode === 'en2ja') {
        area.innerHTML = `<div class="qcard">
            ${head}
            <div class="qword">${escapeHtml(word.en)}</div>
            <button class="speak-btn" data-speak="${escapeHtml(word.en)}">🔊 発音</button>
            <div class="qprompt">意味を日本語で答えてください</div>
            <div class="answer-area" id="answerArea"></div>
        </div>`;
        mountAnswerArea(word, {
            mode: 'en2ja',
            lang: 'ja-JP',
            placeholder: '日本語で入力',
            micLabel: '🎤 日本語で答える'
        });
    } else if (item.mode === 'ja2en') {
        area.innerHTML = `<div class="qcard">
            ${head}
            <div class="qword-ja">${escapeHtml(word.ja)}</div>
            <div class="qprompt">英語で答えてください</div>
            <div class="answer-area" id="answerArea"></div>
        </div>`;
        mountAnswerArea(word, {
            mode: 'ja2en',
            lang: 'en-US',
            placeholder: '英語で入力',
            micLabel: '🎤 英語で答える'
        });
    } else {
        const target = blankTarget(word) || word.en;
        const sentence = escapeHtml(word.ex).replace(escapeHtml(target), '<span class="blank">　？　</span>');
        area.innerHTML = `<div class="qcard">
            ${head}
            <div class="cloze-sentence">${sentence}</div>
            <div class="example-ja">${escapeHtml(word.exJa)}</div>
            <div class="qprompt">「${escapeHtml(word.ja)}」にあたる英語を答えてください</div>
            <div class="answer-area" id="answerArea"></div>
        </div>`;
        mountAnswerArea(word, {
            mode: 'cloze',
            lang: 'en-US',
            placeholder: '英語で入力',
            micLabel: '🎤 英語で答える',
            target
        });
    }

    const star = el('starBtn');
    if (star) {
        star.addEventListener('click', () => {
            const p = ensureProgress(word.n);
            p.star = !p.star;
            saveState();
            star.textContent = p.star ? '★' : '☆';
            star.classList.toggle('on', p.star);
        });
    }
    area.querySelectorAll('[data-speak]').forEach((btn) => {
        btn.addEventListener('click', () => speak(btn.dataset.speak));
    });
}

function revealFlash(word) {
    const area = el('cardArea');
    const card = area.querySelector('.qcard');
    const actions = card.querySelector('.card-actions');
    card.querySelector('.qprompt').remove();
    const block = document.createElement('div');
    block.className = 'answer-block';
    block.innerHTML = `<div class="answer-ja">${escapeHtml(word.ja)}</div>${exampleHtml(word)}
        <button class="speak-btn" data-speak="${escapeHtml(word.ex)}">🔊 例文を読む</button>`;
    card.insertBefore(block, actions);
    block.querySelector('[data-speak]').addEventListener('click', (e) => speak(e.currentTarget.dataset.speak));
    if (state.settings.autoSpeak) speak(word.ex);
    actions.innerHTML = '';
    const again = document.createElement('button');
    again.className = 'btn btn-danger';
    again.textContent = 'もう一度';
    again.addEventListener('click', () => grade(word, false));
    const got = document.createElement('button');
    got.className = 'btn btn-primary';
    got.textContent = '覚えた';
    got.addEventListener('click', () => grade(word, true));
    actions.appendChild(again);
    actions.appendChild(got);
}

// 解答エリアを組み立てる。音声入力とテキスト入力はその場で切り替えられ、
// 選んだ方法は設定として次回以降も引き継がれる。
function mountAnswerArea(word, config) {
    const area = el('answerArea');
    const useVoice = state.settings.inputMode === 'voice' && recognitionSupported;
    area.innerHTML = `
        <div class="input-switch">
            <button class="switch-btn ${useVoice ? 'on' : ''}" data-input="voice"${recognitionSupported ? '' : ' disabled'}>🎤 音声</button>
            <button class="switch-btn ${useVoice ? '' : 'on'}" data-input="text">⌨️ テキスト</button>
        </div>
        ${useVoice ? `
            <button class="mic-btn" id="micBtn">${config.micLabel}</button>
            <div class="transcript" id="transcript"></div>
        ` : `
            <input type="text" class="input" id="answerInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${config.placeholder}" ${config.mode === 'en2ja' ? '' : 'inputmode="latin"'}>
        `}
        <div class="card-actions">
            <button class="btn btn-secondary" id="giveUpBtn">わからない</button>
            ${useVoice ? '' : '<button class="btn btn-primary" id="checkBtn">答え合わせ</button>'}
        </div>
        ${recognitionSupported ? '' : '<p class="hint">この端末では音声入力が使えないため、テキスト入力で表示しています。</p>'}`;

    area.querySelectorAll('[data-input]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            stopListening();
            state.settings.inputMode = btn.dataset.input;
            saveState();
            mountAnswerArea(word, config);
        });
    });

    el('giveUpBtn').addEventListener('click', () => {
        stopListening();
        resolveAnswer(word, config, false, '');
    });

    if (useVoice) {
        el('micBtn').addEventListener('click', () => listenForAnswer(word, config));
    } else {
        const input = el('answerInput');
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            submitTypedAnswer(word, config);
        });
        el('checkBtn').addEventListener('click', () => submitTypedAnswer(word, config));
    }
}

function submitTypedAnswer(word, config) {
    const input = el('answerInput');
    if (!input || !input.value.trim()) return;
    const value = input.value.trim();
    resolveAnswer(word, config, judgeAnswer(value, word, config.mode), value);
}

function listenForAnswer(word, config) {
    const micBtn = el('micBtn');
    const transcript = el('transcript');
    if (!micBtn || !transcript) return;
    micBtn.classList.add('listening');
    micBtn.textContent = '🎙 聞き取り中…（話し終えると判定します）';
    transcript.textContent = '';
    transcript.classList.remove('error');

    startListening(config.lang, {
        onInterim: (text) => { transcript.textContent = text; },
        onFinal: (alternatives) => {
            // 認識候補のどれかが合っていれば正解にする（聞き間違い対策）。
            const matched = alternatives.find((text) => judgeAnswer(text, word, config.mode));
            resolveAnswer(word, config, !!matched, matched || alternatives[0] || '');
        },
        onError: (code) => {
            micBtn.classList.remove('listening');
            micBtn.textContent = config.micLabel;
            const message = RECOGNITION_ERRORS[code] || '音声を認識できませんでした。もう一度お試しください。';
            if (message) {
                transcript.textContent = message;
                transcript.classList.add('error');
            }
        },
        onEnd: () => {
            if (!el('micBtn')) return;
            micBtn.classList.remove('listening');
            micBtn.textContent = config.micLabel;
        }
    });
}

// 解答を確定して、答えと例文を表示する。
function resolveAnswer(word, config, isCorrect, heard) {
    stopListening();
    const card = el('cardArea').querySelector('.qcard');
    if (!card) return;
    if (config.mode === 'cloze') {
        const blank = card.querySelector('.blank');
        if (blank) blank.textContent = ` ${config.target} `;
    }
    const area = el('answerArea');
    if (area) area.remove();
    showAnswerBlock(word, isCorrect, heard);
}

function showAnswerBlock(word, isCorrect, heard) {
    const card = el('cardArea').querySelector('.qcard');
    const block = document.createElement('div');
    block.className = 'answer-block';
    const yourAnswer = heard
        ? `<div class="your-answer">あなたの答え：${escapeHtml(heard)}</div>`
        : '';
    // 音声の聞き取りや表記ゆれで不正解になることがあるので、自分で正解に
    // 直せるようにしておく。
    const override = !isCorrect
        ? '<button class="mini-btn override" id="overrideBtn">やっぱり正解にする</button>'
        : '';
    block.innerHTML = `
        <div class="verdict ${isCorrect ? 'ok' : 'ng'}">${isCorrect ? '⭕ 正解' : '❌ 不正解'}</div>
        ${yourAnswer}
        <div class="answer-ja">${escapeHtml(word.en)}<span class="answer-sep">／</span>${escapeHtml(word.ja)}</div>
        ${override}
        ${exampleHtml(word)}
        <button class="speak-btn" data-speak="${escapeHtml(word.ex)}">🔊 例文を読む</button>
        <div class="card-actions"><button class="btn btn-primary" id="nextBtn">次へ</button></div>`;
    card.appendChild(block);
    block.querySelector('[data-speak]').addEventListener('click', (e) => speak(e.currentTarget.dataset.speak));
    el('nextBtn').addEventListener('click', () => grade(word, isCorrect));
    el('nextBtn').focus();
    const overrideBtn = el('overrideBtn');
    if (overrideBtn) overrideBtn.addEventListener('click', () => grade(word, true));
    if (state.settings.autoSpeak) speak(word.ex);
}

function grade(word, isCorrect) {
    const today = todayKey();
    const firstTry = !session.graded.has(word.n);

    if (firstTry) {
        session.graded.add(word.n);
        const p = ensureProgress(word.n);
        const day = dayEntry(today);
        if (p.last !== today) day.studied += 1;
        p.seen += 1;
        p.last = today;
        if (isCorrect) {
            p.correct += 1;
            p.box = Math.min(MAX_BOX, p.box + 1);
            day.correct += 1;
            session.correct += 1;
        } else {
            p.wrong += 1;
            p.box = Math.max(0, p.box - 1);
            day.wrong += 1;
            session.wrong += 1;
            session.missed.push(word.n);
        }
        p.due = addDaysKey(today, INTERVALS[p.box]);
        saveState();
    }

    // 間違えた語はセッションの最後にもう一度だけ出す。
    if (!isCorrect && !session.requeued.has(word.n)) {
        session.requeued.add(word.n);
        session.items.push({ num: word.n, mode: session.items[session.index].mode, repeat: true });
    }

    session.index += 1;
    renderCard();
}

function quitSession() {
    stopListening();
    session = null;
    el('studySession').hidden = true;
    el('studyResult').hidden = true;
    el('studySetup').hidden = false;
    renderSetup();
}

function finishSession() {
    const total = session.graded.size;
    const correct = session.correct;
    const rate = total ? Math.round((correct / total) * 100) : 0;
    const missed = Array.from(new Set(session.missed));
    const result = el('studyResult');
    result.innerHTML = `<div class="card result-card">
        <h3>おつかれさまでした</h3>
        <div class="result-score">${rate}<span style="font-size:1.2rem">%</span></div>
        <div class="result-note">${total}語中 ${correct}語 正解／今日の学習 ${state.daily[todayKey()] ? state.daily[todayKey()].studied : 0}語</div>
        ${missed.length ? `<div class="review-list"><h3 style="margin-top:18px">復習したい語</h3>${missed.map((n) => {
            const w = WORDS_BY_NUM.get(n);
            return `<div class="review-item"><b>${escapeHtml(w.en)}</b> — <span>${escapeHtml(w.ja)}</span><br><span>${escapeHtml(w.ex)}</span></div>`;
        }).join('')}</div>` : '<div class="result-note">全問正解です。すばらしい。</div>'}
        <div class="card-actions">
            <button class="btn btn-secondary" id="resultCloseBtn">終了する</button>
            <button class="btn btn-primary" id="resultAgainBtn">続けて学習</button>
        </div>
    </div>`;
    el('studySession').hidden = true;
    result.hidden = false;
    el('resultCloseBtn').addEventListener('click', quitSession);
    el('resultAgainBtn').addEventListener('click', () => {
        const words = buildQueue();
        if (words.length === 0) {
            showToast('この範囲の単語は今日ぶんが終わりました');
            quitSession();
            return;
        }
        startSession();
    });
    session = null;
    renderStats();
}

// ==========================================================================
// 一覧タブ
// ==========================================================================

function filteredWords() {
    const query = normalizeEn(el('searchInput').value);
    const rawQuery = el('searchInput').value.trim();
    const cat = el('listCategory').value;
    const status = el('listStatus').value;
    return WORDS.filter((w) => {
        if (cat !== 'all' && w.cat !== Number(cat)) return false;
        if (status === 'weak' && !isWeak(w.n)) return false;
        else if (status === 'starred' && !isStarred(w.n)) return false;
        else if (['new', 'learning', 'mastered'].includes(status) && statusOf(w.n) !== status) return false;
        if (!rawQuery) return true;
        const haystackEn = normalizeEn(`${w.en} ${w.ex}`);
        if (query && haystackEn.includes(query)) return true;
        return `${w.ja}${w.exJa}`.includes(rawQuery);
    });
}

function renderList() {
    const words = filteredWords();
    const container = el('wordList');
    el('listMeta').textContent = `${words.length}語を表示中（全${WORDS.length}語）`;
    if (words.length === 0) {
        container.innerHTML = '<div class="empty">該当する単語がありません</div>';
        return;
    }
    const shown = words.slice(0, listLimit);
    container.innerHTML = shown.map((w) => wordRowHtml(w)).join('')
        + (words.length > shown.length ? '<button class="btn btn-secondary load-more" id="loadMoreBtn">もっと見る</button>' : '');

    container.querySelectorAll('.word-row-top').forEach((row) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const detail = row.parentElement.querySelector('.word-row-detail');
            detail.hidden = !detail.hidden;
        });
    });
    container.querySelectorAll('[data-speak]').forEach((btn) => {
        btn.addEventListener('click', () => speak(btn.dataset.speak));
    });
    container.querySelectorAll('[data-star]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const num = Number(btn.dataset.star);
            const p = ensureProgress(num);
            p.star = !p.star;
            saveState();
            renderList();
        });
    });
    const more = el('loadMoreBtn');
    if (more) {
        more.addEventListener('click', () => {
            listLimit += LIST_PAGE_SIZE;
            renderList();
        });
    }
}

function wordRowHtml(word) {
    const status = statusOf(word.n);
    const weak = isWeak(word.n);
    const label = { new: '未学習', learning: '学習中', mastered: '習得済み' }[status];
    const p = getProgress(word.n);
    return `<div class="word-row">
        <div class="word-row-top">
            <span class="word-num">${word.n}</span>
            <div class="word-row-main">
                <div class="word-row-en">${escapeHtml(word.en)}</div>
                <div class="word-row-ja">${escapeHtml(word.ja)}</div>
            </div>
            <span class="badge ${weak ? 'weak' : status}">${weak ? '苦手' : label}</span>
        </div>
        <div class="word-row-detail" hidden>
            ${exampleHtml(word)}
            <div class="word-row-actions">
                <button class="mini-btn" data-speak="${escapeHtml(word.ex)}">🔊 例文</button>
                <button class="mini-btn ${isStarred(word.n) ? 'on' : ''}" data-star="${word.n}">${isStarred(word.n) ? '★ マーク中' : '☆ マーク'}</button>
                <span class="mini-btn" style="cursor:default">${p ? `${p.correct}⭕ / ${p.wrong}❌` : '未挑戦'}</span>
            </div>
        </div>
    </div>`;
}

// ==========================================================================
// 統計タブ
// ==========================================================================

function renderStats() {
    const mastered = WORDS.filter((w) => statusOf(w.n) === 'mastered').length;
    const learning = WORDS.filter((w) => statusOf(w.n) === 'learning').length;
    const fresh = WORDS.length - mastered - learning;
    let correct = 0;
    let wrong = 0;
    Object.values(state.words).forEach((p) => { correct += p.correct; wrong += p.wrong; });
    const accuracy = correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
    const today = todayKey();
    const todayCount = state.daily[today] ? state.daily[today].studied : 0;

    el('statsGrid').innerHTML = [
        { value: `${mastered}`, label: `習得済み（全${WORDS.length}語中）` },
        { value: pctLabel(mastered, WORDS.length), label: '習得率' },
        { value: `${learning}`, label: '学習中' },
        { value: `${fresh}`, label: '未学習' },
        { value: `${accuracy}%`, label: '累計の正答率' },
        { value: `${currentStreak()}`, label: '連続学習日数' },
        { value: `${todayCount}`, label: '今日の学習語数' },
        { value: `${correct + wrong}`, label: '累計の解答数' }
    ].map((s) => `<div class="stat-card"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');

    // 直近14日
    const days = [];
    for (let i = 13; i >= 0; i -= 1) days.push(addDaysKey(today, -i));
    const max = Math.max(state.settings.goal, ...days.map((d) => (state.daily[d] ? state.daily[d].studied : 0)));
    el('dailyChart').innerHTML = days.map((d) => {
        const count = state.daily[d] ? state.daily[d].studied : 0;
        const height = max ? Math.round((count / max) * 100) : 0;
        return `<div class="bar-col">
            <div class="bar-value">${count || ''}</div>
            <div class="bar ${count ? '' : 'empty-bar'}" style="height:${count ? Math.max(height, 4) : 2}%"></div>
            <div class="bar-label">${d.slice(8)}</div>
        </div>`;
    }).join('');

    el('categoryProgress').innerHTML = CATEGORIES.map((cat) => {
        const words = WORDS.filter((w) => w.cat === cat.id);
        const done = words.filter((w) => statusOf(w.n) === 'mastered').length;
        const pct = Math.round((done / words.length) * 100);
        return `<div class="cat-row">
            <div class="cat-row-top"><span>${escapeHtml(cat.title)}</span><span>${done} / ${words.length}</span></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');

    const weak = Object.keys(state.words)
        .map(Number)
        .filter((n) => state.words[n].wrong > 0)
        .sort((a, b) => state.words[b].wrong - state.words[a].wrong || a - b)
        .slice(0, 10);
    el('weakList').innerHTML = weak.length
        ? weak.map((n) => {
            const w = WORDS_BY_NUM.get(n);
            const p = state.words[n];
            return `<div class="review-item"><b>${escapeHtml(w.en)}</b> — <span>${escapeHtml(w.ja)}</span><br><span>${p.wrong}回まちがえ／${p.correct}回正解</span></div>`;
        }).join('')
        : '<div class="empty">まだ記録がありません</div>';
}

// ==========================================================================
// 設定タブ
// ==========================================================================

function renderSettings() {
    el('goalInput').value = state.settings.goal;
    el('rateInput').value = state.settings.rate;
    el('rateValue').textContent = `×${state.settings.rate.toFixed(2)}`;
    el('autoSpeak').checked = state.settings.autoSpeak;
    renderInputChips();
    el('voiceHint').textContent = recognitionSupported
        ? '音声で答えるときは、ブラウザからマイクの使用を許可してください。うまく聞き取れないときは、答え合わせのあとに「やっぱり正解にする」で直せます。'
        : 'この端末のブラウザは音声入力に対応していません。文字入力で学習してください。';
    el('speechHint').textContent = speechSupported
        ? '端末の音声合成で英語を読み上げます。音量を確認してください。'
        : 'この端末のブラウザは音声読み上げに対応していません。';
}

function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-english-500-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('書き出しました');
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            if (!parsed || typeof parsed !== 'object') throw new Error('bad file');
            state = normalizeState(parsed, defaultState());
            saveState();
            renderAll();
            showToast('読み込みました');
        } catch (err) {
            showToast('ファイルを読み込めませんでした');
        }
    };
    reader.onerror = () => showToast('ファイルを読み込めませんでした');
    reader.readAsText(file);
}

// ==========================================================================
// Wiring
// ==========================================================================

function fillCategorySelect(select, includeAll) {
    select.innerHTML = `<option value="all">${includeAll}</option>`
        + CATEGORIES.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}（${c.count}語）</option>`).join('');
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    el(`${tab}View`).classList.add('active');
    if (tab === 'study' && !session) renderSetup();
    if (tab === 'list') renderList();
    if (tab === 'stats') renderStats();
    if (tab === 'settings') renderSettings();
    window.scrollTo({ top: 0 });
}

function renderAll() {
    renderSetup();
    renderList();
    renderStats();
    renderSettings();
}

function bindChipRow(id, key, cast) {
    el(id).addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        setup[key] = cast(chip.dataset[key]);
        el(id).querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderSetup();
    });
}

function init() {
    fillCategorySelect(el('categorySelect'), 'すべてのカテゴリ');
    fillCategorySelect(el('listCategory'), 'すべてのカテゴリ');

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    bindChipRow('scopeChips', 'scope', String);
    bindChipRow('modeChips', 'mode', String);
    bindChipRow('sizeChips', 'size', Number);
    el('categorySelect').addEventListener('change', (e) => {
        setup.category = e.target.value;
        renderSetup();
    });

    document.querySelectorAll('#inputChips, #settingsInputChips').forEach((row) => {
        row.addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (!chip || chip.disabled) return;
            setInputMode(chip.dataset.input);
        });
    });

    el('startBtn').addEventListener('click', startSession);
    el('quitBtn').addEventListener('click', () => {
        if (session && session.graded.size > 0 && !confirm('学習をやめますか？ ここまでの記録は保存されます。')) return;
        quitSession();
    });

    el('searchInput').addEventListener('input', () => { listLimit = LIST_PAGE_SIZE; renderList(); });
    el('listCategory').addEventListener('change', () => { listLimit = LIST_PAGE_SIZE; renderList(); });
    el('listStatus').addEventListener('change', () => { listLimit = LIST_PAGE_SIZE; renderList(); });

    el('goalInput').addEventListener('change', (e) => {
        const value = clampInt(e.target.value, 5, 200, state.settings.goal);
        state.settings.goal = value;
        e.target.value = value;
        saveState();
        renderSetup();
    });
    el('rateInput').addEventListener('input', (e) => {
        state.settings.rate = Number(e.target.value);
        el('rateValue').textContent = `×${state.settings.rate.toFixed(2)}`;
        saveState();
    });
    el('autoSpeak').addEventListener('change', (e) => {
        state.settings.autoSpeak = e.target.checked;
        saveState();
    });
    el('speakTestBtn').addEventListener('click', () => speak('Please send me the agenda.'));

    el('exportBtn').addEventListener('click', exportData);
    el('importBtn').addEventListener('click', () => el('importFile').click());
    el('importFile').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importData(file);
        e.target.value = '';
    });
    el('resetBtn').addEventListener('click', () => {
        if (!confirm('本当にすべての学習記録を消しますか？ 元に戻せません。')) return;
        state = defaultState();
        saveState();
        renderAll();
        showToast('学習記録を消しました');
    });

    // キーボード操作（PCでの学習用）
    document.addEventListener('keydown', (e) => {
        if (currentTab !== 'study' || !session) return;
        // 入力欄で押されたキーはカード側で処理済みなので、ここでは拾わない
        // （解答直後は入力欄が消えて activeElement が body に戻るため、
        // イベントの発生元で判定する）。
        const tag = e.target && e.target.tagName ? e.target.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === 'Enter' || e.key === ' ') {
            const btn = el('nextBtn') || el('flipBtn');
            if (btn) { e.preventDefault(); btn.click(); }
        }
    });

    renderAll();
    switchTab('study');

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応は任意 */ });
    }
}

init();
