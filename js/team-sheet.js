// js/team-sheet.js — 各チームの指名シート
(function () {
    'use strict';

    const D = window.Draft;
    const db = D.db;
    const STORAGE_KEY = 'pcd.teamId';

    const state = {
        teamId: null,
        teams: {},
        nominations: {},
        currentRound: 1,
        settings: { totalRounds: D.DEFAULT_ROUNDS, hidePicks: false, revealed: {} },
        players: ''
    };

    let poolFilter = '';
    let lastRound = null;

    /* ---------- 初期化 ---------- */

    function init() {
        D.applyDisplayModes();
        state.teamId = D.param('team') || safeStorageGet(STORAGE_KEY);
        bindEvents();

        db.ref('draft').on('value', snapshot => {
            const data = snapshot.val() || {};
            state.teams = data.teams || {};
            state.nominations = data.nominations || {};
            state.currentRound = data.currentRound || 1;
            state.settings = D.readSettings(data);
            state.players = data.players || '';

            // チームIDが不正なら選択画面に戻す
            if (state.teamId && !state.teams[state.teamId]) state.teamId = null;

            render();
        }, error => {
            console.error('データ取得エラー:', error);
            D.toast('データを取得できませんでした', 'danger', 6000);
        });
    }

    function bindEvents() {
        document.getElementById('btn-submit').addEventListener('click', submitNomination);
        document.getElementById('btn-confirm').addEventListener('click', confirmNomination);
        document.getElementById('btn-show-results').addEventListener('click', showResults);
        document.getElementById('btn-switch-team').addEventListener('click', () => {
            state.teamId = null;
            safeStorageRemove(STORAGE_KEY);
            render();
        });

        document.getElementById('pool-search').addEventListener('input', e => {
            poolFilter = D.normalizeName(e.target.value);
            renderPool();
        });

        const nameInput = document.getElementById('player-name');
        nameInput.addEventListener('input', () => {
            renderWarnings();
            renderPool();
        });
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') submitNomination();
        });
    }

    /* ---------- 描画 ---------- */

    function render() {
        const picker = document.getElementById('team-picker');
        const main = document.getElementById('sheet-main');

        if (!state.teamId) {
            picker.classList.remove('hide');
            main.classList.add('hide');
            document.getElementById('team-name').textContent = 'チーム選択';
            document.getElementById('btn-switch-team').classList.add('hide');
            renderTeamChoices();
            return;
        }

        picker.classList.add('hide');
        main.classList.remove('hide');
        document.getElementById('btn-switch-team').classList.remove('hide');

        const team = state.teams[state.teamId];
        document.getElementById('team-name').textContent = (team && team.name) || state.teamId;
        document.getElementById('team-mark').style.background = D.teamColor(state.teamId);
        document.getElementById('current-round').textContent = state.currentRound;

        // 巡目が変わったら入力欄をリセット
        if (lastRound !== null && lastRound !== state.currentRound) {
            document.getElementById('player-name').value = '';
            poolFilter = '';
            document.getElementById('pool-search').value = '';
            D.toast('第' + state.currentRound + '巡目が始まりました', 'info');
        }
        lastRound = state.currentRound;

        renderStatus();
        renderPool();
        renderWarnings();
        renderHistory();
    }

    function renderTeamChoices() {
        const box = document.getElementById('team-choices');
        const teams = D.teamList(state.teams);
        box.innerHTML = '';

        if (!teams.length) {
            box.innerHTML = '<p class="muted">チームが登録されていません</p>';
            return;
        }

        teams.forEach(team => {
            const btn = document.createElement('button');
            btn.className = 'btn2';
            btn.style.borderColor = team.color;
            btn.innerHTML = '<span class="pick-dot" style="--team-color:' + team.color + '"></span>' + D.esc(team.name);
            btn.addEventListener('click', () => {
                state.teamId = team.id;
                safeStorageSet(STORAGE_KEY, team.id);
                render();
            });
            box.appendChild(btn);
        });
    }

    function myNomination() {
        return D.roundData(state.nominations, state.currentRound)[state.teamId] || null;
    }

    function renderStatus() {
        const box = document.getElementById('sheet-status');
        const icon = document.getElementById('status-icon');
        const title = document.getElementById('status-title');
        const detail = document.getElementById('status-detail');
        const submitBtn = document.getElementById('btn-submit');

        const nom = myNomination();
        box.className = 'sheet-status';

        if (nom && D.isLost(nom)) {
            box.classList.add('state-redo');
            icon.textContent = '🎯';
            title.textContent = '抽選負け — 再指名してください';
            detail.textContent = '「' + nom.playerName + '」は他チームが獲得しました。別の選手を指名してください。';
            submitBtn.textContent = '再指名する';
        } else if (nom && nom.playerName) {
            box.classList.add('state-done');
            icon.textContent = '✅';
            title.textContent = '指名済み：' + nom.playerName;
            detail.textContent = '結果を待っています。送信し直すと指名を変更できます。';
            submitBtn.textContent = '指名を変更する';
        } else {
            box.classList.add('state-waiting');
            icon.textContent = '✍️';
            title.textContent = '第' + state.currentRound + '巡目の指名を送信してください';
            const order = D.orderedTeams(D.teamList(state.teams), state.currentRound);
            const index = order.findIndex(t => t.id === state.teamId);
            detail.textContent = index >= 0 ? 'この巡のあなたの指名順は ' + (index + 1) + ' 番手です' : '';
            submitBtn.textContent = 'この選手を指名する';
        }
    }

    // 過去の巡で確定済み＝再指名できない選手
    function takenBefore() {
        return D.takenPlayers(state.nominations, state.settings.totalRounds, { beforeRound: state.currentRound });
    }

    // 今の巡で他チームが指名中の選手（被せると抽選）
    function contestedNow() {
        const map = new Map();
        if (state.settings.hidePicks && !D.isRevealed(state.settings, state.currentRound)) return map;

        const round = D.roundData(state.nominations, state.currentRound);
        Object.entries(round).forEach(([teamId, nom]) => {
            if (teamId === state.teamId || !D.isActive(nom)) return;
            const team = state.teams[teamId];
            map.set(D.normalizeName(nom.playerName), (team && team.name) || teamId);
        });
        return map;
    }

    function renderPool() {
        const pool = D.playerPool({ players: state.players });
        const block = document.getElementById('pool-block');
        const box = document.getElementById('player-pool');
        const count = document.getElementById('pool-count');

        if (!pool.length) {
            block.classList.add('hide');
            count.textContent = '';
            return;
        }
        block.classList.remove('hide');

        const taken = takenBefore();
        const contested = contestedNow();
        const current = D.normalizeName(document.getElementById('player-name').value);

        const available = pool.filter(name => !taken.has(D.normalizeName(name)));
        count.textContent = '残り ' + available.length + ' / ' + pool.length + ' 名';

        const shown = pool.filter(name => !poolFilter || D.normalizeName(name).indexOf(poolFilter) !== -1);
        box.innerHTML = '';

        if (!shown.length) {
            box.innerHTML = '<p class="pool-empty">該当する選手がいません</p>';
            return;
        }

        shown.forEach(name => {
            const key = D.normalizeName(name);
            const takenBy = taken.get(key);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pool-chip';

            if (takenBy) {
                btn.classList.add('taken');
                btn.disabled = true;
                btn.innerHTML = D.esc(name) + '<span class="by">' + takenBy.round + '巡目で指名済</span>';
            } else {
                if (key === current) btn.classList.add('selected');
                const rival = contested.get(key);
                btn.innerHTML = D.esc(name) + (rival ? '<span class="by">⚔ ' + D.esc(rival) + '</span>' : '');
                btn.addEventListener('click', () => {
                    document.getElementById('player-name').value = name;
                    renderPool();
                    renderWarnings();
                });
            }

            box.appendChild(btn);
        });
    }

    // 入力中の選手についての注意書き
    function collectWarnings(name) {
        const warnings = [];
        const key = D.normalizeName(name);
        if (!key) return warnings;

        const taken = takenBefore().get(key);
        if (taken) {
            warnings.push({
                type: 'danger',
                text: 'この選手は' + taken.round + '巡目ですでに指名されています（原則として再指名不可）'
            });
        }

        const rival = contestedNow().get(key);
        if (rival) {
            warnings.push({
                type: 'warn',
                text: rival + ' が同じ選手を指名中です。このまま指名すると抽選になります'
            });
        }

        const pool = D.playerPool({ players: state.players });
        if (pool.length && !pool.some(p => D.normalizeName(p) === key)) {
            warnings.push({ type: 'info', text: '候補選手リストにない名前です。入力ミスにご注意ください' });
        }

        return warnings;
    }

    function warningHtml(warnings) {
        if (!warnings.length) return '';
        const cls = { danger: 'tag-conflict', warn: 'tag-lost', info: 'tag-dup' };
        return '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">' +
            warnings.map(w =>
                '<span class="tag ' + cls[w.type] + '" style="white-space:normal;text-align:left;padding:7px 11px">' +
                D.esc(w.text) + '</span>'
            ).join('') + '</div>';
    }

    function renderWarnings() {
        const name = document.getElementById('player-name').value.trim();
        document.getElementById('warning-box').innerHTML = warningHtml(collectWarnings(name));
    }

    function renderHistory() {
        const box = document.getElementById('team-history');
        box.innerHTML = '';
        let any = false;

        for (let r = 1; r <= state.settings.totalRounds; r++) {
            const nom = D.roundData(state.nominations, r)[state.teamId];
            const li = document.createElement('li');

            if (nom && nom.playerName) {
                any = true;
                const lost = D.isLost(nom);
                li.innerHTML = '<span class="rd">' + r + '巡</span><span class="nm">' +
                    (lost ? '<s>' + D.esc(nom.playerName) + '</s> <span class="tag tag-lost">抽選負け</span>'
                        : D.esc(nom.playerName)) + '</span>';
            } else {
                li.className = 'pending';
                li.innerHTML = '<span class="rd">' + r + '巡</span><span class="nm">—</span>';
            }
            box.appendChild(li);
        }

        if (!any) {
            box.innerHTML = '<li class="pending"><span class="nm">まだ指名がありません</span></li>';
        }
    }

    /* ---------- 送信 ---------- */

    function submitNomination() {
        const name = document.getElementById('player-name').value.trim();

        if (!name) {
            D.toast('選手名を入力してください', 'danger');
            return;
        }

        const warnings = collectWarnings(name);
        document.getElementById('confirm-round').textContent = state.currentRound;
        document.getElementById('confirmPlayerName').textContent = name;
        document.getElementById('confirm-warnings').innerHTML = warningHtml(warnings);

        new bootstrap.Modal(document.getElementById('confirmModal')).show();
    }

    function confirmNomination() {
        const name = document.getElementById('player-name').value.trim();
        if (!name) return;

        const round = state.currentRound;
        const team = state.teams[state.teamId];
        const teamName = (team && team.name) || state.teamId;
        const previous = myNomination();

        // 抽選負けした指名は履歴として残す
        const attempts = (previous && previous.attempts) ? previous.attempts.slice() : [];
        if (previous && D.isLost(previous)) {
            attempts.push({
                playerName: previous.playerName,
                status: 'lost_lottery',
                timestamp: previous.timestamp || Date.now()
            });
        }

        const payload = {
            playerName: name,
            teamName: teamName,
            timestamp: Date.now(),
            status: 'confirmed'
        };
        if (attempts.length) payload.attempts = attempts;

        const btn = document.getElementById('btn-confirm');
        btn.disabled = true;

        db.ref('draft/nominations/round' + round + '/' + state.teamId).set(payload)
            .then(() => {
                document.getElementById('player-name').value = '';
                poolFilter = '';
                document.getElementById('pool-search').value = '';
                renderPool();
                renderWarnings();
                const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
                if (modal) modal.hide();
                D.toast('「' + name + '」を指名しました', 'success');
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger', 6000))
            .then(() => { btn.disabled = false; });
    }

    /* ---------- 結果一覧 ---------- */

    function showResults() {
        D.renderResultsGrid(
            document.getElementById('results-container'),
            state.teams, state.nominations, state.settings.totalRounds
        );
        new bootstrap.Modal(document.getElementById('resultsModal')).show();
    }

    /* ---------- localStorage（プライベートモード対策） ---------- */

    function safeStorageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function safeStorageSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* 無視 */ }
    }

    function safeStorageRemove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* 無視 */ }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
