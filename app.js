// Timer State
let timerMinutes = 25;
let timerSeconds = 0;
let totalSeconds = 25 * 60;
let remainingSeconds = totalSeconds;
let timerInterval = null;
let isRunning = false;

// Task State
let tasks = JSON.parse(localStorage.getItem('pomodoroTasks')) || [];
let selectedTaskId = null;

// DOM Elements
const timerProgress = document.getElementById('timerProgress');
const timerMinutesDisplay = document.getElementById('timerMinutes');
const timerSecondsDisplay = document.getElementById('timerSeconds');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const modeBtns = document.querySelectorAll('.mode-btn');
const taskInput = document.getElementById('taskInput');
const addTaskBtn = document.getElementById('addTaskBtn');
const taskList = document.getElementById('taskList');
const currentTaskDisplay = document.getElementById('currentTask');
const customMinutesInput = document.getElementById('customMinutes');
const setCustomTimeBtn = document.getElementById('setCustomTimeBtn');

// Circle circumference (2 * PI * radius)
const circumference = 2 * Math.PI * 90;

// Initialize
function init() {
    timerProgress.style.strokeDasharray = circumference;
    timerProgress.style.strokeDashoffset = 0;
    updateTimerDisplay();
    updateProgress();
    renderTasks();
    setupEventListeners();
}

// Event Listeners
function setupEventListeners() {
    startBtn.addEventListener('click', startTimer);
    pauseBtn.addEventListener('click', pauseTimer);
    resetBtn.addEventListener('click', resetTimer);

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isRunning) return;
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTimerDuration(parseInt(btn.dataset.minutes));
        });
    });

    addTaskBtn.addEventListener('click', addTask);
    taskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTask();
    });

    setCustomTimeBtn.addEventListener('click', setCustomTime);
    customMinutesInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setCustomTime();
    });
}

function setCustomTime() {
    if (isRunning) return;

    let minutes = parseInt(customMinutesInput.value);
    if (isNaN(minutes) || minutes < 1) minutes = 1;
    if (minutes > 120) minutes = 120;

    customMinutesInput.value = minutes;

    // Deselect all mode buttons
    modeBtns.forEach(b => b.classList.remove('active'));

    setTimerDuration(minutes);
    timerProgress.style.stroke = '#9b59b6'; // Purple for custom time
}

// Timer Functions
function startTimer() {
    if (isRunning) return;

    isRunning = true;
    startBtn.disabled = true;
    pauseBtn.disabled = false;

    timerInterval = setInterval(() => {
        if (remainingSeconds > 0) {
            remainingSeconds--;
            updateTimerDisplay();
            updateProgress();
        } else {
            completeTimer();
        }
    }, 1000);
}

function pauseTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    startBtn.textContent = '再開';
}

function resetTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    remainingSeconds = totalSeconds;
    updateTimerDisplay();
    updateProgress();
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    startBtn.textContent = '開始';
}

function setTimerDuration(minutes) {
    totalSeconds = minutes * 60;
    remainingSeconds = totalSeconds;
    updateTimerDisplay();
    updateProgress();

    // Update progress color based on mode
    if (minutes === 25) {
        timerProgress.style.stroke = '#e74c3c';
    } else if (minutes === 5) {
        timerProgress.style.stroke = '#27ae60';
    } else {
        timerProgress.style.stroke = '#3498db';
    }
}

function updateTimerDisplay() {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    timerMinutesDisplay.textContent = minutes.toString().padStart(2, '0');
    timerSecondsDisplay.textContent = seconds.toString().padStart(2, '0');
}

function updateProgress() {
    const progress = remainingSeconds / totalSeconds;
    const offset = circumference * (1 - progress);
    timerProgress.style.strokeDashoffset = offset;
}

function completeTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    startBtn.textContent = '開始';

    // Play notification sound (if available)
    playNotificationSound();

    // Add pomodoro to selected task
    if (selectedTaskId) {
        const activeMode = document.querySelector('.mode-btn.active');
        if (activeMode && activeMode.dataset.minutes === '25') {
            incrementTaskPomodoro(selectedTaskId);
        }
    }

    // Show notification
    if (Notification.permission === 'granted') {
        new Notification('ポモドーロ完了!', {
            body: '休憩を取りましょう',
            icon: '🍅'
        });
    }

    // Reset for next round
    remainingSeconds = totalSeconds;
    updateTimerDisplay();
    updateProgress();
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

    setTimeout(() => {
        oscillator.stop();
    }, 200);
}

// Task Functions
function addTask() {
    const text = taskInput.value.trim();
    if (!text) return;

    const task = {
        id: Date.now(),
        text: text,
        completed: false,
        pomodoros: 0
    };

    tasks.push(task);
    saveTasks();
    renderTasks();
    taskInput.value = '';
}

function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        saveTasks();
        renderTasks();
    }
}

function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    if (selectedTaskId === id) {
        selectedTaskId = null;
        updateCurrentTaskDisplay();
    }
    saveTasks();
    renderTasks();
}

function selectTask(id) {
    selectedTaskId = selectedTaskId === id ? null : id;
    renderTasks();
    updateCurrentTaskDisplay();
}

function incrementTaskPomodoro(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.pomodoros++;
        saveTasks();
        renderTasks();
    }
}

function updateCurrentTaskDisplay() {
    if (selectedTaskId) {
        const task = tasks.find(t => t.id === selectedTaskId);
        if (task) {
            currentTaskDisplay.innerHTML = `<p class="active-task">🎯 ${task.text}</p>`;
            return;
        }
    }
    currentTaskDisplay.innerHTML = '<p>タスクを選択してください</p>';
}

function saveTasks() {
    localStorage.setItem('pomodoroTasks', JSON.stringify(tasks));
}

function renderTasks() {
    if (tasks.length === 0) {
        taskList.innerHTML = '<div class="empty-state"><p>タスクがありません</p></div>';
        return;
    }

    taskList.innerHTML = tasks.map(task => `
        <li class="task-item ${task.completed ? 'completed' : ''} ${selectedTaskId === task.id ? 'selected' : ''}" data-id="${task.id}">
            <div class="task-checkbox ${task.completed ? 'checked' : ''}" onclick="toggleTask(${task.id})"></div>
            <span class="task-text" onclick="selectTask(${task.id})">${escapeHtml(task.text)}</span>
            <div class="pomodoro-count">
                ${renderPomodoroDots(task.pomodoros)}
            </div>
            <button class="task-delete" onclick="deleteTask(${task.id})">×</button>
        </li>
    `).join('');
}

function renderPomodoroDots(count) {
    const maxDots = 4;
    let dots = '';
    for (let i = 0; i < maxDots; i++) {
        dots += `<span class="pomodoro-dot ${i < count ? 'filled' : ''}"></span>`;
    }
    if (count > maxDots) {
        dots += `<span style="font-size: 0.8rem; color: var(--text-muted);">+${count - maxDots}</span>`;
    }
    return dots;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// Initialize app
init();
