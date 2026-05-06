const defaultMeds = [
    { id: 1, name: 'Lisinopril', dosage: '10mg • 1 Tablet', time: '08:00', instructions: 'With water', taken: true, takenTime: '08:15 AM', snoozedTo: null, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], image: null, alerted: true, lastTakenDate: new Date().toISOString().split('T')[0], missLogged: false },
    { id: 2, name: 'Metformin', dosage: '500mg • After breakfast', time: '09:30', instructions: 'After meal', taken: false, snoozedTo: null, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], image: null, alerted: false, lastTakenDate: null, missLogged: false },
    { id: 3, name: 'Amlodipine', dosage: '5mg • 1 Capsule', time: '14:00', instructions: 'With food', taken: false, snoozedTo: null, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], image: null, alerted: false, lastTakenDate: null, missLogged: false },
    { id: 4, name: 'Atorvastatin', dosage: '20mg • Before bed', time: '20:00', instructions: 'Empty stomach', taken: false, snoozedTo: null, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], image: null, alerted: false, lastTakenDate: null, missLogged: false }
];

const app = {
    currentScreen: 'welcome',
    userData: {},
    medications: [],
    userHistory: [],
    users: [],
    currentUser: null,
    activeMedId: null,
    alarmSound: null,
    alarmContext: null,
    alarmPulseTimers: [],
    alarmInterval: null,

    dayMap: { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' },

    init() {
        const storedUsers = localStorage.getItem('users');
        this.users = storedUsers ? JSON.parse(storedUsers) : [
            { name: "Eleanor Rigby", phone: "9876543210", password: "password123", email: "eleanor@example.com", soundEnabled: true }
        ];

        const storedData = localStorage.getItem('userData');
        if (storedData) {
            this.userData = JSON.parse(storedData);
        } else {
            // Migrate old separated formats if present
            const legacyMeds = localStorage.getItem('allMedications');
            const legacyHist = localStorage.getItem('allHistory');

            if (legacyMeds || legacyHist) {
                const medsObj = legacyMeds ? JSON.parse(legacyMeds) : {};
                const histObj = legacyHist ? JSON.parse(legacyHist) : {};

                Object.keys(medsObj).forEach(email => {
                    if (!this.userData[email]) this.userData[email] = { medicines: [], history: [] };
                    this.userData[email].medicines = medsObj[email];
                });
                Object.keys(histObj).forEach(email => {
                    if (!this.userData[email]) this.userData[email] = { medicines: [], history: [] };
                    this.userData[email].history = histObj[email];
                });
            } else {
                this.userData = {
                    "9876543210": {
                        medicines: JSON.parse(JSON.stringify(defaultMeds)),
                        history: []
                    }
                };
            }
            if (Object.keys(this.userData).length > 0) {
                localStorage.setItem('userData', JSON.stringify(this.userData));
            }
        }

        this.initAudio();
        document.addEventListener('pointerdown', () => this.unlockAlarmAudio(), { once: true });

        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            this.currentUser = JSON.parse(storedUser);
            const fullUser = this.users.find(u => this.getUserKey(u) === this.getUserKey(this.currentUser));
            if (fullUser && fullUser.soundEnabled !== undefined) {
                this.currentUser.soundEnabled = fullUser.soundEnabled;
            } else {
                this.currentUser.soundEnabled = true;
            }

            this.loadUserMeds();
            this.resetDailyMeds();
            this.updateUserDataUI();
            this.renderMedications();
            this.updateStats();
            this.navigateTo('dashboard');
        } else {
            console.warn("No user found in storage");
            this.navigateTo('welcome');
        }

        this.updateTime();
        if (this.currentUser) {
            this.checkMedicationAlarms();
        }

        setInterval(() => {
            this.updateTime();
            if (this.currentUser) {
                this.checkMedicationAlarms();
                this.resetDailyMeds();
                this.renderMedications();
                this.updateStats();
                if (this.currentScreen === 'schedule') {
                    this.renderSchedule();
                }
            }
        }, 30000);

        this.alarmInterval = setInterval(() => {
            if (this.currentUser) this.checkMedicationAlarms();
        }, 15000);
    },

    initAudio() {
        this.alarmSound = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3');
        this.alarmSound.volume = 1.0;
        this.alarmSound.loop = false;
    },

    unlockAlarmAudio() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx && !this.alarmContext) this.alarmContext = new AudioCtx();
            if (this.alarmContext && this.alarmContext.state === 'suspended') {
                this.alarmContext.resume();
            }
            if (this.alarmSound) {
                this.alarmSound.play()
                    .then(() => {
                        this.alarmSound.pause();
                        this.alarmSound.currentTime = 0;
                    })
                    .catch(() => { });
            }
        } catch (e) { }
    },

    toggleSoundSetting(isChecked) {
        if (!this.currentUser) return;
        this.currentUser.soundEnabled = isChecked;
        const userIndex = this.users.findIndex(u => this.getUserKey(u) === this.getUserKey(this.currentUser));
        if (userIndex >= 0) {
            this.users[userIndex].soundEnabled = isChecked;
            this.saveUsers();
        }
        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
    },

    getUserKey(user) {
        return user?.phone || user?.email || 'guest';
    },

    normalizePhone(value) {
        return (value || '').replace(/\D/g, '');
    },

    isValidPhone(phone) {
        return phone.length >= 10 && phone.length <= 15;
    },

    getUserByPhone(phone) {
        return this.users.find(u => this.normalizePhone(u.phone || '') === phone);
    },

    playAlarm(repeats = 1, med = null, stageText = '') {
        if (!this.currentUser || !this.currentUser.soundEnabled) return;
        this.stopAlarmSound();
        const playPulse = () => {
            this.playAlarmTone();
            if (med) this.speakAlarm(med, stageText);
            if ("vibrate" in navigator) navigator.vibrate([350, 100, 350, 100, 350]);
        };

        try {
            playPulse();
            for (let i = 1; i < repeats; i++) {
                this.alarmPulseTimers.push(setTimeout(playPulse, i * 3000));
            }
            this.alarmPulseTimers.push(setTimeout(() => this.stopAlarmSound(), repeats * 3000 + 1200));
        } catch (e) { }
    },

    speakAlarm(med, stageText = '') {
        if (!('speechSynthesis' in window)) return;

        const timeText = this.formatTimeDisplay(med.snoozedTo || med.time);
        const message = `Medicine reminder ${stageText}. It is time for ${med.name} at ${timeText}. Take ${med.dosage}.`;
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.92;
        utterance.pitch = 1;
        utterance.volume = 1;

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    },

    playAlarmTone() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!this.alarmContext) this.alarmContext = new AudioCtx();
            if (this.alarmContext.state === 'suspended') this.alarmContext.resume();

            const frequencies = [880, 1175, 1568];
            frequencies.forEach((frequency, index) => {
                const oscillator = this.alarmContext.createOscillator();
                const gain = this.alarmContext.createGain();
                oscillator.type = index === 0 ? 'square' : 'triangle';
                oscillator.frequency.setValueAtTime(frequency, this.alarmContext.currentTime);
                gain.gain.setValueAtTime(0.001, this.alarmContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.32, this.alarmContext.currentTime + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.001, this.alarmContext.currentTime + 1.05);
                oscillator.connect(gain);
                gain.connect(this.alarmContext.destination);
                oscillator.start();
                oscillator.stop(this.alarmContext.currentTime + 1.1);
            });
        } catch (e) { }
    },

    stopAlarmSound() {
        this.alarmPulseTimers.forEach(timer => clearTimeout(timer));
        this.alarmPulseTimers = [];
        if (this.alarmSound && !this.alarmSound.paused) {
            this.alarmSound.pause();
            this.alarmSound.currentTime = 0;
        }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },

    acknowledgeAlarm(medId) {
        const med = this.medications.find(m => m.id === medId);
        if (!med) return;
        med.alarmAcknowledgedDate = this.getCurrentDateStr();
        this.stopAlarmSound();
        this.saveAllMeds();
    },

    checkMedicationAlarms() {
        const today = this.getCurrentDay();
        this.medications.forEach(med => {
            const days = (med.days && med.days.length > 0) ? med.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            if (!days.includes(today) || med.taken) return;
            if (med.alarmAcknowledgedDate === this.getCurrentDateStr()) return;
            if (this.activeMedId === med.id && ['alert', 'success'].includes(this.currentScreen)) return;
            this.getMedStatus(med);
        });
    },

    showAlarmCard(med, stageText) {
        let overlay = document.getElementById('alarm-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'alarm-overlay';
            overlay.style.cssText = 'position:absolute; inset:0; z-index:5000; background:rgba(44,62,80,0.35); display:flex; align-items:flex-end; padding:24px; pointer-events:auto;';
            document.getElementById('app').appendChild(overlay);
        }

        overlay.innerHTML = `
            <div style="width:100%; background:white; border-radius:24px; padding:22px; box-shadow:0 20px 45px rgba(0,0,0,0.18);">
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
                    <div style="width:48px; height:48px; border-radius:50%; background:var(--warning-light); color:var(--warning); display:flex; align-items:center; justify-content:center; font-size:24px;">
                        <i class="ph-fill ph-bell-ringing"></i>
                    </div>
                    <div>
                        <div style="font-size:12px; font-weight:700; color:var(--warning); text-transform:uppercase;">Medicine Alarm ${stageText}</div>
                        <h2 style="margin-top:2px;">${med.name}</h2>
                    </div>
                </div>
                <p style="margin-bottom:18px;">${med.dosage} • ${this.formatTimeDisplay(med.snoozedTo || med.time)}</p>
                <div style="display:flex; gap:10px;">
                    <button class="btn primary" style="flex:1;" onclick="app.takeNowFromAlarm(${med.id});">
                        Take Now
                    </button>
                    <button class="btn outline secondary" style="flex:1; border:1px solid var(--border-color);" onclick="app.handleSnoozeFromAlarm(${med.id});">
                        Snooze
                    </button>
                </div>
            </div>
        `;
    },

    triggerDoseAlarm(med, stageText) {
        this.activeMedId = med.id;
        this.showAlarmCard(med, stageText);
        this.playAlarm(1, med, stageText);
        this.showToast(`${med.name} reminder ${stageText}`);
    },

    getCurrentDay() {
        return this.dayMap[new Date().getDay()];
    },

    getCurrentDateStr() {
        return new Date().toISOString().split('T')[0];
    },

    getHHMM() {
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        return `${hh}:${mm}`;
    },

    addMinutesToTime(time, minutesToAdd) {
        const [hours, minutes] = time.split(':').map(Number);
        const total = (hours * 60 + minutes + minutesToAdd) % (24 * 60);
        const nextHours = Math.floor(total / 60).toString().padStart(2, '0');
        const nextMinutes = (total % 60).toString().padStart(2, '0');
        return `${nextHours}:${nextMinutes}`;
    },

    getStreak() {
        if (!this.currentUser) return 0;
        let streak = 0;
        let d = new Date();
        let checkedToday = false;

        while (streak < 365) {
            const offset = d.getTimezoneOffset();
            const dateStr = new Date(d.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0];
            const logsForDay = this.userHistory.filter(h => h.date === dateStr);
            const hasMissed = logsForDay.some(h => h.status === 'Missed');
            const hasTaken = logsForDay.some(h => h.status === 'Taken');

            if (hasMissed) break;

            if (logsForDay.length === 0) {
                if (checkedToday) break;
            } else if (hasTaken && !hasMissed) {
                streak++;
            }

            checkedToday = true;
            d.setDate(d.getDate() - 1);
        }
        return streak;
    },

    getNextDoseMed() {
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();

        const currentDayStr = this.getCurrentDay();
        const todayMeds = [...this.medications]
            .filter(m => {
                const days = (m.days && m.days.length > 0) ? m.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                if (!days.includes(currentDayStr) || m.taken) return false;
                const [h, min] = (m.snoozedTo || m.time).split(':').map(Number);
                return (h * 60 + min > currentMins); // Must be in the future
            })
            .sort((a, b) => (a.snoozedTo || a.time).localeCompare(b.snoozedTo || b.time));

        if (todayMeds.length > 0) {
            let [h, min] = (todayMeds[0].snoozedTo || todayMeds[0].time).split(':').map(Number);
            return { ...todayMeds[0], isTomorrow: false, inMins: (h * 60 + min) - currentMins };
        }

        let tmrw = new Date(now);
        tmrw.setDate(tmrw.getDate() + 1);
        const tmrwDayStr = this.dayMap[tmrw.getDay()];

        const tmrwMeds = [...this.medications]
            .filter(m => {
                const days = (m.days && m.days.length > 0) ? m.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                return days.includes(tmrwDayStr);
            })
            .sort((a, b) => (a.snoozedTo || a.time).localeCompare(b.snoozedTo || b.time));

        if (tmrwMeds.length > 0) {
            let [h, min] = (tmrwMeds[0].snoozedTo || tmrwMeds[0].time).split(':').map(Number);
            return { ...tmrwMeds[0], isTomorrow: true, inMins: ((24 * 60) - currentMins) + (h * 60 + min) };
        }

        return null;
    },

    updateSuccessScreen() {
        const streakEl = document.getElementById('success-streak');
        if (streakEl) streakEl.textContent = `${this.getStreak()}-day streak`;

        const nextDoseEl = document.getElementById('success-next-dose');
        if (!nextDoseEl) return;

        const nextMed = this.getNextDoseMed();
        if (nextMed) {
            const timeDisplay = this.formatTimeDisplay(nextMed.time);
            let timeStr = '';
            if (nextMed.isTomorrow) {
                timeStr = `Tomorrow at <strong>${timeDisplay}</strong>`;
            } else {
                const hours = Math.floor(nextMed.inMins / 60);
                const mins = nextMed.inMins % 60;
                timeStr = hours > 0 ? `In approximately <strong>${hours}h ${mins}m</strong>` : `In approximately <strong>${mins}m</strong>`;
            }

            const [h, m] = nextMed.time.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const fH = h % 12 || 12;

            nextDoseEl.innerHTML = `
                <div class="card-header">
                    <span class="label">NEXT DOSE</span>
                    <span class="status scheduled"><i class="ph-fill ph-circle"></i> Scheduled</span>
                </div>
                <div class="next-med-info">
                    <div class="icon-bg" style="overflow:hidden; display:flex; justify-content:center; align-items:center;">
                        ${nextMed.image ? `<img src="${nextMed.image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : '<i class="ph-fill ph-pill"></i>'}
                    </div>
                    <div class="med-details">
                        <div class="name" style="font-weight:700;">${nextMed.name}</div>
                        <div class="dosage" style="opacity:0.8; font-size:14px;">${nextMed.dosage}</div>
                    </div>
                    <div class="time-block">
                        <div class="time" style="font-weight:700;">${fH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}</div>
                        <div class="ampm" style="font-weight:700;">${ampm}</div>
                    </div>
                </div>
                <div class="countdown" style="margin-top:12px; background:rgba(0,0,0,0.04); padding:10px; border-radius:8px;">
                    <i class="ph ph-clock"></i> ${timeStr}
                </div>
            `;
            nextDoseEl.style.display = 'block';
        } else {
            nextDoseEl.innerHTML = `
                <div style="text-align:center; padding: 20px;">
                    <h4>No more doses today</h4>
                    <p style="color: var(--text-secondary); font-size: 13px; margin-top: 4px;">You have no upcoming medicines scheduled.</p>
                </div>
            `;
            nextDoseEl.style.display = 'block';
        }
    },

    resetDailyMeds() {
        let changed = false;
        const todayStr = this.getCurrentDateStr();

        this.medications.forEach(med => {
            if (med.lastResetDate !== todayStr) {
                med.taken = false;
                med.takenTime = null;
                med.alerted = false;
                med.alerted1 = false;
                med.alerted2 = false;
                med.alerted3 = false;
                med.snoozedTo = null;
                med.missLogged = false;
                med.alarmAcknowledgedDate = null;
                med.lastResetDate = todayStr;
                changed = true;
            }
        });

        if (changed) {
            this.saveAllMeds();
        }
    },

    loadUserMeds() {
        if (!this.currentUser) return;

        const userKey = this.getUserKey(this.currentUser);
        if (!this.userData[userKey]) {
            this.userData[userKey] = {
                medicines: JSON.parse(JSON.stringify(defaultMeds)),
                history: []
            };
            this.saveUserData();
        }

        this.medications = this.userData[userKey].medicines;
        this.userHistory = this.userData[userKey].history;
    },

    saveUserData() {
        if (!this.currentUser) return;
        const userKey = this.getUserKey(this.currentUser);
        if (!this.userData[userKey]) {
            this.userData[userKey] = { medicines: [], history: [] };
        }
        this.userData[userKey].medicines = this.medications;
        this.userData[userKey].history = this.userHistory;
        localStorage.setItem('userData', JSON.stringify(this.userData));
    },

    saveAllMeds() {
        this.saveUserData();
    },

    saveHistory() {
        this.saveUserData();
    },

    saveUsers() {
        localStorage.setItem('users', JSON.stringify(this.users));
    },

    logHistory(med, status) {
        if (!this.currentUser) return;
        const today = this.getCurrentDateStr();
        const existing = this.userHistory.find(h => h.medId === med.id && h.date === today && h.status === status);
        if (!existing) {
            this.userHistory.push({
                medId: med.id,
                name: med.name,
                dosage: med.dosage,
                time: med.time,
                status: status,
                date: today,
                image: med.image || null,
                timestamp: med.takenTime || this.formatTimeDisplay(this.getHHMM())
            });
            this.saveHistory();
            if (this.currentScreen === 'history') this.renderHistory();
        }
    },

    updateUserDataUI() {
        if (!this.currentUser) return;

        const firstName = this.currentUser.name.split(' ')[0] || '';

        const dashName = document.getElementById('dashboard-name');
        if (dashName) dashName.innerHTML = `${firstName} <span class="emoji">☀️</span>`;

        const profName = document.getElementById('profile-name');
        if (profName) profName.textContent = this.currentUser.name;

        const profEmail = document.getElementById('profile-email');
        if (profEmail) profEmail.textContent = this.currentUser.phone ? `+${this.currentUser.phone}` : this.currentUser.email;

        const histSubtitle = document.getElementById('history-subtitle');
        if (histSubtitle) histSubtitle.textContent = `${firstName}'s medication log`;

        const soundToggle = document.getElementById('setting-sound');
        if (soundToggle) soundToggle.checked = this.currentUser.soundEnabled !== false;
    },

    formatTimeDisplay(timeStr) {
        let [hours, mins] = timeStr.split(':').map(Number);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${ampm}`;
    },

    formatDatePretty() {
        const now = new Date();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const numToSuffix = (num) => {
            const j = num % 10, k = num % 100;
            if (j == 1 && k != 11) return num + "st";
            if (j == 2 && k != 12) return num + "nd";
            if (j == 3 && k != 13) return num + "rd";
            return num + "th";
        }
        return `${monthNames[now.getMonth()]} ${numToSuffix(now.getDate())}`;
    },

    getMedStatus(med) {
        if (med.taken) return 'TAKEN';

        const now = new Date();
        const currentTotalMins = now.getHours() * 60 + now.getMinutes();

        const checkTime = med.snoozedTo || med.time;
        let [medH, medM] = checkTime.split(':').map(Number);
        const medTotalMins = medH * 60 + medM;
        const diff = currentTotalMins - medTotalMins;

        let status = 'UPCOMING';
        if (diff > 5) status = 'MISSED'; // Strict 5 minute window
        else if (diff >= -5 && diff <= 5) status = 'DUE_NOW';

        const todayStr = this.getCurrentDateStr();
        if (status === 'DUE_NOW' && med.lastTakenDate !== todayStr) {
            if (med.alerted1 === undefined) med.alerted1 = false;
            if (med.alerted2 === undefined) med.alerted2 = false;
            if (med.alerted3 === undefined) med.alerted3 = false;

            let alarmStage = '';

            // Alarm 1: -5 minutes
            if (diff === -5 && !med.alerted1) { med.alerted1 = true; alarmStage = '1 of 3'; }
            // Alarm 2: 0 minutes
            else if (diff === 0 && !med.alerted2) { med.alerted2 = true; alarmStage = '2 of 3'; }
            // Alarm 3: +5 minutes
            else if (diff === 5 && !med.alerted3) { med.alerted3 = true; alarmStage = '3 of 3'; }

            if (alarmStage) {
                this.triggerDoseAlarm(med, alarmStage);
                setTimeout(() => this.saveAllMeds(), 0);
            }
        }

        if (status === 'MISSED' && med.lastTakenDate !== todayStr && !med.missLogged) {
            med.missLogged = true;
            this.logHistory(med, 'Missed');
            setTimeout(() => this.saveAllMeds(), 0);
        }

        return status;
    },

    renderHistory() {
        if (this.currentScreen !== 'history' || !this.currentUser) return;

        const historyList = document.querySelector('.history-list');
        if (!historyList) return;

        historyList.innerHTML = '';
        const today = this.getCurrentDateStr();

        const todaysLogs = this.userHistory.filter(h => h.date === today).sort((a, b) => a.time.localeCompare(b.time));

        const takenCount = todaysLogs.filter(h => h.status === 'Taken').length;
        const missedCount = todaysLogs.filter(h => h.status === 'Missed').length;

        const tStat = document.getElementById('hist-stat-taken');
        const mStat = document.getElementById('hist-stat-missed');
        if (tStat) tStat.textContent = takenCount;
        if (mStat) mStat.textContent = missedCount;

        if (todaysLogs.length === 0) {
            historyList.innerHTML = `
                <div style="text-align:center; padding: 40px; color: var(--text-secondary); margin-top: 24px;">
                    <div style="font-size: 40px; margin-bottom: 12px; opacity: 0.7;">📭</div>
                    <h3 style="color: var(--text-color);">No activity today</h3>
                    <p style="font-size: 14px; margin-top: 8px;">Medicines you take or miss will appear here automatically.</p>
                </div>
            `;
            return;
        }

        let html = `
            <div class="day-group" style="margin-top: 16px;">
                <div class="day-header" style="padding-bottom: 12px; border-bottom: 1px solid var(--border-color); margin-bottom: 16px; display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin: 0; display:flex; align-items:center; gap:8px;"><i class="ph ph-calendar-blank" style="color:var(--primary);"></i> Today — ${this.formatDatePretty()}</h3>
                    <span class="badge gray">${todaysLogs.length} doses</span>
                </div>
        `;

        todaysLogs.forEach(log => {
            const isTaken = log.status === 'Taken';
            const iconClass = isTaken ? 'status-taken' : 'status-missed';
            const iconPh = isTaken ? 'ph-check' : 'ph-x';
            const statusColor = isTaken ? 'text-green' : 'text-orange';

            const imageHtml = log.image ? `<img src="${log.image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; opacity: ${isTaken ? '1' : '0.6'};">` : `<i class="ph ${iconPh}"></i>`;

            html += `
                <div class="history-item" style="margin-bottom: 16px;">
                    <div class="h-time" style="width: 60px; font-weight: 500;">${this.formatTimeDisplay(log.time)}</div>
                    <div class="h-icon ${iconClass}" style="overflow:hidden; display:flex; justify-content:center; align-items:center; position:relative;">
                        ${imageHtml}
                        ${log.image ? `<i class="ph-fill ${isTaken ? 'ph-check-circle' : 'ph-x-circle'} ${statusColor}" style="position:absolute; bottom:-4px; right:-4px; background:white; border-radius:50%; font-size:14px; box-shadow:0 0 0 2px var(--bg-color);"></i>` : ''}
                    </div>
                    <div class="h-details">
                        <div class="h-name" style="font-weight: 600;">${log.name}</div>
                        <div class="h-desc" style="color: var(--text-secondary); font-size: 13px;">${log.dosage}</div>
                    </div>
                    <div class="h-status ${statusColor}" style="font-weight: 500; font-size:13px;">${log.status} at ${log.timestamp}</div>
                </div>
            `;
        });

        html += `</div>`;
        historyList.innerHTML = html;
    },

    renderSchedule() {
        if (this.currentScreen !== 'schedule' || !this.currentUser) return;

        const container = document.getElementById('schedule-container');
        if (!container) return;
        container.innerHTML = '';

        let mCount = 0, aCount = 0, eCount = 0;
        let mHTML = `<div class="time-section"><div class="time-header"><i class="ph-fill ph-sun"></i><h4>Morning</h4></div><div class="med-list">`;
        let aHTML = `<div class="time-section"><div class="time-header"><i class="ph-fill ph-sun-horizon"></i><h4>Afternoon</h4></div><div class="med-list">`;
        let eHTML = `<div class="time-section"><div class="time-header"><i class="ph-fill ph-moon"></i><h4>Evening</h4></div><div class="med-list">`;

        const sortedMeds = [...this.medications].sort((a, b) => a.time.localeCompare(b.time));

        sortedMeds.forEach(med => {
            let [h, m] = med.time.split(':').map(Number);
            const timeDisplay = this.formatTimeDisplay(med.time);

            const daysStr = (med.days && med.days.length === 7) ? 'Everyday' : (med.days || []).join(', ');

            const imgBox = med.image ?
                `<img src="${med.image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` :
                `<i class="ph-fill ph-pill"></i>`;

            const cardHTML = `
            <div class="med-card upcoming" style="padding-bottom: 12px; margin-bottom: 12px;">
                <div class="med-time">${timeDisplay}</div>
                <div class="med-details">
                    <div class="med-img-box muted" style="padding:0; overflow:hidden; background: var(--border-color); display:flex; justify-content:center; align-items:center;">
                        ${imgBox}
                    </div>
                    <div class="med-info-box">
                        <div class="med-name">${med.name}</div>
                        <div class="med-desc">${med.dosage}</div>
                        <div class="med-desc" style="font-size: 11px; margin-top:4px;"><i class="ph ph-calendar"></i> ${daysStr}</div>
                    </div>
                    <button class="icon-button" style="color: var(--danger); margin-left: 8px;" onclick="app.deleteMedicine(${med.id})">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>`;

            if (h >= 12 && h < 17) {
                aHTML += cardHTML;
                aCount++;
            } else if (h >= 17) {
                eHTML += cardHTML;
                eCount++;
            } else {
                mHTML += cardHTML;
                mCount++;
            }
        });

        mHTML += `</div></div>`;
        aHTML += `</div></div>`;
        eHTML += `</div></div>`;

        if (mCount) container.innerHTML += mHTML;
        if (aCount) container.innerHTML += aHTML;
        if (eCount) container.innerHTML += eHTML;

        if (!mCount && !aCount && !eCount) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary); margin-top: 24px;"><div style="font-size: 40px; margin-bottom: 12px; opacity: 0.7;">📝</div><h3 style="color: var(--text-color);">No medicines scheduled</h3><p style="font-size: 14px; margin-top: 8px;">Plan your routines dynamically by clicking the Plus button.</p></div>`;
        }
    },

    deleteMedicine(id) {
        if (!confirm('Remove this medicine from your schedule?')) return;
        this.medications = this.medications.filter(m => m.id !== id);
        this.saveAllMeds();
        this.renderSchedule();
        this.renderMedications();
        this.updateStats();
        this.showToast('Medicine removed.');
    },

    renderMedications() {
        if (this.currentScreen !== 'dashboard' || !this.currentUser) return;

        const mList = document.querySelector('#time-morning .med-list');
        const aList = document.querySelector('#time-afternoon .med-list');
        const eList = document.querySelector('#time-evening .med-list');
        const timelineEl = document.querySelector('#screen-dashboard .timeline');

        if (!mList || !aList || !eList) return;

        mList.innerHTML = '';
        aList.innerHTML = '';
        eList.innerHTML = '';

        let existingBanner = document.getElementById('next-dose-banner');
        if (existingBanner) existingBanner.remove();
        let existingEmpty = document.getElementById('dashboard-empty-state');
        if (existingEmpty) existingEmpty.remove();

        let mCount = 0, aCount = 0, eCount = 0;

        const currentDayStr = this.getCurrentDay();
        const sortedMeds = [...this.medications]
            .filter(m => {
                const days = (m.days && m.days.length > 0) ? m.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                return days.includes(currentDayStr);
            })
            .sort((a, b) => a.time.localeCompare(b.time));

        let nextDoseMed = null;

        sortedMeds.forEach(med => {
            let [h, m] = med.time.split(':').map(Number);
            let section = 'morning';
            let listEl = mList;

            if (h >= 12 && h < 17) {
                section = 'afternoon';
                listEl = aList;
                aCount++;
            } else if (h >= 17) {
                section = 'evening';
                listEl = eList;
                eCount++;
            } else {
                mCount++;
            }

            const status = this.getMedStatus(med);
            const timeDisplay = this.formatTimeDisplay(med.snoozedTo || med.time);

            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            let [medH2, medM2] = (med.snoozedTo || med.time).split(':').map(Number);
            const medMins2 = medH2 * 60 + medM2;
            const diff = currentMins - medMins2;

            if ((status === 'UPCOMING' || status === 'DUE_NOW') && !nextDoseMed) {
                nextDoseMed = { ...med, status, timeDisplay };
            }

            const imgBox = med.image ?
                `<img src="${med.image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` :
                `<i class="ph-fill ph-pill"></i>`;

            let cardHTML = '';

            if (status === 'TAKEN') {
                cardHTML = `
                <div class="med-card taken">
                    <div class="med-time">${timeDisplay}</div>
                    <div class="med-details">
                        <div class="med-img-box muted" style="padding:0; overflow:hidden; display:flex; justify-content:center; align-items:center;">${imgBox}</div>
                        <div class="med-info-box">
                            <div class="med-name" style="text-decoration: line-through; opacity: 0.7;">${med.name}</div>
                            <div class="med-desc">${med.dosage}</div>
                        </div>
                    </div>
                    <div class="med-status" style="color: var(--success); margin-top: 8px;">
                        <i class="ph-fill ph-check-circle"></i> Taken at ${med.takenTime}
                    </div>
                </div>`;
            } else if (status === 'DUE_NOW') {
                const remaining = Math.max(0, 5 - diff);
                cardHTML = `
                <div class="med-card pending active-glow">
                    <div class="med-time active">
                        <span class="dot"></span> ${timeDisplay}
                    </div>
                    <div class="med-details">
                        <div class="med-img-box" style="padding:0; overflow:hidden; display:flex; justify-content:center; align-items:center;">
                            ${imgBox}
                        </div>
                        <div class="med-info-box">
                            <div class="med-name">${med.name}</div>
                            <div class="med-desc">${med.dosage}</div>
                        </div>
                    </div>
                    <div class="med-status" style="color: var(--warning); margin-bottom: 8px; font-weight: bold;">
                        <i class="ph-fill ph-warning"></i> Due Now • ${remaining}m remaining
                    </div>
                    <button class="btn primary full-width" onclick="app.setActiveMed(${med.id}); app.navigateTo('alert')" style="margin-top: 4px;">
                        <i class="ph ph-check"></i> Take Now
                    </button>
                </div>`;
            } else if (status === 'MISSED') {
                cardHTML = `
                <div class="med-card missed" style="border-left-color: var(--danger);">
                    <div class="med-time" style="color: var(--danger);">${timeDisplay}</div>
                    <div class="med-details">
                        <div class="med-img-box" style="background: var(--danger-light); color: var(--danger); padding:0; overflow:hidden; display:flex; justify-content:center; align-items:center;">
                            ${med.image ? `<img src="${med.image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; opacity: 0.8;">` : '<i class="ph-fill ph-warning-circle"></i>'}
                        </div>
                        <div class="med-info-box">
                            <div class="med-name">${med.name}</div>
                            <div class="med-desc">${med.dosage}</div>
                        </div>
                    </div>
                    <div class="med-status" style="color: var(--danger); margin-top: 8px; font-weight: bold;">
                        <i class="ph-fill ph-x-circle"></i> Missed
                    </div>
                    <button class="btn secondary full-width" disabled style="opacity: 0.5; margin-top: 12px; background: var(--danger-light); color: var(--danger); border: none; pointer-events: none;">
                        <i class="ph ph-lock"></i> Locked (Late)
                    </button>
                </div>`;
            } else {
                const waitTime = Math.max(0, -5 - diff);
                cardHTML = `
                <div class="med-card upcoming">
                    <div class="med-time">${timeDisplay}</div>
                    <div class="med-details">
                        <div class="med-img-box muted" style="padding:0; overflow:hidden; display:flex; justify-content:center; align-items:center;">
                            ${imgBox}
                        </div>
                        <div class="med-info-box">
                            <div class="med-name">${med.name}</div>
                            <div class="med-desc">${med.dosage}</div>
                        </div>
                    </div>
                    <div class="med-status upcoming-badge" style="margin-top: 8px; color: var(--text-secondary);">
                        <i class="ph ph-clock"></i> Available in ${waitTime} min
                    </div>
                    <button class="btn secondary full-width" disabled style="opacity: 0.5; margin-top: 12px; pointer-events: none;">
                        <i class="ph ph-lock"></i> Locked (Too Early)
                    </button>
                </div>`;
            }

            listEl.insertAdjacentHTML('beforeend', cardHTML);
        });

        document.getElementById('time-morning').style.display = mCount ? 'block' : 'none';
        document.getElementById('time-afternoon').style.display = aCount ? 'block' : 'none';
        document.getElementById('time-evening').style.display = eCount ? 'block' : 'none';

        if (!mCount && !aCount && !eCount) {
            timelineEl.insertAdjacentHTML('afterbegin', `<div id="dashboard-empty-state" style="text-align:center; padding: 40px 20px; color: var(--text-secondary); background: var(--card-bg); border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.03);"><div style="font-size: 48px; margin-bottom: 16px;">🛌</div><h3 style="color: var(--text-color); margin-bottom: 8px;">Rest Easy</h3><p>No medicines scheduled for today.</p></div>`);
        } else if (nextDoseMed) {
            const bannerColor = nextDoseMed.status === 'DUE_NOW' ? 'var(--warning-light)' : 'rgba(74, 175, 80, 0.1)';
            const textColor = nextDoseMed.status === 'DUE_NOW' ? 'var(--warning)' : 'var(--primary)';
            const iconClass = nextDoseMed.status === 'DUE_NOW' ? 'ph-warning' : 'ph-clock';

            timelineEl.insertAdjacentHTML('afterbegin', `
                <div id="next-dose-banner" style="background: ${bannerColor}; border-radius: 16px; padding: 16px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center; color: ${textColor}; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                            <i class="ph-fill ${iconClass}" style="font-size: 20px;"></i>
                        </div>
                        <div>
                            <p style="font-size: 12px; font-weight: 700; color: ${textColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Next Dose • ${nextDoseMed.timeDisplay}</p>
                            <h4 style="color: var(--text-color); font-size: 16px; margin: 0;">${nextDoseMed.name} <span style="font-weight: 400; color: var(--text-secondary); font-size: 13px;">${nextDoseMed.dosage.split('•')[0]}</span></h4>
                        </div>
                    </div>
                </div>
             `);
        }

        const total = sortedMeds.length;
        const takenCount = sortedMeds.filter(m => m.taken).length;
        this.updateProgressChart('.progress-card', takenCount, total, 'Daily Progress');

        const datePill = document.querySelector('.date-pill');
        if (datePill) {
            const now = new Date();
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const fullWeekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            datePill.innerHTML = `${monthNames[now.getMonth()]} ${now.getDate()}<br><small>${fullWeekDays[now.getDay()]}</small>`;
        }
    },

    updateProgressChart(containerSelector, taken, total, title) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const pct = total === 0 ? 0 : Math.round((taken / total) * 100);

        const detailsP = container.querySelector('p');
        if (detailsP) detailsP.textContent = `${taken} of ${total} medications taken`;

        const chartText = container.querySelector('.percentage');
        if (chartText) chartText.textContent = `${pct}%`;

        const circle = container.querySelector('.circle');
        if (circle) circle.setAttribute('stroke-dasharray', `${pct}, 100`);
    },

    updateStats() {
        if (!this.currentUser) return;

        const totalTaken = this.userHistory.filter(h => h.status === 'Taken').length;
        const totalMissed = this.userHistory.filter(h => h.status === 'Missed').length;

        const adherence = totalTaken + totalMissed === 0 ? 100 : Math.round((totalTaken / (totalTaken + totalMissed)) * 100);

        const pAdh = document.querySelector('#screen-profile .stat-num.green');
        if (pAdh) pAdh.textContent = adherence + '%';

        const pTaken = document.querySelectorAll('#screen-profile .stat-num')[1];
        if (pTaken) pTaken.textContent = totalTaken;

        const pMiss = document.querySelectorAll('#screen-profile .stat-num.orange')[0];
        if (pMiss) pMiss.textContent = totalMissed;
    },

    setActiveMed(id) {
        this.activeMedId = id;
        const med = this.medications.find(m => m.id === id);
        if (med) {
            if (this.getMedStatus(med) === 'MISSED') {
                this.showToast('You cannot take a missed medication.');
                return;
            }

            // Populate the new combined Alert Screen
            const imgContainerCss = document.getElementById('alert-pill-css');
            const imgEl = document.getElementById('alert-pill-img');
            if (med.image) {
                if (imgContainerCss) imgContainerCss.style.display = 'none';
                if (imgEl) { imgEl.src = med.image; imgEl.style.display = 'block'; }
            } else {
                if (imgContainerCss) imgContainerCss.style.display = 'flex';
                if (imgEl) imgEl.style.display = 'none';
                
                // Set generic imprint name if no image
                const imprint = document.querySelector('#alert-pill-css .imprint');
                if (imprint) imprint.textContent = med.name.substring(0, 3).toUpperCase();
            }

            const timeEl = document.querySelector('#screen-alert .alert-time');
            if (timeEl) timeEl.innerHTML = `<i class="ph ph-clock"></i> ${this.formatTimeDisplay(med.time)}`;

            const titleEl = document.querySelector('#screen-alert .med-title');
            if (titleEl) titleEl.textContent = med.name;

            const subTitleEl = document.querySelector('#screen-alert .med-subtitle');
            if (subTitleEl) subTitleEl.textContent = med.dosage;

            const instContainer = document.getElementById('alert-instructions');
            if (instContainer) {
                instContainer.innerHTML = '';
                
                const dosageParts = med.dosage.split('•');
                const cleanDosage = dosageParts.length > 1 ? dosageParts[0].trim() : med.dosage;
                
                // Default pills instruction
                instContainer.innerHTML += `
                    <div class="instruction-item">
                        <i class="ph ph-pill"></i>
                        <span>${cleanDosage}</span>
                    </div>
                `;

                if (med.instructions) {
                    const instList = med.instructions.split('•');
                    instList.forEach(inst => {
                        const trimmedInst = inst.trim();
                        let icon = 'ph-info';
                        
                        if (trimmedInst.toLowerCase().includes('water')) icon = 'ph-drop';
                        else if (trimmedInst.toLowerCase().includes('meal') || trimmedInst.toLowerCase().includes('food')) icon = 'ph-fork-knife';
                        else if (trimmedInst.toLowerCase().includes('empty')) icon = 'ph-clock';
                        else if (trimmedInst.toLowerCase().includes('bed')) icon = 'ph-moon';
                        
                        instContainer.innerHTML += `
                            <div class="instruction-item">
                                <i class="ph ${icon}"></i>
                                <span>${trimmedInst}</span>
                            </div>
                        `;
                    });
                }
            }
        }
    },

    addTimeField() {
        const container = document.getElementById('med-times-container');
        if (!container) return;
        const existingTimes = Array.from(container.querySelectorAll('.med-time-input')).map(input => input.value).filter(Boolean);
        const nextTime = existingTimes.length ? this.addMinutesToTime(existingTimes[existingTimes.length - 1], 30) : this.getHHMM();

        const row = document.createElement('div');
        row.className = 'time-input-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        row.innerHTML = `
            <input type="time" class="form-input med-time-input" required value="${nextTime}">
            <button type="button" class="btn outline secondary" onclick="this.parentElement.remove()" style="padding: 10px; border-radius: 50%; min-width: 44px;">
                <i class="ph ph-x"></i>
            </button>
        `;
        container.appendChild(row);
    },

    resetMedicineTimeFields() {
        const timesContainer = document.getElementById('med-times-container');
        if (!timesContainer) return;

        timesContainer.innerHTML = `
            <div class="time-input-row" style="display: flex; gap: 8px; align-items: center;">
                <input type="time" class="form-input med-time-input" required value="${this.getHHMM()}">
                <button type="button" class="btn outline secondary" onclick="this.parentElement.remove()" style="padding: 10px; border-radius: 50%; min-width: 44px; display: none;"><i class="ph ph-x"></i></button>
            </div>
        `;
    },

    handleSaveMedicine(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = document.getElementById('med-name').value.trim();
        const dosage = document.getElementById('med-dosage').value.trim();
        const freq = document.getElementById('med-freq') ? document.getElementById('med-freq').value : '';
        const timeInputs = document.querySelectorAll('.med-time-input');
        const times = Array.from(timeInputs).map(input => input.value).filter(Boolean);
        const instructionCheckboxes = document.querySelectorAll('input[name="med-instr"]:checked');
        const instructions = Array.from(instructionCheckboxes).map(cb => cb.value).join(' • ');
        const base64Img = document.getElementById('med-image-base64').value;
        const dayCheckboxes = document.querySelectorAll('input[name="med-days"]:checked');
        const days = Array.from(dayCheckboxes).map(cb => cb.value);

        if (!name || times.length === 0 || days.length === 0 || !base64Img) {
            this.showToast('Please fill all required fields');
            return;
        }

        const createdAt = Date.now();
        const newMeds = times.map((time, index) => ({
            id: createdAt + index,
            name, dosage, frequency: freq, time, instructions,
            taken: false, snoozedTo: null,
            alerted: false, alerted1: false, alerted2: false, alerted3: false,
            lastTakenDate: null, missLogged: false,
            days: days,
            image: base64Img || null
        }));

        this.medications.push(...newMeds);
        this.saveAllMeds();
        this.renderMedications();
        this.updateStats();

        this.showToast('Medicine added successfully');
        this.navigateTo('dashboard');

        e.target.reset();
        this.resetMedicineTimeFields();
        document.getElementById('med-image-preview').style.display = 'none';
        document.getElementById('med-image-base64').value = '';
        const imgInput = document.getElementById('med-image');
        if (imgInput) imgInput.value = '';

        document.querySelectorAll('input[name="med-days"]').forEach(cb => cb.checked = false);
    },

    selectAllDays() {
        const cbs = document.querySelectorAll('input[name="med-days"]');
        cbs.forEach(c => c.checked = true);
    },

    handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            document.getElementById('med-image-base64').value = base64;

            // Clear error if exists
            const errSpan = document.getElementById('med-image-error');
            if (errSpan) errSpan.style.display = 'none';

            const preview = document.getElementById('med-image-preview');
            const previewImg = document.getElementById('med-image-preview-img');
            previewImg.src = base64;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    },

    handleSnooze() {
        if (!this.activeMedId) return;
        this.stopAlarmSound();

        const med = this.medications.find(m => m.id === this.activeMedId);
        if (med) {
            const now = new Date();
            now.setMinutes(now.getMinutes() + 10);
            const hh = now.getHours().toString().padStart(2, '0');
            const mm = now.getMinutes().toString().padStart(2, '0');
            med.snoozedTo = `${hh}:${mm}`;
            med.alarmAcknowledgedDate = null;
            med.alerted1 = false;
            med.alerted2 = false;
            med.alerted3 = false;
            this.saveAllMeds();
        }
        this.showToast('Reminder snoozed for 10 minutes');

        const overlay = document.getElementById('alarm-overlay');
        if (overlay) overlay.remove();

        this.renderMedications();
        this.updateStats();
    },

    handleSnoozeFromAlarm(id) {
        this.activeMedId = id;
        this.handleSnooze();
    },

    takeNowFromAlarm(id) {
        const med = this.medications.find(m => m.id === id);
        if (!med) return;

        this.stopAlarmSound();
        med.taken = true;
        med.alerted1 = true;
        med.alerted2 = true;
        med.alerted3 = true;
        med.snoozedTo = null;
        med.alarmAcknowledgedDate = null;
        med.lastTakenDate = this.getCurrentDateStr();

        const now = new Date();
        let hours = now.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const minutes = now.getMinutes().toString().padStart(2, '0');
        med.takenTime = `${hours}:${minutes} ${ampm}`;

        this.logHistory(med, 'Taken');
        this.saveAllMeds();
        this.renderMedications();
        this.updateStats();

        const overlay = document.getElementById('alarm-overlay');
        if (overlay) overlay.remove();

        this.showToast('Dose Confirmed ✔️');
    },

    takeMedicine() {
        this.stopAlarmSound();
        if (this.activeMedId) {
            const med = this.medications.find(m => m.id === this.activeMedId);
            if (med) {
                if (this.getMedStatus(med) !== 'MISSED') {
                    med.taken = true;
                    med.snoozedTo = null;
                    med.alarmAcknowledgedDate = null;
                    med.lastTakenDate = this.getCurrentDateStr();

                    const now = new Date();
                    let hours = now.getHours();
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12;
                    hours = hours ? hours : 12;
                    const minutes = now.getMinutes().toString().padStart(2, '0');
                    med.takenTime = `${hours}:${minutes} ${ampm}`;

                    this.saveAllMeds();
                    this.logHistory(med, 'Taken');
                    this.renderMedications();
                    this.updateStats();

                    this.navigateTo('dashboard');
                    return;
                } else {
                    this.showToast('Sorry, this dose was missed.');
                }
            }
        }
        this.navigateTo('dashboard');
    },

    skipMedicine() {
        this.stopAlarmSound();
        if (this.activeMedId) {
            const med = this.medications.find(m => m.id === this.activeMedId);
            if (med) {
                if (this.getMedStatus(med) !== 'MISSED') {
                    med.taken = false;
                    med.snoozedTo = null;
                    med.alarmAcknowledgedDate = null;
                    med.lastTakenDate = this.getCurrentDateStr();
                    med.missLogged = true;
                    
                    this.saveAllMeds();
                    this.logHistory(med, 'Missed');
                    this.renderMedications();
                    this.updateStats();
                    
                    this.showToast('Logged as missed.');
                }
            }
        }
        this.navigateTo('dashboard');
    },

    navigateTo(screenId) {
        document.querySelectorAll('.screen').forEach(el => {
            el.classList.remove('active');
        });

        const targetScreen = document.getElementById(`screen-${screenId}`);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;

            document.querySelectorAll('.bottom-nav .nav-item').forEach(nav => nav.classList.remove('active'));
            if (screenId === 'dashboard') targetScreen.querySelector('.nav-item')?.classList.add('active');
            else if (screenId === 'schedule') {
                const navItems = targetScreen.querySelectorAll('.nav-item');
                if (navItems.length > 1) navItems[1].classList.add('active');
            }
            else if (screenId === 'history') {
                const navItems = targetScreen.querySelectorAll('.nav-item');
                if (navItems.length > 2) navItems[3].classList.add('active'); // 4th item = History due to FAB offset
            }

            if (screenId === 'success') {
                this.updateSuccessScreen();
                this.triggerConfetti();
            }
            if (screenId === 'schedule') {
                this.renderSchedule();
            }
            if (screenId === 'dashboard') {
                this.resetDailyMeds();
                this.renderMedications();
                this.updateStats();
            }
            if (screenId === 'history') {
                this.renderHistory();
            }
            if (screenId === 'profile') {
                this.updateStats();
            }
            if (screenId === 'add-med') {
                const timeInputs = document.querySelectorAll('.med-time-input');
                if (timeInputs.length === 1 && !timeInputs[0].value) {
                    timeInputs[0].value = this.getHHMM();
                }
            }
        }
    },

    handleLogin(e) {
        e.preventDefault();
        e.stopPropagation();
        const mobile = document.getElementById('login-mobile');
        const pass = document.getElementById('login-password');
        const phone = this.normalizePhone(mobile.value);
        const passwordValue = pass.value;
        let isValid = true;

        if (!this.isValidPhone(phone)) {
            this.showError('login-mobile', 'Please enter a valid mobile number.');
            isValid = false;
        } else {
            this.clearError('login-mobile');
        }

        if (!passwordValue) {
            this.showError('login-password', 'Password is required.');
            isValid = false;
        } else {
            this.clearError('login-password');
        }

        if (!isValid) return;

        const user = this.users.find(u => this.normalizePhone(u.phone || '') === phone && u.password === passwordValue);
        if (user) {
            this.currentUser = user;
            localStorage.setItem('currentUser', JSON.stringify(user));
            this.processAuth('btn-login', 'Welcome back!', user);
        } else {
            const modal = document.getElementById('error-modal');
            if (modal) modal.style.display = 'flex';
            this.showToast('Login failed. Check your mobile number and password.');
            this.clearError('login-password');
        }
    },

    handleSignup(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = document.getElementById('signup-name');
        const mobile = document.getElementById('signup-mobile');
        const pass = document.getElementById('signup-password');
        const nameValue = name.value.trim();
        const phone = this.normalizePhone(mobile.value);
        const passwordValue = pass.value;
        let isValid = true;

        if (!nameValue) {
            this.showError('signup-name', 'Name is required.');
            isValid = false;
        } else {
            this.clearError('signup-name');
        }

        if (!this.isValidPhone(phone)) {
            this.showError('signup-mobile', 'Please enter a valid mobile number.');
            isValid = false;
        } else {
            this.clearError('signup-mobile');
        }

        if (passwordValue.length < 6) {
            this.showError('signup-password', 'Password must be at least 6 characters.');
            isValid = false;
        } else {
            this.clearError('signup-password');
        }

        if (isValid) {
            const existingUser = this.getUserByPhone(phone);
            if (existingUser) {
                existingUser.name = nameValue;
                existingUser.password = passwordValue;
                if (existingUser.soundEnabled === undefined) existingUser.soundEnabled = true;
                this.saveUsers();
                this.clearError('signup-mobile');
                this.processAuth('btn-signup', 'Account found. Signed you in!', existingUser);
                return;
            }

            const newUser = { name: nameValue, phone, password: passwordValue, soundEnabled: true };
            this.users.push(newUser);
            this.saveUsers();
            this.currentUser = newUser;
            localStorage.setItem('currentUser', JSON.stringify(newUser));
            this.processAuth('btn-signup', 'Account created successfully!', newUser);
        }
    },

    processAuth(btnId, toastMsg, user) {
        const btn = document.getElementById(btnId);
        if (btn) {
            const text = btn.querySelector('.btn-text');
            const spinner = btn.querySelector('.spinner');
            if (text) text.style.display = 'none';
            if (spinner) spinner.style.display = 'block';
        }

        this.currentUser = { name: user.name, phone: user.phone, email: user.email, soundEnabled: user.soundEnabled !== false };
        // Persist currentUser immediately and consistently
        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

        setTimeout(() => {
            if (btn) {
                const text = btn.querySelector('.btn-text');
                const spinner = btn.querySelector('.spinner');
                if (text) text.style.display = 'flex';
                if (spinner) spinner.style.display = 'none';
            }

            this.loadUserMeds();
            this.resetDailyMeds();
            this.updateUserDataUI();
            this.renderMedications();
            this.updateStats();

            this.showToast(toastMsg);
            this.navigateTo('dashboard');
        }, 1200);
    },

    handleGuestLogin() {
        const guestUser = { name: "Guest User", phone: "0000000000", email: "guest@example.com", soundEnabled: true };
        this.processAuth(null, 'Continuing as guest', guestUser);
    },

    handleAddMedicine() {
        if (!this.currentUser) {
            alert("Session expired. Please login again.");
            this.navigateTo('login');
            return;
        }

        const name = document.getElementById('med-name').value.trim();
        const dosage = document.getElementById('med-dosage').value.trim();
        const freq = document.getElementById('med-freq') ? document.getElementById('med-freq').value : '';
        const timeInputs = document.querySelectorAll('.med-time-input');
        const times = Array.from(timeInputs).map(input => input.value).filter(Boolean);
        const instructionCheckboxes = document.querySelectorAll('input[name="med-instr"]:checked');
        const instructions = Array.from(instructionCheckboxes).map(cb => cb.value).join(' • ');
        const base64Img = document.getElementById('med-image-base64').value;
        let dayCheckboxes = document.querySelectorAll('input[name="med-days"]:checked');
        let days = Array.from(dayCheckboxes).map(cb => cb.value);

        if (!name || times.length === 0 || !base64Img) {
            this.showToast('Please fill all required fields');
            return;
        }

        // Set default days if none selected
        if (days.length === 0) {
            days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        }

        const createdAt = Date.now();
        const newMeds = times.map((time, index) => ({
            id: createdAt + index,
            name, dosage, frequency: freq, time, instructions,
            taken: false, snoozedTo: null,
            alerted: false, alerted1: false, alerted2: false, alerted3: false,
            lastTakenDate: null, missLogged: false,
            days: days,
            image: base64Img || null
        }));

        this.medications.push(...newMeds);
        this.saveAllMeds();
        this.renderMedications();
        this.updateStats();

        this.showToast('Medicine added successfully');
        this.navigateTo('dashboard');

        // Reset form
        document.getElementById('add-med-form').reset();
        this.resetMedicineTimeFields();
        document.getElementById('med-image-preview').style.display = 'none';
        document.getElementById('med-image-base64').value = '';
        const imgInput = document.getElementById('med-image');
        if (imgInput) imgInput.value = '';
    },

    logout() {
        localStorage.removeItem('currentUser');
        this.currentUser = null;
        this.medications = [];
        this.userHistory = [];

        const formIds = ['login-form', 'signup-form', 'add-med-form'];
        formIds.forEach(id => {
            const form = document.getElementById(id);
            if (form) form.reset();
        });

        this.navigateTo('welcome');
    },

    showError(inputId, msg) {
        const input = document.getElementById(inputId);
        const errorSpan = document.getElementById(inputId + '-error');
        if (input && errorSpan) {
            input.classList.add('error');
            errorSpan.textContent = msg;
            errorSpan.classList.add('visible');
        }
    },

    clearError(inputId) {
        const input = document.getElementById(inputId);
        const errorSpan = document.getElementById(inputId + '-error');
        if (input && errorSpan) {
            input.classList.remove('error');
            errorSpan.classList.remove('visible');
        }
    },

    togglePassword(inputId) {
        const input = document.getElementById(inputId);
        const icon = input.nextElementSibling;

        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('ph-eye-closed', 'ph-eye');
        } else {
            input.type = 'password';
            icon.classList.replace('ph-eye', 'ph-eye-closed');
        }
    },

    showToast(msg) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    },

    updateTime() {
        const now = new Date();
        let hours = now.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;
        document.querySelectorAll('.simple-header .time').forEach(el => el.textContent = timeStr);
    },

    triggerConfetti() {
        const container = document.getElementById('confetti');
        if (!container) return;

        container.innerHTML = '';
        const colors = ['#ffffff', '#4CAF50', '#81C784', '#FFE066'];

        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            confetti.style.position = 'absolute';
            confetti.style.width = '8px';
            confetti.style.height = '8px';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.top = '-10px';
            if (Math.random() > 0.5) confetti.style.borderRadius = '50%';
            container.appendChild(confetti);

            const duration = Math.random() * 2 + 1;
            const delay = Math.random() * 0.5;

            confetti.animate([
                { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
                { transform: `translate3d(${Math.random() * 100 - 50}px, 100vh, 0) rotate(${Math.random() * 360}deg)`, opacity: 0 }
            ], { duration: duration * 1000, delay: delay * 1000, easing: 'cubic-bezier(.37,0,.63,1)', fill: 'forwards' });
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
