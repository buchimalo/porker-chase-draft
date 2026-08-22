// js/main.js — メインボード（進行・抽選・管理）
(function () {
    'use strict';

    const D = window.Draft;
    const db = D.db;

    /* ---------- 状態 ---------- */

    const state = {
        teams: {},
        nominations: {},
        currentRound: 1,
        settings: { totalRounds: D.DEFAULT_ROUNDS, hidePicks: false, revealed: {} },
        players: ''
    };

    let historyView = 'list';
    let resultsView = 'grid';
    let lotteryCtx = null;  // { player, key, teamIds, winner }
    let teamDraft = null;   // チーム編集モーダルの作業用コピー
    let playerDraft = [];   // 選手リスト編集モーダルの作業用コピー

    /* ---------- 初期化 ---------- */

    function init() {
        D.applyDisplayModes();
        bindEvents();

        db.ref('draft').on('value', snapshot => {
            const data = snapshot.val() || {};
            state.teams = data.teams || {};
            state.nominations = data.nominations || {};
            state.currentRound = data.currentRound || 1;
            state.settings = D.readSettings(data);
            state.players = data.players || '';
            render();
        }, error => {
            console.error('データ取得エラー:', error);
            D.toast('データを取得できませんでした', 'danger', 6000);
        });
    }

    function bindEvents() {
        on('btn-prev-round', () => changeRound(-1));
        on('btn-next-round', () => changeRound(1));
        on('btn-show-results', showResults);
        on('btn-toggle-admin', () => toggleAdmin());
        on('btn-close-admin', () => toggleAdmin(false));
        on('btn-set-lost', setLostTeams);
        on('btn-reset', resetDraft);
        on('btn-edit-players', openPlayersModal);
        on('btn-save-players', savePlayers);
        on('btn-edit-teams', openTeamsModal);
        on('btn-add-team', addTeamRow);
        on('btn-save-teams', saveTeams);
        on('btn-copy-urls', copyAllTeamSheetUrls);
        on('btn-add-player', addPlayer);
        on('btn-toggle-bulk', toggleBulk);
        on('btn-apply-bulk', applyBulk);

        document.getElementById('player-add-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); addPlayer(); }
        });

        // 貼り付け・入力と同時にチップ一覧と人数へ反映する
        document.getElementById('players-textarea').addEventListener('input', () => {
            syncFromBulk();
            renderPlayerEditor();
        });
        on('btn-reveal', () => setRevealed(true));
        on('btn-unreveal', () => setRevealed(false));
        on('btn-save-rounds', saveTotalRounds);
        on('btn-spin', spinLottery);
        on('btn-apply-lottery', applyLottery);

        const hideChk = document.getElementById('chk-hide-picks');
        hideChk.addEventListener('change', () => {
            db.ref('draft/settings/hidePicks').set(hideChk.checked)
                .then(() => D.toast(hideChk.checked ? '伏せモードを有効にしました' : '伏せモードを解除しました', 'info'))
                .catch(err => D.toast('保存に失敗しました: ' + err.message, 'danger'));
        });

        segment('history-view-toggle', v => { historyView = v; renderHistory(); });
        segment('results-view-toggle', v => { resultsView = v; renderResults(); });

        // キーボードショートカット（配信オペ用）
        document.addEventListener('keydown', e => {
            if (e.target.matches('input, textarea')) return;
            if (e.key === 'ArrowLeft') changeRound(-1);
            if (e.key === 'ArrowRight') changeRound(1);
        });
    }

    function on(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    function segment(containerId, handler) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.addEventListener('click', e => {
            const btn = e.target.closest('button[data-view]');
            if (!btn) return;
            container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            handler(btn.dataset.view);
        });
    }

    /* ---------- 描画 ---------- */

    function render() {
        document.getElementById('current-round').textContent = state.currentRound;
        renderBoard();
        renderConflicts();
        renderHistory();
        renderAdminControls();
        syncSettingsInputs();
    }

    function currentTeams() {
        return D.teamList(state.teams);
    }

    function revealed() {
        return D.isRevealed(state.settings, state.currentRound);
    }

    function renderBoard() {
        const board = document.getElementById('nominations-list');
        const teams = currentTeams();

        if (!teams.length) {
            board.innerHTML = '<div class="empty-state"><div class="big">🃏</div>チームが登録されていません</div>';
            updateProgress(0, 0);
            return;
        }

        const ordered = D.orderedTeams(teams, state.currentRound);
        const round = D.roundData(state.nominations, state.currentRound);
        const conflicts = D.findConflicts(state.nominations, state.currentRound);
        const conflictTeams = new Set();
        conflicts.forEach(c => c.teamIds.forEach(id => conflictTeams.add(id)));

        // 過去の巡ですでに指名済みの選手（再指名チェック）
        const taken = D.takenPlayers(state.nominations, state.settings.totalRounds, { beforeRound: state.currentRound });

        const open = revealed();
        let submitted = 0;

        // 指名中のチーム＝順番が最も早い未指名チーム
        let turnTeamId = null;
        for (const team of ordered) {
            if (!D.isActive(round[team.id])) { turnTeamId = team.id; break; }
        }

        board.innerHTML = '';

        ordered.forEach((team, index) => {
            const nom = round[team.id];
            const active = D.isActive(nom);
            if (active) submitted++;

            const card = document.createElement('div');
            card.className = 'pick-card';
            card.style.setProperty('--team-color', team.color);

            let playerHtml;
            let playerClass = 'pick-player';
            const tags = [];
            const isTurn = open && team.id === turnTeamId;

            if (isTurn) {
                card.classList.add('is-turn');
                tags.push('<span class="tag tag-turn">指名中</span>');
            }

            if (!nom || !nom.playerName) {
                playerHtml = '未指名';
                playerClass += ' is-empty';
            } else if (!open) {
                playerHtml = '● ● ●';
                playerClass += ' is-hidden-pick';
                tags.push('<span class="tag tag-ok">送信済み</span>');
            } else if (D.isLost(nom)) {
                playerHtml = '<s>' + D.esc(nom.playerName) + '</s>';
                tags.push('<span class="tag tag-lost">抽選負け・再指名待ち</span>');
            } else {
                playerHtml = D.esc(nom.playerName);
                if (conflictTeams.has(team.id)) {
                    card.classList.add('is-conflict');
                    tags.push('<span class="tag tag-conflict">重複 → 抽選</span>');
                }
                const dup = taken.get(D.normalizeName(nom.playerName));
                if (dup) {
                    tags.push('<span class="tag tag-dup">' + dup.round + '巡目で指名済み</span>');
                }
                if (nom.attempts && nom.attempts.length) {
                    tags.push('<span class="tag tag-won">再指名</span>');
                }
            }

            card.innerHTML =
                '<div class="pick-team">' +
                '<span class="pick-dot"></span>' +
                '<span>' + D.esc(team.name) + '</span>' +
                '<span class="pick-order">' + (index + 1) + '番手</span>' +
                '</div>' +
                '<div class="' + playerClass + '">' + playerHtml + '</div>' +
                '<div class="pick-tags">' + tags.join('') + '</div>';

            board.appendChild(card);
        });

        updateProgress(submitted, ordered.length);
        renderRevealState(submitted, ordered.length);
    }

    function updateProgress(done, total) {
        document.getElementById('progress-label').textContent = done + ' / ' + total + ' チーム指名済み';
        const pct = total ? (done / total) * 100 : 0;
        document.getElementById('progress-fill').style.width = pct + '%';
    }

    function renderRevealState(submitted, total) {
        const el = document.getElementById('reveal-state');
        if (!state.settings.hidePicks) { el.textContent = ''; return; }
        if (revealed()) {
            el.textContent = '公開済み';
        } else if (submitted >= total && total > 0) {
            el.textContent = '🔒 全チーム送信 — 公開待ち';
        } else {
            el.textContent = '🔒 伏せ中';
        }
    }

    function renderConflicts() {
        const box = document.getElementById('conflict-alert');
        const conflicts = revealed() ? D.findConflicts(state.nominations, state.currentRound) : [];

        if (!conflicts.length) { box.innerHTML = ''; return; }

        const teams = currentTeams();
        const nameOf = id => {
            const t = teams.find(t => t.id === id);
            return t ? t.name : id;
        };

        let html = '<div class="conflict-alert"><h6>⚠ 指名が重複しています — 抽選が必要です</h6>';
        conflicts.forEach(c => {
            html += '<div class="conflict-item">' +
                '<span class="conflict-player">' + D.esc(c.name) + '</span>' +
                '<span class="conflict-teams">' + c.teamIds.map(id => D.esc(nameOf(id))).join(' / ') + '</span>' +
                '<button class="btn2 btn2-gold btn2-sm admin-only no-obs" data-lottery-key="' + D.esc(c.key) + '">🎰 抽選する</button>' +
                '</div>';
        });
        html += '</div>';
        box.innerHTML = html;

        box.querySelectorAll('[data-lottery-key]').forEach(btn => {
            btn.addEventListener('click', () => openLottery(btn.dataset.lotteryKey));
        });
    }

    function renderHistory() {
        const container = document.getElementById('history-container');

        if (historyView === 'matrix') {
            D.renderResultsMatrix(container, state.teams, state.nominations, state.settings.totalRounds);
            return;
        }

        container.className = 'panel-body';
        const teams = currentTeams();
        const rows = [];

        for (let r = 1; r <= state.settings.totalRounds; r++) {
            const round = D.roundData(state.nominations, r);
            const ordered = D.orderedTeams(teams, r);

            // まだ抽選が済んでいない重複（抽選後は勝者だけが残るので消える）
            const contested = new Set(D.findConflicts(state.nominations, r).map(c => c.key));

            ordered.forEach(team => {
                const nom = round[team.id];
                if (!nom || !nom.playerName) return;

                // 抽選負けで再指名した履歴も表示する
                (nom.attempts || []).forEach(att => {
                    rows.push({ round: r, team, player: att.playerName, status: 'lost_lottery' });
                });

                const pending = nom.status !== 'lost_lottery' &&
                    contested.has(D.normalizeName(nom.playerName));
                rows.push({
                    round: r,
                    team,
                    player: nom.playerName,
                    status: pending ? 'contested' : nom.status
                });
            });
        }

        if (!rows.length) {
            container.innerHTML = '<div class="empty-state"><div class="big">📋</div>まだ指名がありません</div>';
            return;
        }

        let body = '';
        rows.forEach(row => {
            const lost = row.status === 'lost_lottery';
            const contested = row.status === 'contested';
            body += '<tr>' +
                '<td class="round-cell">' + row.round + '巡目</td>' +
                '<td class="team-cell"><span class="pick-dot" style="--team-color:' + row.team.color +
                ';display:inline-block;margin-right:7px"></span>' + D.esc(row.team.name) + '</td>' +
                '<td class="player-cell">' + (lost ? '<s>' + D.esc(row.player) + '</s>' : D.esc(row.player)) + '</td>' +
                '<td>' + (lost ? '<span class="tag tag-lost">抽選負け</span>'
                    : contested ? '<span class="tag tag-conflict">重複 — 抽選待ち</span>'
                        : '<span class="tag tag-won">確定</span>') + '</td>' +
                '</tr>';
        });

        container.innerHTML =
            '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
            '<th>巡目</th><th>チーム</th><th>指名選手</th><th>状態</th>' +
            '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    function renderAdminControls() {
        const teams = currentTeams();
        const round = D.roundData(state.nominations, state.currentRound);

        const lostBox = document.getElementById('lost-teams-checkboxes');
        lostBox.innerHTML = '';
        teams.forEach(team => {
            const label = document.createElement('label');
            label.className = 'check';
            label.innerHTML =
                '<input type="checkbox" name="lostTeams" value="' + D.esc(team.id) + '">' +
                '<span>' + D.esc(team.name) + '</span>';
            lostBox.appendChild(label);
        });

        const undoBox = document.getElementById('undo-buttons');
        undoBox.innerHTML = '';
        teams.forEach(team => {
            const nom = round[team.id];
            const btn = document.createElement('button');
            btn.className = 'btn2 btn2-sm';
            btn.disabled = !nom || !nom.playerName;
            btn.textContent = D.esc(team.name) + (nom && nom.playerName ? '：' + nom.playerName + ' を取消' : '：指名なし');
            btn.addEventListener('click', () => undoNomination(team));
            undoBox.appendChild(btn);
        });
    }

    function syncSettingsInputs() {
        const hideChk = document.getElementById('chk-hide-picks');
        if (document.activeElement !== hideChk) hideChk.checked = state.settings.hidePicks;

        const roundsInput = document.getElementById('input-total-rounds');
        if (document.activeElement !== roundsInput) roundsInput.value = state.settings.totalRounds;
    }

    /* ---------- 操作 ---------- */

    function changeRound(delta) {
        let next = state.currentRound + delta;
        if (next < 1) next = 1;
        if (next > state.settings.totalRounds) next = state.settings.totalRounds;
        if (next === state.currentRound) return;
        db.ref('draft/currentRound').set(next)
            .catch(err => D.toast('巡目を変更できませんでした: ' + err.message, 'danger'));
    }

    function toggleAdmin(force) {
        const panel = document.getElementById('admin-panel');
        const show = (force === undefined) ? panel.classList.contains('hide') : force;
        panel.classList.toggle('hide', !show);
        if (show) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function setLostTeams() {
        const checked = Array.from(document.querySelectorAll('input[name="lostTeams"]:checked'));
        if (!checked.length) {
            D.toast('抽選に負けたチームを選択してください', 'danger');
            return;
        }

        const updates = {};
        checked.forEach(cb => {
            updates['draft/nominations/round' + state.currentRound + '/' + cb.value + '/status'] = 'lost_lottery';
        });

        db.ref().update(updates)
            .then(() => {
                D.toast(checked.length + 'チームに再指名権を付与しました', 'success');
                checked.forEach(cb => { cb.checked = false; });
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    function undoNomination(team) {
        const round = D.roundData(state.nominations, state.currentRound);
        const nom = round[team.id];
        if (!nom) return;
        if (!confirm(team.name + 'の指名「' + nom.playerName + '」を取り消します。よろしいですか？')) return;

        db.ref('draft/nominations/round' + state.currentRound + '/' + team.id).remove()
            .then(() => D.toast('指名を取り消しました', 'success'))
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    function setRevealed(value) {
        db.ref('draft/settings/revealed/round' + state.currentRound).set(value)
            .then(() => D.toast(value ? '第' + state.currentRound + '巡目を公開しました' : '公開を取り消しました', value ? 'success' : 'info'))
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    function saveTotalRounds() {
        const value = parseInt(document.getElementById('input-total-rounds').value, 10);
        if (!value || value < 1 || value > 12) {
            D.toast('総巡目数は1〜12で指定してください', 'danger');
            return;
        }
        db.ref('draft/settings/totalRounds').set(value)
            .then(() => D.toast('総巡目数を' + value + '巡に設定しました', 'success'))
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    function resetDraft() {
        if (!confirm('本当にドラフトをリセットしますか？\n全チームの指名がすべて削除されます。\nこの操作は取り消せません。')) return;
        if (!confirm('確認：本当に全指名を削除します。よろしいですか？')) return;

        db.ref().update({
            'draft/nominations': null,
            'draft/currentRound': 1,
            'draft/lottery': null,
            'draft/settings/revealed': null
        })
            .then(() => D.toast('ドラフトをリセットしました', 'success'))
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    /* ---------- 監督（チーム）の管理 ---------- */

    function openTeamsModal() {
        teamDraft = currentTeams().map(team => ({ id: team.id, name: team.name }));
        renderTeamEditor();
        new bootstrap.Modal(document.getElementById('teamsModal')).show();
    }

    function nextTeamId() {
        let max = 0;
        const check = id => {
            const n = parseInt(String(id).replace(/\D/g, ''), 10);
            if (n && n > max) max = n;
        };
        Object.keys(state.teams).forEach(check);
        (teamDraft || []).forEach(t => check(t.id));
        return 'team' + (max + 1);
    }

    function addTeamRow() {
        if (!teamDraft) return;
        teamDraft.push({ id: nextTeamId(), name: '' });
        renderTeamEditor();
        const inputs = document.querySelectorAll('#team-editor .team-row input');
        if (inputs.length) inputs[inputs.length - 1].focus();
    }

    function renderTeamEditor() {
        const box = document.getElementById('team-editor');
        box.innerHTML = '';

        if (!teamDraft.length) {
            box.innerHTML = '<p class="muted">監督が登録されていません。「＋ 監督を追加」から追加してください。</p>';
            renderTeamUrls();
            return;
        }

        teamDraft.forEach((team, index) => {
            const picks = countPicks(team.id);
            const row = document.createElement('div');
            row.className = 'team-row';
            row.style.setProperty('--team-color', D.teamColor(team.id));

            row.innerHTML =
                '<span class="team-row-order">' + (index + 1) + '</span>' +
                '<span class="pick-dot"></span>' +
                '<input type="text" class="input" value="' + D.esc(team.name) + '" placeholder="監督名 / チーム名" maxlength="30">' +
                '<span class="team-row-meta">' + (picks ? picks + '指名' : '未指名') + '</span>' +
                '<button type="button" class="btn2 btn2-sm" data-act="up" title="上へ"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
                '<button type="button" class="btn2 btn2-sm" data-act="down" title="下へ"' + (index === teamDraft.length - 1 ? ' disabled' : '') + '>↓</button>' +
                '<button type="button" class="btn2 btn2-sm" data-act="link" title="指名シートのURLをコピー">🔗</button>' +
                '<button type="button" class="btn2 btn2-sm btn2-danger" data-act="remove" title="削除">✕</button>';

            row.querySelector('input').addEventListener('input', e => { team.name = e.target.value; });

            row.querySelector('input').addEventListener('input', renderTeamUrls);

            row.querySelectorAll('button[data-act]').forEach(btn => {
                btn.addEventListener('click', () => handleTeamRowAction(btn.dataset.act, index));
            });

            box.appendChild(row);
        });

        renderTeamUrls();
    }

    function teamSheetUrl(teamId) {
        const base = location.origin + location.pathname.replace(/[^/]*$/, '');
        return base + 'team-sheet.html?team=' + encodeURIComponent(teamId);
    }

    function teamUrlsText() {
        return (teamDraft || [])
            .map(team => (team.name.trim() || '（名前未設定）') + '\n' + teamSheetUrl(team.id))
            .join('\n\n');
    }

    function renderTeamUrls() {
        const box = document.getElementById('team-urls');
        if (box) box.value = teamUrlsText();
    }

    function copyAllTeamSheetUrls() {
        const text = teamUrlsText();
        if (!text) {
            D.toast('監督が登録されていません', 'danger');
            return;
        }

        const box = document.getElementById('team-urls');
        const done = () => D.toast('URL一覧をコピーしました', 'success');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => { box.select(); });
        } else {
            box.select();
        }
    }

    function handleTeamRowAction(action, index) {
        const team = teamDraft[index];

        if (action === 'up' && index > 0) {
            teamDraft.splice(index - 1, 0, teamDraft.splice(index, 1)[0]);
        } else if (action === 'down' && index < teamDraft.length - 1) {
            teamDraft.splice(index + 1, 0, teamDraft.splice(index, 1)[0]);
        } else if (action === 'link') {
            copyTeamSheetUrl(team);
            return;
        } else if (action === 'remove') {
            const picks = countPicks(team.id);
            const label = team.name || '（名前未設定）';
            const message = picks
                ? label + ' を削除します。\nこの監督の指名 ' + picks + '件 も一緒に削除されます。よろしいですか？'
                : label + ' を削除します。よろしいですか？';
            if (!confirm(message)) return;
            teamDraft.splice(index, 1);
        }

        renderTeamEditor();
    }

    function countPicks(teamId) {
        let count = 0;
        for (let r = 1; r <= state.settings.totalRounds; r++) {
            const nom = D.roundData(state.nominations, r)[teamId];
            if (nom && nom.playerName) count++;
        }
        return count;
    }

    function copyTeamSheetUrl(team) {
        const url = teamSheetUrl(team.id);
        const done = () => D.toast((team.name || team.id) + ' のURLをコピーしました', 'success');
        const fail = () => window.prompt('コピーできませんでした。以下のURLを使ってください', url);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done).catch(fail);
        } else {
            fail();
        }
    }

    function saveTeams() {
        if (!teamDraft) return;

        const names = teamDraft.map(t => t.name.trim());

        if (names.some(name => !name)) {
            D.toast('名前が空の監督があります', 'danger');
            return;
        }
        if (new Set(names).size !== names.length) {
            D.toast('同じ名前の監督が複数います', 'danger');
            return;
        }

        // 削除された監督の指名データも取り除く
        const keptIds = new Set(teamDraft.map(t => t.id));
        const removedIds = Object.keys(state.teams).filter(id => !keptIds.has(id));

        const teamsObj = {};
        teamDraft.forEach((team, index) => {
            teamsObj[team.id] = { id: team.id, name: names[index], order: index + 1 };
        });

        const updates = { 'draft/teams': teamsObj };
        removedIds.forEach(id => {
            for (let r = 1; r <= state.settings.totalRounds; r++) {
                updates['draft/nominations/round' + r + '/' + id] = null;
            }
        });

        db.ref().update(updates)
            .then(() => {
                D.toast('監督' + teamDraft.length + '名を保存しました', 'success');
                bootstrap.Modal.getInstance(document.getElementById('teamsModal')).hide();
                teamDraft = null;
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    /* ---------- 選手リスト ---------- */

    function openPlayersModal() {
        playerDraft = D.playerPool({ players: state.players });
        document.getElementById('player-add-input').value = '';
        document.getElementById('bulk-block').classList.add('hide');
        renderPlayerEditor();
        new bootstrap.Modal(document.getElementById('playersModal')).show();
    }

    function renderPlayerEditor() {
        const box = document.getElementById('players-chips');
        document.getElementById('players-count').textContent = playerDraft.length + '名';
        box.innerHTML = '';

        if (!playerDraft.length) {
            box.innerHTML = '<p class="pool-empty">選手が登録されていません。上の入力欄から追加してください。</p>';
            return;
        }

        playerDraft.forEach((name, index) => {
            const chip = document.createElement('span');
            chip.className = 'pool-chip player-chip';
            chip.innerHTML = D.esc(name) +
                '<button type="button" class="chip-remove" title="削除">✕</button>';
            chip.querySelector('.chip-remove').addEventListener('click', () => {
                playerDraft.splice(index, 1);
                renderPlayerEditor();
            });
            box.appendChild(chip);
        });
    }

    function addPlayer() {
        const input = document.getElementById('player-add-input');
        const name = input.value.trim();
        if (!name) return;

        if (playerDraft.some(p => D.normalizeName(p) === D.normalizeName(name))) {
            D.toast('「' + name + '」はすでに登録されています', 'danger');
            return;
        }

        playerDraft.push(name);
        input.value = '';
        input.focus();
        renderPlayerEditor();
    }

    function bulkVisible() {
        return !document.getElementById('bulk-block').classList.contains('hide');
    }

    function toggleBulk() {
        const block = document.getElementById('bulk-block');
        const show = block.classList.contains('hide');
        block.classList.toggle('hide', !show);
        if (show) {
            document.getElementById('players-textarea').value = playerDraft.join('\n');
            document.getElementById('players-textarea').focus();
        }
    }

    // テキスト欄の内容を playerDraft に取り込む（重複は除外）
    function syncFromBulk() {
        const names = document.getElementById('players-textarea').value
            .split('\n').map(s => s.trim()).filter(Boolean);

        const seen = new Set();
        playerDraft = names.filter(name => {
            const key = D.normalizeName(name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return names.length - playerDraft.length;
    }

    function applyBulk() {
        const dropped = syncFromBulk();
        renderPlayerEditor();
        document.getElementById('bulk-block').classList.add('hide');
        D.toast('リストに反映しました（' + playerDraft.length + '名' +
            (dropped ? ' / 重複' + dropped + '件を除外' : '') + '）', 'success');
    }

    function savePlayers() {
        // 貼り付け欄が開いたままでも、その内容を取りこぼさない
        if (bulkVisible()) syncFromBulk();

        const value = playerDraft.join('\n');

        db.ref('draft/players').set(value)
            .then(() => {
                D.toast('選手リストを保存しました（' + playerDraft.length + '名）', 'success');
                bootstrap.Modal.getInstance(document.getElementById('playersModal')).hide();
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    /* ---------- 抽選 ---------- */

    function openLottery(key) {
        const conflicts = D.findConflicts(state.nominations, state.currentRound);
        const target = conflicts.find(c => c.key === key);
        if (!target) return;

        const teams = currentTeams();
        lotteryCtx = {
            player: target.name,
            key: target.key,
            teams: target.teamIds.map(id => teams.find(t => t.id === id) || { id, name: id }),
            winner: null
        };

        document.getElementById('lottery-player').textContent = target.name;
        document.getElementById('showdown').innerHTML = '';
        document.getElementById('showdown-banner').className = 'showdown-banner';
        document.getElementById('showdown-banner').textContent = '';
        document.getElementById('lottery-note').textContent =
            lotteryCtx.teams.map(t => t.name).join(' / ') + ' の ' + lotteryCtx.teams.length + 'チームでポーカー勝負';
        document.getElementById('btn-spin').disabled = false;
        document.getElementById('btn-apply-lottery').disabled = true;

        new bootstrap.Modal(document.getElementById('lotteryModal')).show();
    }

    /* ---------- ポーカー勝負の演出 ---------- */

    const wait = ms => new Promise(r => setTimeout(r, ms));

    function spinLottery() {
        if (!lotteryCtx || lotteryCtx.running) return;
        lotteryCtx.running = true;
        Showdown.sfx.unlock();
        runShowdown().catch(err => {
            console.error(err);
            lotteryCtx.running = false;
        });
    }

    async function runShowdown() {
        const board = document.getElementById('showdown');
        const banner = document.getElementById('showdown-banner');
        const note = document.getElementById('lottery-note');
        const spinBtn = document.getElementById('btn-spin');
        const applyBtn = document.getElementById('btn-apply-lottery');
        const stage = document.querySelector('#lotteryModal .lottery-stage');

        spinBtn.disabled = true;
        applyBtn.disabled = true;
        banner.className = 'showdown-banner';
        banner.textContent = '';
        stage.classList.remove('is-flash');

        const packet = Showdown.deal(lotteryCtx.teams, { dramaChance: 0.35 });
        lotteryCtx.winner = packet.winner;
        lotteryCtx.packet = packet;

        // --- 配牌 ---
        board.innerHTML = '';
        packet.hands.forEach(hand => {
            const row = document.createElement('div');
            row.className = 'sd-row is-dealing';
            row.dataset.teamId = hand.team.id;
            row.style.setProperty('--team-color', D.teamColor(hand.team.id));
            row.innerHTML =
                '<div class="sd-team"><span class="pick-dot"></span>' + D.esc(hand.team.name) + '</div>' +
                '<div class="sd-cards">' + hand.cards.map(() => '<span class="pcard is-back"></span>').join('') + '</div>' +
                '<div class="sd-hand"></div>';
            board.appendChild(row);
        });

        const rows = Array.from(board.querySelectorAll('.sd-row'));
        note.textContent = 'カードを配ります…';

        for (let i = 0; i < rows.length; i++) {
            rows[i].classList.remove('is-dealing');
            Showdown.sfx.deal();
            await wait(220);
        }
        await wait(500);

        // --- 1〜4枚目 ---
        // 演出上の「仮の勝者」。待ったがある場合は本当の勝者ではない
        const stageWinner = packet.objection && packet.provisional ? packet.provisional : packet.winner;
        const openIdx = packet.hands.map((h, n) => n);

        for (let step = 1; step <= 4; step++) {
            for (const i of openIdx) {
                const slot = rows[i].querySelectorAll('.pcard')[step - 1];
                slot.outerHTML = Showdown.cardHtml(packet.hands[i].cards[step - 1]);
                Showdown.sfx.flip();
                await wait(140);
            }
            updateStandings(rows, packet, step, openIdx);
            note.textContent = step + ' 枚目';
            await wait(step === 4 ? 300 : 620);
        }

        // --- リーチ ---
        Showdown.sfx.tense();
        banner.className = 'showdown-banner is-tense';
        const leadNames = Showdown.leadersAt(openIdx.map(i => packet.hands[i]), 4).map(t => t.name);
        banner.textContent = '👑 ' + leadNames.join(' / ') + ' がリード';
        note.textContent = 'このまま決まるか…？';
        await wait(1800);

        // --- 運命の5枚目 ---
        banner.className = 'showdown-banner is-countdown';
        banner.textContent = '運命の5枚目';
        note.textContent = '';
        await wait(900);

        for (let n = 3; n >= 1; n--) {
            banner.className = 'showdown-banner is-countdown';
            banner.textContent = String(n);
            Showdown.sfx.countdown(4 - n);
            await wait(620);
        }
        banner.textContent = 'オープン！';
        await wait(400);

        // 勝者を最後に残してめくる
        const order = openIdx
            .map(index => ({ hand: packet.hands[index], index }))
            .sort((a, b) => (a.hand.team.id === stageWinner.id ? 1 : 0) - (b.hand.team.id === stageWinner.id ? 1 : 0));

        for (const item of order) {
            const row = rows[item.index];
            const slot = row.querySelectorAll('.pcard')[4];
            const beforeCat = Showdown.evaluatePartial(item.hand.cards.slice(0, 4)).category;

            row.classList.add('is-opening');
            await wait(360);
            slot.outerHTML = Showdown.cardHtml(item.hand.cards[4]);
            row.classList.remove('is-opening');

            const result = item.hand.result;
            row.querySelector('.sd-hand').textContent = result.name;

            if (result.category > beforeCat) {
                row.classList.add('is-hit');
                Showdown.sfx.made();
                setTimeout(() => row.classList.remove('is-hit'), 700);
            } else {
                Showdown.sfx.flip();
            }
            await wait(item === order[order.length - 1] ? 260 : 780);
        }

        // --- ちょっとまったー！ ---
        if (packet.objection) {
            const provIndex = packet.hands.findIndex(
                h => packet.provisional && h.team.id === packet.provisional.id);
            const provRow = provIndex >= 0 ? rows[provIndex] : null;

            // いったん仮の勝者で決着させる
            rows.forEach(r => r.classList.remove('is-leading'));
            if (provRow) provRow.classList.add('is-winner');
            banner.className = 'showdown-banner is-win';
            banner.textContent = '🏆 ' + (packet.provisional ? packet.provisional.name : '') + ' の勝ち';
            note.textContent = '…で、決まりかと思われた';
            Showdown.sfx.win();
            await wait(2000);

            // 待った
            stage.classList.add('is-objection');
            banner.className = 'showdown-banner is-objection';
            banner.textContent = '✋ ちょっとまったー！！';
            note.textContent = '';
            Showdown.sfx.objection();
            if (provRow) provRow.classList.remove('is-winner');
            await wait(1500);

            const winIndex = packet.hands.findIndex(h => h.team.id === packet.winner.id);
            const winRow = rows[winIndex];
            const winHand = packet.hands[winIndex];

            winRow.classList.add('is-objector');
            banner.textContent = '✋ ちょっとまったー！！　' + packet.winner.name;
            note.textContent = 'まだ終わっていないらしい';
            await wait(1200);

            // 出していた札を引っ込めて、別の札を叩きつける
            const holder = winRow.querySelector('.sd-cards');
            holder.classList.add('is-sweeping');
            Showdown.sfx.slam(0);
            await wait(520);
            holder.classList.remove('is-sweeping');
            holder.innerHTML = '';
            winRow.querySelector('.sd-hand').textContent = '';
            await wait(280);

            for (let i = 0; i < winHand.finisher.cards.length; i++) {
                const el = document.createElement('span');
                el.innerHTML = Showdown.cardHtml(winHand.finisher.cards[i]);
                const cardEl = el.firstChild;
                cardEl.classList.add('is-slammed');
                holder.appendChild(cardEl);
                Showdown.sfx.slam(i);
                await wait(230);
            }

            winRow.querySelector('.sd-hand').textContent = winHand.finisher.label;
            winRow.classList.add('is-hit');
            await wait(700);

            rows.forEach((r, i) => {
                r.classList.remove('is-winner');
                if (i === winIndex) r.classList.add('is-winner');
                else r.classList.add('is-out');
            });
            stage.classList.remove('is-objection');
            stage.classList.add('is-flash');
            setTimeout(() => stage.classList.remove('is-flash'), 500);

            banner.className = 'showdown-banner is-comeback';
            banner.textContent = '💥 ' + winHand.finisher.label + '！ ' + packet.winner.name;
            note.textContent = winHand.finisher.tagline + '  —  ' + packet.winner.name + ' が交渉権を獲得';
            Showdown.sfx.comeback();
            Showdown.confetti(stage, 3200);

            applyBtn.disabled = false;
            spinBtn.disabled = false;
            spinBtn.textContent = '配り直す';
            lotteryCtx.running = false;
            return;
        }

        // --- 決着 ---
        rows.forEach(r => r.classList.remove('is-leading'));
        const winnerIndex = packet.hands.findIndex(h => h.team.id === packet.winner.id);
        const winnerHand = packet.hands[winnerIndex];

        rows.forEach((r, i) => {
            if (i === winnerIndex) r.classList.add('is-winner');
            else r.classList.add('is-out');
        });

        stage.classList.add('is-flash');
        setTimeout(() => stage.classList.remove('is-flash'), 500);

        if (packet.comeback.isComeback) {
            banner.className = 'showdown-banner is-comeback';
            banner.textContent = '⚡ 大逆転！！ ' + packet.winner.name + '！';
            Showdown.sfx.comeback();
        } else {
            banner.className = 'showdown-banner is-win';
            banner.textContent = '🏆 ' + packet.winner.name + ' 逃げ切り！';
            Showdown.sfx.win();
        }

        Showdown.confetti(stage, 2800);

        const flavor = Showdown.flavorFor(winnerHand.result);
        note.textContent = winnerHand.result.name + ' で ' + packet.winner.name + ' が交渉権を獲得' +
            (flavor ? '  —  ' + flavor : '');

        applyBtn.disabled = false;
        spinBtn.disabled = false;
        spinBtn.textContent = '配り直す';
        lotteryCtx.running = false;
    }

    // 途中経過の役とリード表示を更新する
    function updateStandings(rows, packet, shown, openIdx) {
        const targets = openIdx || packet.hands.map((h, n) => n);
        const open = targets.map(n => packet.hands[n]);
        const leaderIds = Showdown.leadersAt(open, shown).map(t => t.id);
        open.forEach(hand => {
            const i = packet.hands.indexOf(hand);
            const row = rows[i];
            row.classList.toggle('is-leading', leaderIds.indexOf(hand.team.id) !== -1);
            const partial = Showdown.evaluatePartial(hand.cards.slice(0, shown));
            row.querySelector('.sd-hand').textContent = partial.category > 0 ? partial.name : '';
        });
    }

    function applyLottery() {
        if (!lotteryCtx || !lotteryCtx.winner) return;

        const updates = {};
        const losers = [];

        lotteryCtx.teams.forEach(team => {
            if (team.id === lotteryCtx.winner.id) return;
            losers.push(team.name);
            updates['draft/nominations/round' + state.currentRound + '/' + team.id + '/status'] = 'lost_lottery';
        });

        updates['draft/lottery/round' + state.currentRound + '/' + safeKey(lotteryCtx.key)] = {
            playerName: lotteryCtx.player,
            winnerTeamId: lotteryCtx.winner.id,
            winnerTeamName: lotteryCtx.winner.name,
            loserTeamNames: losers,
            timestamp: Date.now()
        };

        db.ref().update(updates)
            .then(() => {
                D.toast(lotteryCtx.winner.name + 'が獲得。他' + losers.length + 'チームは再指名です', 'success', 5000);
                bootstrap.Modal.getInstance(document.getElementById('lotteryModal')).hide();
                document.getElementById('btn-spin').textContent = '勝負！';
                lotteryCtx = null;
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    // Firebase のキーに使えない文字を置換
    function safeKey(key) {
        return String(key).replace(/[.#$/[\]]/g, '_').slice(0, 60) || 'player';
    }

    /* ---------- 結果一覧 ---------- */

    function showResults() {
        renderResults();
        new bootstrap.Modal(document.getElementById('resultsModal')).show();
    }

    function renderResults() {
        const container = document.getElementById('results-container');
        if (resultsView === 'matrix') {
            D.renderResultsMatrix(container, state.teams, state.nominations, state.settings.totalRounds);
        } else {
            D.renderResultsGrid(container, state.teams, state.nominations, state.settings.totalRounds);
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
