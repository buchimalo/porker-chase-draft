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
            ordered.forEach(team => {
                const nom = round[team.id];
                if (!nom || !nom.playerName) return;

                // 抽選負けで再指名した履歴も表示する
                (nom.attempts || []).forEach(att => {
                    rows.push({ round: r, team, player: att.playerName, status: 'lost_lottery' });
                });
                rows.push({ round: r, team, player: nom.playerName, status: nom.status });
            });
        }

        if (!rows.length) {
            container.innerHTML = '<div class="empty-state"><div class="big">📋</div>まだ指名がありません</div>';
            return;
        }

        let body = '';
        rows.forEach(row => {
            const lost = row.status === 'lost_lottery';
            body += '<tr>' +
                '<td class="round-cell">' + row.round + '巡目</td>' +
                '<td class="team-cell"><span class="pick-dot" style="--team-color:' + row.team.color +
                ';display:inline-block;margin-right:7px"></span>' + D.esc(row.team.name) + '</td>' +
                '<td class="player-cell">' + (lost ? '<s>' + D.esc(row.player) + '</s>' : D.esc(row.player)) + '</td>' +
                '<td>' + (lost ? '<span class="tag tag-lost">抽選負け</span>' : '<span class="tag tag-won">確定</span>') + '</td>' +
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
        document.getElementById('players-textarea').value = state.players || '';
        new bootstrap.Modal(document.getElementById('playersModal')).show();
    }

    function savePlayers() {
        const value = document.getElementById('players-textarea').value
            .split('\n').map(s => s.trim()).filter(Boolean).join('\n');

        db.ref('draft/players').set(value)
            .then(() => {
                D.toast('選手リストを保存しました（' + (value ? value.split('\n').length : 0) + '名）', 'success');
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
        document.getElementById('lottery-name').textContent = 'READY';
        document.getElementById('lottery-note').textContent =
            lotteryCtx.teams.map(t => t.name).join(' / ') + ' の ' + lotteryCtx.teams.length + 'チームで抽選';
        document.getElementById('lottery-reel').className = 'lottery-reel';
        document.getElementById('btn-spin').disabled = false;
        document.getElementById('btn-apply-lottery').disabled = true;

        new bootstrap.Modal(document.getElementById('lotteryModal')).show();
    }

    function spinLottery() {
        if (!lotteryCtx) return;

        const reel = document.getElementById('lottery-reel');
        const nameEl = document.getElementById('lottery-name');
        const spinBtn = document.getElementById('btn-spin');
        const names = lotteryCtx.teams.map(t => t.name);

        spinBtn.disabled = true;
        reel.className = 'lottery-reel spinning';
        document.getElementById('lottery-note').textContent = '抽選中…';

        const winnerIndex = Math.floor(Math.random() * lotteryCtx.teams.length);
        lotteryCtx.winner = lotteryCtx.teams[winnerIndex];

        let tick = 0;
        let delay = 55;
        const total = 26 + Math.floor(Math.random() * 8);

        (function step() {
            nameEl.textContent = names[tick % names.length];
            tick++;
            if (tick < total) {
                // 終盤は減速させる
                if (tick > total - 8) delay += 45;
                setTimeout(step, delay);
            } else {
                reel.className = 'lottery-reel won';
                nameEl.textContent = lotteryCtx.winner.name;
                document.getElementById('lottery-note').textContent =
                    '🎉 ' + lotteryCtx.winner.name + ' が交渉権を獲得しました';
                document.getElementById('btn-apply-lottery').disabled = false;
                spinBtn.disabled = false;
                spinBtn.textContent = 'もう一度回す';
            }
        })();
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
                document.getElementById('btn-spin').textContent = '抽選スタート';
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
