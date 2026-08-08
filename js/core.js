// js/core.js — 全画面で共有する初期化とユーティリティ
(function (global) {
    'use strict';

    /* ---------- Firebase ---------- */

    const firebaseConfig = {
        apiKey: "AIzaSyCpbFz9odW0pjM67RBKi1g3K__-H5tAaqk",
        authDomain: "porker-chase-draft.firebaseapp.com",
        databaseURL: "https://porker-chase-draft-default-rtdb.asia-southeast1.firebasedatabase.app/",
        projectId: "porker-chase-draft",
        storageBucket: "porker-chase-draft.firebasestorage.app",
        messagingSenderId: "1017710444956",
        appId: "1:1017710444956:web:f9538ef485beb7b7074859",
        measurementId: "G-HKFTDR6SK0"
    };

    const params = new URLSearchParams(global.location.search);
    const DEMO = params.get('demo') === '1';

    let db;
    if (DEMO) {
        db = createMockDb();
    } else {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        db = firebase.database();
    }

    /* ---------- 定数 ---------- */

    const DEFAULT_ROUNDS = 6;

    // チームカラー（team1..team8）
    const TEAM_COLORS = [
        '#63b3ff', // 1
        '#ff8fa3', // 2
        '#3ddc97', // 3
        '#e5c368', // 4
        '#c08cff', // 5
        '#ff9f5a', // 6
        '#4fd8d8', // 7
        '#f26d9c'  // 8
    ];

    function teamColor(teamId) {
        const n = parseInt(String(teamId).replace(/\D/g, ''), 10);
        if (!n || isNaN(n)) return TEAM_COLORS[0];
        return TEAM_COLORS[(n - 1) % TEAM_COLORS.length];
    }

    /* ---------- 文字列 ---------- */

    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 表記ゆれを吸収して同一選手を判定するためのキー
    function normalizeName(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[\s　]+/g, '')
            .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    }

    /* ---------- 練習モード（?demo=1）: Firebase を使わないメモリ内DB ---------- */

    function createMockDb() {
        const KEY = 'pcd.demo';
        let root = load() || {
            draft: {
                currentRound: 1,
                teams: {
                    team1: { id: 'team1', name: 'ぶちまろ' },
                    team2: { id: 'team2', name: 'ひつじ(17)' },
                    team3: { id: 'team3', name: 'ハムの人' },
                    team4: { id: 'team4', name: 'チェス' },
                    team5: { id: 'team5', name: '欧米か' }
                },
                nominations: {},
                players: ['ちゃんかね', 'ドナルド', 'たぬぴょん', 'ダリア', 'きをする',
                    'ムロボさん', 'あろっち', 'みかんちゃん', 'しんや', 'ロッテさん',
                    '水無月遊夢', 'のぞみん', 'MOCHA', 'かつぶし', 'たっく',
                    'はまこみ', '漬けイクラ', 'ミジュマル', 'Makoto', 'おお@もぎたて',
                    'エイトワン', 'あるふぁたゃん', 'ぴしゃーちゃ', 'ぷぅ', 'NoraDDR'].join('\n'),
                settings: { totalRounds: 6, hidePicks: false }
            }
        };

        const listeners = [];

        function load() {
            try {
                const raw = localStorage.getItem(KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) { return null; }
        }

        function save() {
            try { localStorage.setItem(KEY, JSON.stringify(root)); } catch (e) { /* 無視 */ }
        }

        // 同じPCの別タブ（ボード / 各チームのシート）と同期する
        global.addEventListener('storage', e => {
            if (e.key !== KEY || !e.newValue) return;
            try {
                root = JSON.parse(e.newValue);
                listeners.forEach(l => l.callback({ val: () => clone(read(l.path)) }));
            } catch (err) { /* 無視 */ }
        });

        function segments(path) {
            return String(path || '').split('/').filter(Boolean);
        }

        function read(path) {
            let node = root;
            for (const seg of segments(path)) {
                if (node === null || typeof node !== 'object') return null;
                node = node[seg];
                if (node === undefined) return null;
            }
            return node === undefined ? null : node;
        }

        function write(path, value) {
            const segs = segments(path);
            if (!segs.length) { root = value || {}; return; }
            let node = root;
            for (let i = 0; i < segs.length - 1; i++) {
                if (node[segs[i]] === null || typeof node[segs[i]] !== 'object') node[segs[i]] = {};
                node = node[segs[i]];
            }
            const last = segs[segs.length - 1];
            if (value === null || value === undefined) delete node[last];
            else node[last] = value;
        }

        function notify() {
            save();
            listeners.forEach(l => l.callback({ val: () => clone(read(l.path)) }));
        }

        function clone(value) {
            return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
        }

        function ref(path) {
            const target = path || '';
            return {
                on(event, callback) {
                    listeners.push({ path: target, callback });
                    callback({ val: () => clone(read(target)) });
                },
                once(event, callback) {
                    const snap = { val: () => clone(read(target)) };
                    if (callback) callback(snap);
                    return Promise.resolve(snap);
                },
                set(value) {
                    write(target, clone(value));
                    notify();
                    return Promise.resolve();
                },
                remove() {
                    write(target, null);
                    notify();
                    return Promise.resolve();
                },
                update(updates) {
                    Object.entries(updates).forEach(([key, value]) => {
                        write(target ? target + '/' + key : key, clone(value));
                    });
                    notify();
                    return Promise.resolve();
                }
            };
        }

        return { ref };
    }

    /* ---------- URL パラメータ ---------- */

    function param(key) {
        return params.get(key);
    }

    function applyDisplayModes() {
        if (param('obs') === '1') document.body.classList.add('obs-mode');
        if (param('view') === '1') document.body.classList.add('view-mode');
        if (DEMO) {
            const banner = document.createElement('div');
            banner.className = 'demo-banner no-obs';
            banner.innerHTML = '練習モード — 本番データには保存されません ' +
                '<button type="button" id="demo-clear">練習データを消す</button>';
            document.body.insertBefore(banner, document.body.firstChild);
            banner.querySelector('#demo-clear').addEventListener('click', () => {
                try { localStorage.removeItem('pcd.demo'); } catch (e) { /* 無視 */ }
                global.location.reload();
            });
        }
    }

    /* ---------- データ整形 ---------- */

    // teams オブジェクト → order を考慮した配列
    function teamList(teamsData) {
        if (!teamsData) return [];
        return Object.entries(teamsData)
            .map(([id, team]) => ({
                id,
                name: (team && team.name) || id,
                order: (team && typeof team.order === 'number') ? team.order : null,
                color: teamColor(id)
            }))
            .sort((a, b) => {
                if (a.order !== null && b.order !== null) return a.order - b.order;
                const na = parseInt(a.id.replace(/\D/g, ''), 10) || 0;
                const nb = parseInt(b.id.replace(/\D/g, ''), 10) || 0;
                return na - nb;
            });
    }

    // 偶数巡は逆順（スネークドラフト）
    function orderedTeams(teams, round) {
        const list = teams.slice();
        return (round % 2 === 0) ? list.reverse() : list;
    }

    function roundData(nominationsData, round) {
        if (!nominationsData) return {};
        return nominationsData['round' + round] || {};
    }

    function isLost(nomination) {
        return !!nomination && nomination.status === 'lost_lottery';
    }

    // 有効な（抽選負けでない）指名だけを対象にする
    function isActive(nomination) {
        return !!nomination && !!nomination.playerName && !isLost(nomination);
    }

    /**
     * その巡で重複している選手を検出する。
     * @returns [{ name, key, teamIds: [] }]
     */
    function findConflicts(nominationsData, round) {
        const data = roundData(nominationsData, round);
        const buckets = {};

        Object.entries(data).forEach(([teamId, nom]) => {
            if (!isActive(nom)) return;
            const key = normalizeName(nom.playerName);
            if (!key) return;
            if (!buckets[key]) buckets[key] = { name: nom.playerName, key, teamIds: [] };
            buckets[key].teamIds.push(teamId);
        });

        return Object.values(buckets).filter(b => b.teamIds.length > 1);
    }

    /**
     * 過去に「確定済み」で指名された選手の一覧（再指名チェック用）。
     * @returns Map<normalizedName, { name, round, teamId }>
     */
    function takenPlayers(nominationsData, totalRounds, opts) {
        const options = opts || {};
        const map = new Map();
        if (!nominationsData) return map;

        for (let r = 1; r <= totalRounds; r++) {
            if (options.beforeRound && r >= options.beforeRound) break;
            const data = roundData(nominationsData, r);
            Object.entries(data).forEach(([teamId, nom]) => {
                if (!isActive(nom)) return;
                const key = normalizeName(nom.playerName);
                if (!key || map.has(key)) return;
                map.set(key, { name: nom.playerName, round: r, teamId });
            });
        }
        return map;
    }

    // 設定（存在しない場合はデフォルト）
    function readSettings(draftData) {
        const s = (draftData && draftData.settings) || {};
        return {
            totalRounds: s.totalRounds || DEFAULT_ROUNDS,
            hidePicks: !!s.hidePicks,
            revealed: s.revealed || {}
        };
    }

    function isRevealed(settings, round) {
        if (!settings.hidePicks) return true;
        return !!settings.revealed['round' + round];
    }

    // 選手プール（textarea 保存形式）を配列に
    function playerPool(draftData) {
        const raw = (draftData && draftData.players) || '';
        if (!raw) return [];
        return String(raw)
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
    }

    /* ---------- トースト ---------- */

    let toastStack = null;

    function toast(message, type, ms) {
        if (!toastStack) {
            toastStack = document.createElement('div');
            toastStack.className = 'toast-stack';
            document.body.appendChild(toastStack);
        }
        const el = document.createElement('div');
        el.className = 'toast ' + (type || 'info');
        el.textContent = message;
        toastStack.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s, transform .3s';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-10px)';
            setTimeout(() => el.remove(), 320);
        }, ms || 2800);
    }

    /* ---------- 結果一覧の共通レンダラ ---------- */

    function renderResultsGrid(container, teamsData, nominationsData, totalRounds) {
        const teams = teamList(teamsData);
        container.innerHTML = '';
        container.className = 'results-grid';

        if (!teams.length) {
            container.innerHTML = '<div class="empty-state"><div class="big">🃏</div>チームが登録されていません</div>';
            return;
        }

        teams.forEach(team => {
            const card = document.createElement('div');
            card.className = 'team-card';
            card.style.setProperty('--team-color', team.color);

            let items = '';
            let done = 0;

            for (let r = 1; r <= totalRounds; r++) {
                const nom = roundData(nominationsData, r)[team.id];
                if (nom && nom.playerName) {
                    const lost = isLost(nom);
                    if (!lost) done++;
                    items += '<li>' +
                        '<span class="rd">' + r + '巡</span>' +
                        '<span class="nm">' +
                        (lost ? '<s>' + esc(nom.playerName) + '</s> <span class="tag tag-lost">抽選負け</span>'
                            : esc(nom.playerName)) +
                        '</span></li>';
                } else {
                    items += '<li class="pending">' +
                        '<span class="rd">' + r + '巡</span>' +
                        '<span class="nm">—</span></li>';
                }
            }

            card.innerHTML =
                '<div class="team-card-head">' +
                esc(team.name) +
                '<span class="team-card-count">' + done + '/' + totalRounds + '</span>' +
                '</div>' +
                '<ul class="team-picks">' + items + '</ul>';

            container.appendChild(card);
        });
    }

    function renderResultsMatrix(container, teamsData, nominationsData, totalRounds) {
        const teams = teamList(teamsData);
        container.className = 'tbl-wrap';

        if (!teams.length) {
            container.innerHTML = '<div class="empty-state"><div class="big">🃏</div>チームが登録されていません</div>';
            return;
        }

        let head = '<tr><th>巡目</th>';
        teams.forEach(t => {
            head += '<th class="team-head" style="border-bottom-color:' + t.color + '">' + esc(t.name) + '</th>';
        });
        head += '</tr>';

        let body = '';
        for (let r = 1; r <= totalRounds; r++) {
            body += '<tr><td class="round-cell">' + r + '巡目</td>';
            teams.forEach(t => {
                const nom = roundData(nominationsData, r)[t.id];
                if (nom && nom.playerName) {
                    body += isLost(nom)
                        ? '<td><s>' + esc(nom.playerName) + '</s></td>'
                        : '<td>' + esc(nom.playerName) + '</td>';
                } else {
                    body += '<td class="empty">—</td>';
                }
            });
            body += '</tr>';
        }

        container.innerHTML = '<table class="tbl matrix"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    }

    /* ---------- 公開 ---------- */

    global.Draft = {
        db,
        DEMO,
        DEFAULT_ROUNDS,
        esc,
        normalizeName,
        teamColor,
        teamList,
        orderedTeams,
        roundData,
        isLost,
        isActive,
        findConflicts,
        takenPlayers,
        readSettings,
        isRevealed,
        playerPool,
        renderResultsGrid,
        renderResultsMatrix,
        toast,
        param,
        applyDisplayModes
    };
})(window);
