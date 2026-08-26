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
    const ADMIN_KEY = 'pcd.admin';
    const ROULETTE_LABEL = 'ルーレット';
    const ROULETTE_MAX = 10;
    // 選手リストに入れる「ルーレット枠」の名前（ルーレット① / ルーレット② …）
    const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';

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

    /**
     * 監督のイメージカラー。監督オブジェクトでもIDでも渡せる。
     * 未設定の監督は、登録順のパレットで補う。
     */
    function teamColor(team) {
        const isObj = team && typeof team === 'object';
        if (isObj && team.color) return team.color;
        const id = isObj ? team.id : team;
        const n = parseInt(String(id).replace(/\D/g, ''), 10);
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
                roulette: ['助っ人A', '助っ人B', '助っ人C', '助っ人D', '助っ人E'].join('\n'),
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

    // 管理者かどうか。?admin=1 で有効化し、その端末に記憶する。
    // ?admin=0 で解除。観戦/配信モードと練習モードは常に固定。
    var ADMIN = (function () {
        if (params.get('view') === '1' || params.get('obs') === '1') return false;
        if (DEMO) return true;
        var flag = params.get('admin');
        try {
            if (flag === '1') { localStorage.setItem(ADMIN_KEY, '1'); return true; }
            if (flag === '0') { localStorage.removeItem(ADMIN_KEY); return false; }
            return localStorage.getItem(ADMIN_KEY) === '1';
        } catch (e) {
            return flag === '1';
        }
    })();

    function isAdmin() {
        return ADMIN;
    }

    function applyDisplayModes() {
        if (param('obs') === '1') document.body.classList.add('obs-mode');
        if (param('view') === '1') document.body.classList.add('view-mode');
        if (!ADMIN) document.body.classList.add('guest-mode');
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
                icon: (team && team.icon) || '',
                color: (team && team.color) || teamColor(id)
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

    // 仮出し（まだ確定していない）
    function isTentative(nomination) {
        return !!nomination && nomination.status === 'tentative';
    }

    // i 番目のルーレット枠の名前
    function rouletteSlotName(index) {
        const mark = CIRCLED_NUMS.charAt(index);
        return ROULETTE_LABEL + (mark || String(index + 1));
    }

    // 「ルーレット」「ルーレット①」など、ルーレット枠の名前かどうか
    function isRouletteName(name) {
        const key = normalizeName(name);
        if (!key) return false;
        return key.indexOf(normalizeName(ROULETTE_LABEL)) === 0;
    }

    // ルーレットで獲得した（もしくはこれから獲得する）指名
    function isRoulette(nomination) {
        if (!nomination) return false;
        return !!nomination.roulette || !!nomination.rouletteSlot ||
            isRouletteName(nomination.playerName);
    }

    // まだ回していないルーレット指名（当選すると playerName が実際の選手名に変わる）
    function isRouletteWaiting(nomination) {
        if (!nomination || isLost(nomination)) return false;
        if (nomination.rouletteWon) return false;
        return isRouletteName(nomination.playerName);
    }

    // 確定済みの指名だけを対象にする（抽選・進行判定・再指名チェックはこれを使う）
    function isActive(nomination) {
        return !!nomination && !!nomination.playerName && !isLost(nomination) && !isTentative(nomination);
    }

    // 盤面に出ている指名（仮出しを含む。抽選負けは除く）
    function hasPick(nomination) {
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
            // ルーレット同士も「重複」として扱う（ポーカー抽選で決める）
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

                // ルーレット枠は当選後も枠自体を使用済みにする（二度は使えない）
                if (nom.rouletteSlot) {
                    const slotKey = normalizeName(nom.rouletteSlot);
                    if (slotKey && !map.has(slotKey)) {
                        map.set(slotKey, { name: nom.rouletteSlot, round: r, teamId });
                    }
                }

                // 回す前の「ルーレット①」は選手名ではないので数えない
                if (isRouletteWaiting(nom)) return;
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
            revealed: s.revealed || {},
            allIn: s.allIn || {}
        };
    }

    function isRevealed(settings, round) {
        if (!settings.hidePicks) return true;
        return !!settings.revealed['round' + round];
    }

    // その巡で一度でも全チームが確定したか（以後その巡の指名はロックされる）
    function isAllIn(settings, round) {
        return !!settings.allIn['round' + round];
    }

    /**
     * 50音順に並べるための比較キー。
     * 半角カナ・全角英数を正規化し、カタカナをひらがなに寄せて大文字小文字を無視する。
     */
    function kanaKey(name) {
        const src = String(name || '').normalize('NFKC').toLowerCase();
        let out = '';
        for (let i = 0; i < src.length; i++) {
            const code = src.charCodeAt(i);
            // カタカナ（ァ〜ヶ）はひらがなに寄せる
            out += (code >= 0x30a1 && code <= 0x30f6)
                ? String.fromCharCode(code - 0x60)
                : src.charAt(i);
        }
        return out;
    }

    // ルーレット枠の番号（①→0, ②→1 …）。枠でなければ ROULETTE_MAX
    function rouletteSlotIndex(name) {
        const key = normalizeName(name);
        for (let i = 0; i < ROULETTE_MAX; i++) {
            if (normalizeName(rouletteSlotName(i)) === key) return i;
        }
        return ROULETTE_MAX;
    }

    // 登録選手を50音順に並べる。ルーレット枠は選手ではないので末尾に番号順でまとめる
    function sortPlayers(list) {
        const names = list.filter(name => !isRouletteName(name))
            .sort((a, b) => kanaKey(a).localeCompare(kanaKey(b), 'ja'));
        const slots = list.filter(name => isRouletteName(name))
            .sort((a, b) => rouletteSlotIndex(a) - rouletteSlotIndex(b));
        return names.concat(slots);
    }

    // 選手プール（textarea 保存形式）を配列に。表示は常に50音順
    function playerPool(draftData) {
        const raw = (draftData && draftData.players) || '';
        if (!raw) return [];
        return sortPlayers(String(raw)
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean));
    }

    /* ---------- ルーレット抽選 ---------- */

    // ルーレット対象の選手（最大 ROULETTE_MAX 名）
    function roulettePool(draftData) {
        const raw = (draftData && draftData.roulette) || '';
        if (!raw) return [];
        return String(raw)
            .split(String.fromCharCode(10))
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, ROULETTE_MAX);
    }

    /**
     * その巡でまだ回せるルーレットの出目。
     * 既に確定している選手・この巡で他チームが出している選手は盤から外す
     * （同じ選手を2チームが獲得してしまうのを防ぐ）。
     */
    function rouletteAvailable(draftData, round) {
        const pool = roulettePool(draftData);
        if (!pool.length) return [];

        const noms = (draftData && draftData.nominations) || {};
        const settings = readSettings(draftData);
        const taken = takenPlayers(noms, settings.totalRounds);

        // 仮出し中の指名も避ける（確定前でも被らせない）
        const inPlay = new Set();
        Object.values(roundData(noms, round)).forEach(nom => {
            if (!nom || !nom.playerName) return;
            if (isLost(nom) || isRouletteWaiting(nom)) return;
            inPlay.add(normalizeName(nom.playerName));
        });

        return pool.filter(name => {
            const key = normalizeName(name);
            return key && !taken.has(key) && !inPlay.has(key);
        });
    }

    /* ---------- 監督アイコン ---------- */

    /**
     * 入力を画像URLに変換する。
     *  - 画像URLならそのまま
     *  - X のプロフィールURL / @ハンドル は unavatar.io 経由で解決する
     *    （X は画像URLの直接取得を遮断しているため）
     */
    function iconUrl(raw) {
        const value = String(raw || '').trim();
        if (!value) return '';

        const xMatch = value.match(/(?:x\.com|twitter\.com)\/@?([A-Za-z0-9_]{1,15})/i);
        let handle = xMatch ? xMatch[1] : '';

        if (!handle) {
            // 画像URL・リポジトリ内の相対パスはそのまま使う
            if (/^https?:\/\//i.test(value)) return value;
            if (/[\/.]/.test(value)) return value;
            // @ハンドル もしくは ハンドルのみ
            const bare = value.replace(/^@/, '');
            if (/^[A-Za-z0-9_]{1,15}$/.test(bare)) handle = bare;
        }

        if (!handle) return '';
        return 'https://unavatar.io/x/' + encodeURIComponent(handle);
    }

    /**
     * チームの識別マーク。アイコンがあれば画像、無ければ従来の色ドット。
     * 画像の読み込みに失敗してもチームカラーの丸が残る。
     */
    function avatarHtml(team, extraClass) {
        const cls = extraClass ? ' ' + extraClass : '';
        const url = iconUrl(team && team.icon);
        if (!url) {
            return '<span class="pick-dot' + cls + '" style="--team-color:' +
                (team && team.color ? team.color : 'currentColor') + '"></span>';
        }
        const color = (team && team.color) ? team.color : 'transparent';
        return '<img class="team-avatar' + cls + '" src="' + esc(url) +
            '" alt="" style="--team-color:' + color + ';background:' + color + '">';
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
            container.innerHTML = '<div class="empty-state"><div class="big">—</div>チームが登録されていません</div>';
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
                    const tent = isTentative(nom);
                    if (!lost && !tent) done++;
                    items += '<li' + (tent ? ' class="pending"' : '') + '>' +
                        '<span class="rd">' + r + '巡</span>' +
                        '<span class="nm">' +
                        (lost ? '<s>' + esc(nom.playerName) + '</s> <span class="tag tag-lost">抽選負け</span>'
                            : tent ? esc(nom.playerName) + ' <span class="tag tag-tentative">仮</span>'
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
                avatarHtml(team) +
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
            container.innerHTML = '<div class="empty-state"><div class="big">—</div>チームが登録されていません</div>';
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
                        : isTentative(nom)
                            ? '<td class="empty">' + esc(nom.playerName) + '（仮）</td>'
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


    /* ---------- 結果のテキスト書き出し ---------- */

    const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

    function pad2(n) {
        return ('0' + n).slice(-2);
    }

    function fileStamp(date) {
        const d = date || new Date();
        return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
            '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    }

    // 1件の指名を「選手名（補足）」の形にする
    function pickText(nom) {
        if (!nom || !nom.playerName) return '—';
        if (isRouletteWaiting(nom)) return nom.playerName + '（抽選待ち）';
        if (isLost(nom)) return nom.playerName + '（抽選負け）';
        if (isTentative(nom)) return nom.playerName + '（仮）';
        return nom.playerName;
    }

    /**
     * ドラフト結果をプレーンテキストにする。
     * @param {object} draftData draft 直下のデータ
     */
    function buildResultsText(draftData) {
        const data = draftData || {};
        const settings = readSettings(data);
        const teams = teamList(data.teams);
        const noms = data.nominations || {};
        const rounds = settings.totalRounds;
        const lines = [];

        teams.forEach(team => {
            lines.push(team.name);
            for (let r = 1; r <= rounds; r++) {
                lines.push(r + '巡  ' + pickText(roundData(noms, r)[team.id]));
            }
            lines.push('');
        });

        return lines.join(CRLF);
    }

    // テキストをファイルとして保存させる
    function downloadText(filename, text) {
        // Windows のメモ帳で文字化けしないよう BOM を付ける
        const blob = new Blob([String.fromCharCode(0xFEFF) + text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    }

    // 結果テキストを既定のファイル名で保存する
    function downloadResultsText(draftData) {
        downloadText('pokachi-draft-' + fileStamp() + '.txt', buildResultsText(draftData));
    }

    global.Draft = {
        db,
        DEMO,
        DEFAULT_ROUNDS,
        esc,
        normalizeName,
        teamColor,
        iconUrl,
        avatarHtml,
        teamList,
        orderedTeams,
        roundData,
        isLost,
        isTentative,
        isActive,
        hasPick,
        findConflicts,
        takenPlayers,
        readSettings,
        isRevealed,
        isAllIn,
        playerPool,
        sortPlayers,
        roulettePool,
        rouletteAvailable,
        isRoulette,
        isRouletteWaiting,
        ROULETTE_LABEL,
        ROULETTE_MAX,
        rouletteSlotName,
        rouletteSlotIndex,
        isRouletteName,
        renderResultsGrid,
        renderResultsMatrix,
        toast,
        buildResultsText,
        downloadResultsText,
        downloadText,
        param,
        isAdmin,
        applyDisplayModes
    };
})(window);
