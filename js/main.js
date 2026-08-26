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
        players: '',
        roulette: '',
        lottery: {},
        rouletteLog: {}
    };

    let historyView = 'list';
    let resultsView = 'grid';
    let lotteryCtx = null;  // { player, key, teamIds, winner }
    let teamDraft = null;   // チーム編集モーダルの作業用コピー
    let playerDraft = [];   // 選手リスト編集モーダルの作業用コピー
    let rouletteDraft = []; // ルーレット対象編集モーダルの作業用コピー
    let rouletteCtx = null; // { teamId, teamName, items, winnerIndex }

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
            state.roulette = data.roulette || '';
            state.lottery = data.lottery || {};
            state.rouletteLog = data.rouletteLog || {};
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
        on('btn-download-text', downloadResults);
        on('btn-show-player-list', showPlayerList);
        on('btn-toggle-admin', () => toggleAdmin());
        on('btn-close-admin', () => toggleAdmin(false));
        on('btn-set-lost', setLostTeams);
        on('btn-reset', resetDraft);
        on('btn-edit-players', openPlayersModal);
        on('btn-edit-roulette', openRouletteEditor);
        on('btn-roulette-add', addRouletteName);
        on('btn-save-roulette', saveRoulettePool);
        on('btn-roulette-spin', runRoulette);
        on('btn-roulette-apply', applyRoulette);
        on('btn-save-players', savePlayers);
        on('btn-edit-teams', openTeamsModal);
        on('btn-add-team', addTeamRow);
        on('btn-save-teams', saveTeams);
        on('btn-copy-urls', copyAllTeamSheetUrls);

        // 抽選を途中で閉じたらドラムロールも止める
        const lotteryModal = document.getElementById('lotteryModal');
        if (lotteryModal) {
            lotteryModal.addEventListener('hide.bs.modal', () => {
                if (window.Showdown && Showdown.sfx.drumrollAbort) Showdown.sfx.drumrollAbort();
            });
        }
        on('btn-add-player', addPlayer);
        on('btn-add-roulette-slot', addRouletteSlot);
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
        on('btn-force-next', forceNextRound);
        on('btn-spin', spinLottery);
        on('btn-apply-lottery', applyLottery);

        const hideChk = document.getElementById('chk-hide-picks');
        hideChk.addEventListener('change', () => {
            db.ref('draft/settings/hidePicks').set(hideChk.checked)
                .then(() => D.toast(hideChk.checked ? '伏せモードを有効にしました' : '伏せモードを解除しました', 'info'))
                .catch(err => D.toast('保存に失敗しました: ' + err.message, 'danger'));
        });

        segment('history-view-toggle', v => { historyView = v; renderHistory(); });
        segment('player-list-filter', v => { playerListFilter = v; renderPlayerList(); });

        document.getElementById('player-list-search').addEventListener('input', e => {
            playerListSearch = D.normalizeName(e.target.value);
            renderPlayerList();
        });
        segment('results-view-toggle', v => { resultsView = v; renderResults(); });

        // キーボードショートカット（配信オペ用）
        document.addEventListener('keydown', e => {
            if (!D.isAdmin()) return;
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
        renderRoulettePending();
        renderHistory();
        renderAdminControls();
        syncSettingsInputs();
        syncAdvanceButton();
        // 選手一覧を開いたままでも最新状態に追従させる
        const plModal = document.getElementById('playerListModal');
        if (plModal && plModal.classList.contains('show')) renderPlayerList();
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
            board.innerHTML = '<div class="empty-state"><div class="big">—</div>チームが登録されていません</div>';
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
            } else if (D.isTentative(nom)) {
                // 仮出し。まだ確定していないので抽選や進行の判定には入れない
                playerHtml = D.esc(nom.playerName);
                playerClass += ' is-tentative';
                tags.push('<span class="tag tag-tentative">仮</span>');
            } else if (D.isRouletteWaiting(nom)) {
                // ルーレット待ち。回すまで誰を獲るか決まっていない
                playerHtml = 'ルーレット';
                playerClass += ' is-roulette';
                if (conflictTeams.has(team.id)) {
                    // 他チームもルーレットを選んだ場合はポーカー抽選で決める
                    card.classList.add('is-conflict');
                    tags.push('<span class="tag tag-conflict">重複 → ポーカー抽選</span>');
                } else {
                    tags.push('<span class="tag tag-roulette">回転待ち</span>');
                }
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
                if (D.isRoulette(nom)) {
                    tags.push('<span class="tag tag-roulette">ルーレット獲得</span>');
                }
                if (nom.attempts && nom.attempts.length) {
                    tags.push('<span class="tag tag-won">再指名</span>');
                }
            }

            // 指名順は 01, 02 … のゼロ埋め。背面にも大きく敷く
            const orderLabel = ('0' + (index + 1)).slice(-2);

            card.innerHTML =
                '<span class="pick-ghost">' + orderLabel + '</span>' +
                '<div class="pick-team">' +
                D.avatarHtml(team) +
                '<span class="pick-name">' + D.esc(team.name) + '</span>' +
                '<span class="pick-order">' + orderLabel + '</span>' +
                '</div>' +
                '<div class="' + playerClass + '">' + playerHtml + '</div>' +
                '<div class="pick-tags">' + tags.join('') + '</div>';

            board.appendChild(card);
        });

        // 3列で余ったマスに進捗サマリーを入れる
        const cols = 3;
        const spare = (cols - (ordered.length % cols)) % cols;
        if (spare > 0) {
            const pool = D.playerPool({ players: state.players });
            const taken = D.takenPlayers(state.nominations, state.settings.totalRounds);
            const freeCount = pool.filter(p => !taken.has(D.normalizeName(p))).length;

            const summary = document.createElement('div');
            summary.className = 'pick-summary';
            summary.style.gridColumn = 'span ' + spare;

            let html =
                '<div class="ps-row"><span class="ps-label">ROUND</span>' +
                '<span class="ps-value">' + state.currentRound + ' / ' + state.settings.totalRounds + '</span></div>' +
                '<div class="ps-row"><span class="ps-label">この巡の指名</span>' +
                '<span class="ps-value">' + submitted + ' / ' + ordered.length + '</span></div>';

            if (pool.length) {
                html += '<div class="ps-row"><span class="ps-label">残り選手</span>' +
                    '<span class="ps-value">' + freeCount + ' / ' + pool.length + '</span></div>';
            }
            if (conflicts.length) {
                html += '<div class="ps-row"><span class="ps-label">抽選待ち</span>' +
                    '<span class="ps-value is-alert">' + conflicts.length + '</span></div>';
            } else if (submitted >= ordered.length && ordered.length) {
                html += '<div class="ps-row"><span class="ps-label">状態</span>' +
                    '<span class="ps-value is-accent">全員完了</span></div>';
            }

            summary.innerHTML = html;
            board.appendChild(summary);
        }

        markAllIn(submitted, ordered.length);
        updateProgress(submitted, ordered.length);
        renderRevealState(submitted, ordered.length);
    }

    // 全チームが確定した時点でその巡を記録する。以後は取り消しがあってもロックが外れない
    function markAllIn(done, total) {
        if (!total || done < total) return;
        if (!D.isAdmin()) return;
        const key = 'round' + state.currentRound;
        if (D.isAllIn(state.settings, state.currentRound)) return;
        db.ref('draft/settings/allIn/' + key).set(true).catch(() => { /* 無視 */ });
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

        let html = '<div class="conflict-alert"><h6>指名が重複しています — 抽選が必要です</h6>';
        conflicts.forEach(c => {
            html += '<div class="conflict-item">' +
                '<span class="conflict-player">' + D.esc(c.name) + '</span>' +
                '<span class="conflict-teams">' + c.teamIds.map(id => D.esc(nameOf(id))).join(' / ') + '</span>' +
                '<button class="btn2 btn2-gold btn2-sm admin-only no-obs" data-lottery-key="' + D.esc(c.key) + '">抽選する</button>' +
                '</div>';
        });
        html += '</div>';
        box.innerHTML = html;

        box.querySelectorAll('[data-lottery-key]').forEach(btn => {
            btn.addEventListener('click', () => openLottery(btn.dataset.lotteryKey));
        });
    }

    /* ---------- ルーレット抽選 ---------- */

    // core の関数に渡すための draft 相当のオブジェクト
    function draftSnapshot() {
        return {
            nominations: state.nominations,
            players: state.players,
            roulette: state.roulette,
            settings: {
                totalRounds: state.settings.totalRounds,
                hidePicks: state.settings.hidePicks,
                revealed: state.settings.revealed
            }
        };
    }

    // この巡でまだ回していないルーレット指名
    function pendingRoulettes() {
        if (!revealed()) return [];
        const round = D.roundData(state.nominations, state.currentRound);

        // ルーレットが複数チームで被っている間は、先にポーカー抽選で1チームに絞る
        const contested = new Set();
        D.findConflicts(state.nominations, state.currentRound).forEach(c => {
            c.teamIds.forEach(id => contested.add(id));
        });

        return currentTeams()
            .filter(t => D.isRouletteWaiting(round[t.id]) && !contested.has(t.id))
            .map(t => ({ team: t, nom: round[t.id] }));
    }

    function rouletteItems() {
        return D.rouletteAvailable(draftSnapshot(), state.currentRound);
    }

    function renderRoulettePending() {
        const box = document.getElementById('roulette-alert');
        if (!box) return;

        const pending = pendingRoulettes();
        if (!pending.length) { box.innerHTML = ''; return; }

        const items = rouletteItems();
        let html = '<div class="roulette-alert"><h6>ルーレット待ち</h6>';
        pending.forEach(entry => {
            const team = entry.team;
            const ok = items.length > 0;
            html += '<div class="roulette-item">' +
                '<span class="rl-team">' + D.esc(team.name) + '</span>' +
                '<span class="rl-state">' + (ok ? '出目 ' + items.length + ' 名' : '回せる選手がいません') + '</span>' +
                '<div class="spacer"></div>' +
                '<button class="btn2 btn2-gold btn2-sm admin-only no-obs" data-roulette-team="' + D.esc(team.id) + '"' +
                (ok ? '' : ' disabled') + '>ルーレットを回す</button>' +
                '</div>';
        });
        html += '</div>';
        box.innerHTML = html;

        box.querySelectorAll('[data-roulette-team]').forEach(btn => {
            btn.addEventListener('click', () => openRoulette(btn.dataset.rouletteTeam));
        });
    }

    function openRoulette(teamId) {
        const team = currentTeams().find(t => t.id === teamId);
        if (!team) return;

        const nom = D.roundData(state.nominations, state.currentRound)[teamId];
        const slot = (nom && nom.playerName) || D.ROULETTE_LABEL;
        const items = rouletteItems();
        const stage = document.getElementById('roulette-stage');
        const banner = document.getElementById('roulette-banner');
        const note = document.getElementById('roulette-note');
        const spinBtn = document.getElementById('btn-roulette-spin');
        const applyBtn = document.getElementById('btn-roulette-apply');

        document.getElementById('roulette-team').textContent = team.name + '（' + slot + '）';
        banner.textContent = '';
        banner.classList.remove('show');
        stage.classList.remove('is-settled');

        if (!items.length) {
            stage.innerHTML = '<p class="roulette-empty">回せる選手がいません。<br>ルーレット対象を追加するか、通常の指名に切り替えてください。</p>';
            note.textContent = '';
            spinBtn.disabled = true;
            applyBtn.disabled = true;
            rouletteCtx = null;
        } else {
            // 当選者を先に均等ランダムで決めてから、そこで止まるように回す
            const winnerIndex = Math.floor(Math.random() * items.length);
            rouletteCtx = { teamId: team.id, teamName: team.name, slot: slot, items: items, winnerIndex: winnerIndex, done: false };
            window.Roulette.render(stage, items);
            note.textContent = items.length + ' 名からランダムに1名を獲得します';
            spinBtn.disabled = false;
            spinBtn.textContent = '回す！';
            applyBtn.disabled = true;
        }

        new bootstrap.Modal(document.getElementById('rouletteModal')).show();
    }

    function runRoulette() {
        if (!rouletteCtx || rouletteCtx.done) return;

        const stage = document.getElementById('roulette-stage');
        const banner = document.getElementById('roulette-banner');
        const note = document.getElementById('roulette-note');
        const spinBtn = document.getElementById('btn-roulette-spin');
        const sfx = window.Showdown && window.Showdown.sfx;

        if (sfx) { sfx.unlock(); sfx.tense(); }
        spinBtn.disabled = true;
        spinBtn.textContent = '回転中…';
        note.textContent = '';

        window.Roulette.spin(stage, rouletteCtx.items, rouletteCtx.winnerIndex, { sfx: sfx })
            .then(function () {
                const name = rouletteCtx.items[rouletteCtx.winnerIndex];
                rouletteCtx.done = true;
                rouletteCtx.winner = name;

                window.Roulette.highlight(stage, rouletteCtx.items, rouletteCtx.winnerIndex);
                banner.textContent = name;
                banner.classList.add('show');
                note.textContent = rouletteCtx.teamName + ' が「' + name + '」を獲得';
                if (sfx) sfx.win();
                if (window.Showdown) window.Showdown.confetti(stage, 2600);

                spinBtn.textContent = '決定';
                document.getElementById('btn-roulette-apply').disabled = false;
            });
    }

    function applyRoulette() {
        if (!rouletteCtx || !rouletteCtx.done || !rouletteCtx.winner) return;

        const ctx = rouletteCtx;

        // 回している間に他チームが同じ選手を確定していないか、念のため見直す
        if (rouletteItems().indexOf(ctx.winner) === -1) {
            D.toast('「' + ctx.winner + '」は他で確定済みになりました。回し直してください', 'danger', 6000);
            openRoulette(ctx.teamId);
            return;
        }

        const base = 'draft/nominations/round' + state.currentRound + '/' + ctx.teamId;
        const updates = {};
        updates[base + '/playerName'] = ctx.winner;
        updates[base + '/rouletteWon'] = true;
        updates[base + '/rouletteSlot'] = ctx.slot;
        updates[base + '/status'] = 'confirmed';
        updates[base + '/timestamp'] = Date.now();
        updates['draft/rouletteLog/round' + state.currentRound + '/' + ctx.teamId] = {
            playerName: ctx.winner,
            teamId: ctx.teamId,
            teamName: ctx.teamName,
            slot: ctx.slot,
            candidates: ctx.items,
            timestamp: Date.now()
        };

        db.ref().update(updates)
            .then(function () {
                D.toast(ctx.teamName + 'が「' + ctx.winner + '」を獲得しました', 'success', 5000);
                bootstrap.Modal.getInstance(document.getElementById('rouletteModal')).hide();
                rouletteCtx = null;
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
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
                    rows.push({
                        round: r, team,
                        player: att.playerName,
                        status: 'lost_lottery'
                    });
                });

                const pending = nom.status !== 'lost_lottery' && !D.isTentative(nom) &&
                    contested.has(D.normalizeName(nom.playerName));
                rows.push({
                    round: r,
                    team,
                    player: nom.playerName,
                    roulette: D.isRoulette(nom),
                    status: D.isTentative(nom) ? 'tentative'
                        : pending ? 'contested'
                            : D.isRouletteWaiting(nom) ? 'roulette_wait'
                                : nom.status
                });
            });
        }

        if (!rows.length) {
            container.innerHTML = '<div class="empty-state"><div class="big">📋</div>まだ指名がありません</div>';
            return;
        }

        let body = '';
        let lastRound = null;
        rows.forEach(row => {
            // 同じ巡が続く間は巡目の表記を省いて、区切り線でまとめる
            const first = row.round !== lastRound;
            lastRound = row.round;
            const lost = row.status === 'lost_lottery';
            const contested = row.status === 'contested';
            const tentative = row.status === 'tentative';
            const rlWait = row.status === 'roulette_wait';
            body += '<tr' + (first ? ' class="is-round-start"' : '') + '>' +
                '<td class="round-cell' + (first ? '' : ' is-repeat') + '">' + row.round + '巡目</td>' +
                '<td class="team-cell">' + D.avatarHtml(row.team, 'is-inline') + D.esc(row.team.name) + '</td>' +
                '<td class="player-cell">' + (lost ? '<s>' + D.esc(row.player) + '</s>' : D.esc(row.player)) + '</td>' +
                '<td>' + (lost ? '<span class="tag tag-lost">抽選負け</span>'
                    : tentative ? '<span class="tag tag-tentative">仮</span>'
                        : rlWait ? '<span class="tag tag-roulette">ルーレット待ち</span>'
                            : contested ? '<span class="tag tag-conflict">重複 — 抽選待ち</span>'
                                : row.roulette ? '<span class="tag tag-roulette">ルーレット獲得</span>'
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

    // この巡が完了しているか（未指名なし・抽選待ちなし）
    function roundBlockers() {
        const teams = currentTeams();
        const round = D.roundData(state.nominations, state.currentRound);
        return {
            pending: teams.filter(t => !D.isActive(round[t.id])),
            conflicts: D.findConflicts(state.nominations, state.currentRound),
            // 重複中は「抽選待ち」で既に数えているので、回転待ちは重複解消後だけ
            roulettes: pendingRoulettes().map(entry => entry.team)
        };
    }

    function blockerText() {
        const b = roundBlockers();
        const parts = [];
        if (b.pending.length) {
            parts.push('未指名 ' + b.pending.length + 'チーム（' +
                b.pending.map(t => t.name).join('・') + '）');
        }
        if (b.conflicts.length) {
            parts.push('抽選待ち ' + b.conflicts.length + '件（' +
                b.conflicts.map(c => c.name).join('・') + '）');
        }
        if (b.roulettes.length) {
            parts.push('ルーレット待ち ' + b.roulettes.length + 'チーム（' +
                b.roulettes.map(t => t.name).join('・') + '）');
        }
        return parts.join(' / ');
    }

    // 次の巡へ進める状態か
    function canAdvance() {
        const b = roundBlockers();
        return !b.pending.length && !b.conflicts.length && !b.roulettes.length;
    }

    // 次へボタンの状態を更新する
    function syncAdvanceButton() {
        const btn = document.getElementById('btn-next-round');
        if (!btn) return;

        const last = state.currentRound >= state.settings.totalRounds;
        const reason = blockerText();
        const blocked = last || !canAdvance();

        btn.disabled = blocked;
        btn.title = last ? '最終巡です'
            : reason ? 'この巡が完了していません — ' + reason
                : '';

        const force = document.getElementById('btn-force-next');
        if (force) {
            force.disabled = last;
            force.textContent = reason ? '未完了のまま次の巡へ（' + reason + '）' : '次の巡へ';
        }
    }

    function changeRound(delta, force) {
        // 前へ戻るのは常に自由。次へ進むときだけ完了を要求する
        if (delta > 0 && !force && !canAdvance()) {
            D.toast('この巡が完了していません — ' + blockerText(), 'danger', 5000);
            return;
        }

        let next = state.currentRound + delta;
        if (next < 1) next = 1;
        if (next > state.settings.totalRounds) next = state.settings.totalRounds;
        if (next === state.currentRound) return;
        db.ref('draft/currentRound').set(next)
            .catch(err => D.toast('巡目を変更できませんでした: ' + err.message, 'danger'));
    }

    function forceNextRound() {
        const reason = blockerText();
        if (reason && !confirm('この巡は完了していません。\n' + reason + '\n\nそれでも次の巡へ進みますか？')) return;
        changeRound(1, true);
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
            'draft/settings/revealed': null,
            'draft/settings/allIn': null
        })
            .then(() => D.toast('ドラフトをリセットしました', 'success'))
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    /* ---------- 監督（チーム）の管理 ---------- */

    function openTeamsModal() {
        teamDraft = currentTeams().map(team => ({ id: team.id, name: team.name, icon: team.icon || '', color: team.color }));
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
        const id = nextTeamId();
        teamDraft.push({ id: id, name: '', icon: '', color: D.teamColor(id) });
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
            row.style.setProperty('--team-color', D.teamColor(team));

            row.innerHTML =
                '<span class="team-row-order">' + (index + 1) + '</span>' +
                '<input type="color" class="team-color" value="' + D.esc(D.teamColor(team)) + '" title="イメージカラー">' +
                D.avatarHtml(team) +
                '<input type="text" class="input team-name" value="' + D.esc(team.name) + '" placeholder="監督名 / チーム名" maxlength="30">' +
                '<input type="text" class="input team-icon" value="' + D.esc(team.icon || '') + '" placeholder="アイコン（画像パス / @X名）" maxlength="200">' +
                '<span class="team-row-meta">' + (picks ? picks + '指名' : '未指名') + '</span>' +
                '<button type="button" class="btn2 btn2-sm" data-act="up" title="上へ"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
                '<button type="button" class="btn2 btn2-sm" data-act="down" title="下へ"' + (index === teamDraft.length - 1 ? ' disabled' : '') + '>↓</button>' +
                '<button type="button" class="btn2 btn2-sm" data-act="link" title="指名シートのURLをコピー">URL</button>' +
                '<button type="button" class="btn2 btn2-sm btn2-danger" data-act="remove" title="削除">✕</button>';

            const nameInput = row.querySelector('.team-name');
            nameInput.addEventListener('input', e => { team.name = e.target.value; });
            nameInput.addEventListener('input', renderTeamUrls);

            row.querySelector('.team-icon').addEventListener('input', e => {
                team.icon = e.target.value;
                const mark = row.querySelector('.team-avatar, .pick-dot');
                if (mark) mark.outerHTML = D.avatarHtml(team);
            });

            row.querySelector('.team-color').addEventListener('input', e => {
                team.color = e.target.value;
                row.style.setProperty('--team-color', team.color);
                const mark = row.querySelector('.team-avatar, .pick-dot');
                if (mark) mark.outerHTML = D.avatarHtml(team);
            });

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
            const entry = { id: team.id, name: names[index], order: index + 1 };
            const icon = (team.icon || '').trim();
            if (icon) entry.icon = icon;
            if (team.color) entry.color = team.color;
            teamsObj[team.id] = entry;
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
            const rl = D.isRouletteName(name);
            chip.className = 'pool-chip player-chip' + (rl ? ' is-roulette-slot' : '');
            chip.innerHTML = D.esc(name) +
                '<button type="button" class="chip-remove" title="削除">✕</button>';
            chip.querySelector('.chip-remove').addEventListener('click', () => {
                playerDraft.splice(index, 1);
                renderPlayerEditor();
            });
            box.appendChild(chip);
        });
    }

    // 選手リストに「ルーレット①」「ルーレット②」…を1つずつ足す
    function addRouletteSlot() {
        for (let i = 0; i < D.ROULETTE_MAX; i++) {
            const name = D.rouletteSlotName(i);
            const key = D.normalizeName(name);
            if (playerDraft.some(pl => D.normalizeName(pl) === key)) continue;
            playerDraft.push(name);
            renderPlayerEditor();
            D.toast('「' + name + '」を追加しました', 'info');
            return;
        }
        D.toast('ルーレット枠は' + D.ROULETTE_MAX + '個までです', 'danger');
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

        const isRl = D.isRouletteName(target.name);
        document.getElementById('lottery-player').textContent = target.name;
        document.getElementById('showdown').innerHTML = '';
        document.getElementById('showdown-banner').className = 'showdown-banner';
        document.getElementById('showdown-banner').textContent = '';
        document.getElementById('lottery-note').textContent =
            lotteryCtx.teams.map(t => t.name).join(' / ') + ' の ' + lotteryCtx.teams.length + 'チームでポーカー勝負' +
            (isRl ? '（勝った1チームだけがルーレットを回せます）' : '');
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
        stage.classList.remove('is-flash', 'is-shake', 'is-rolling');

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
                '<div class="sd-team">' + D.avatarHtml(hand.team) + D.esc(hand.team.name) + '</div>' +
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
        banner.textContent = leadNames.join(' / ') + ' がリード';
        note.textContent = 'このまま決まるか…？';
        await wait(1800);

        // --- 運命の5枚目 ---
        banner.className = 'showdown-banner is-countdown';
        banner.textContent = '運命の5枚目';
        note.textContent = '';
        // 周囲を落として5枚目の枠に目を集める。音は 2.76 秒後にクラッシュが来る
        stage.classList.add('is-rolling');
        Showdown.sfx.drumroll(2.9);
        await wait(900);

        // 数字ごとの電子音はドラムロールとぶつかるので鳴らさない
        for (let n = 3; n >= 1; n--) {
            banner.className = 'showdown-banner is-countdown is-digit';
            banner.textContent = String(n);
            await wait(620);
        }

        banner.className = 'showdown-banner is-open';
        banner.textContent = 'オープン！';
        stage.classList.remove('is-rolling');
        stage.classList.add('is-flash', 'is-shake');
        setTimeout(() => stage.classList.remove('is-flash', 'is-shake'), 500);
        Showdown.sfx.drumrollStop();
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

            // 本物の決着とまったく同じ見た目で祝う（ここで待ったを匂わせない）
            const provHand = packet.hands[provIndex];
            const provLead = Showdown.leadersAt(packet.hands, 4).some(
                t => packet.provisional && t.id === packet.provisional.id);

            rows.forEach(r => r.classList.remove('is-leading'));
            rows.forEach((r, i) => {
                if (i === provIndex) r.classList.add('is-winner');
                else r.classList.add('is-out');
            });

            stage.classList.add('is-flash');
            setTimeout(() => stage.classList.remove('is-flash'), 500);

            if (provLead) {
                banner.className = 'showdown-banner is-win';
                banner.textContent = packet.provisional.name + ' 逃げ切り';
                Showdown.sfx.win();
            } else {
                banner.className = 'showdown-banner is-comeback';
                banner.textContent = '大逆転  ' + packet.provisional.name;
                Showdown.sfx.comeback();
            }

            const provFlavor = Showdown.flavorFor(provHand.result);
            note.textContent = provHand.result.name + ' で ' + packet.provisional.name + ' が交渉権を獲得' +
                (provFlavor ? '  —  ' + provFlavor : '');
            Showdown.confetti(stage, 2400);
            await wait(2600);

            // 待った
            stage.classList.add('is-objection');
            banner.className = 'showdown-banner is-objection';
            banner.textContent = '✋ ちょっとまったー！！';
            note.textContent = '';
            Showdown.sfx.objection();
            rows.forEach(r => { r.classList.remove('is-winner'); r.classList.remove('is-out'); });
            await wait(1500);

            const winIndex = packet.hands.findIndex(h => h.team.id === packet.winner.id);
            const winRow = rows[winIndex];
            const winHand = packet.hands[winIndex];

            winRow.classList.add('is-objector');
            banner.textContent = '✋ ちょっとまったー！！　' + packet.winner.name;
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

            const slamGap = Math.max(80, 240 - winHand.finisher.cards.length * 12);
            if (!winHand.finisher.cards.length) await wait(500);
            for (let i = 0; i < winHand.finisher.cards.length; i++) {
                const el = document.createElement('span');
                el.innerHTML = Showdown.cardHtml(winHand.finisher.cards[i]);
                const cardEl = el.firstChild;
                cardEl.classList.add('is-slammed');
                holder.appendChild(cardEl);
                Showdown.sfx.slam(i);
                await wait(slamGap);
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
            banner.textContent = winHand.finisher.label + '  ' + packet.winner.name;
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
            banner.textContent = '大逆転  ' + packet.winner.name;
            Showdown.sfx.comeback();
        } else {
            banner.className = 'showdown-banner is-win';
            banner.textContent = packet.winner.name + ' 逃げ切り';
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

    /* ---------- ルーレット対象の編集 ---------- */

    function openRouletteEditor() {
        rouletteDraft = D.roulettePool({ roulette: state.roulette }).slice();
        renderRouletteEditor();
        new bootstrap.Modal(document.getElementById('rouletteEditModal')).show();
    }

    function renderRouletteEditor() {
        const box = document.getElementById('roulette-chips');
        const count = document.getElementById('roulette-count');
        const addBtn = document.getElementById('btn-roulette-add');
        const input = document.getElementById('roulette-add-input');

        const max = D.ROULETTE_MAX;
        count.textContent = rouletteDraft.length + ' / ' + max + ' 名';

        const full = rouletteDraft.length >= max;
        addBtn.disabled = full;
        input.disabled = full;
        input.placeholder = full ? '上限' + max + '名に達しています' : '選手名を入力して追加';

        if (!rouletteDraft.length) {
            box.innerHTML = '<p class="pool-empty">まだ登録がありません。ルーレットに載せる選手を追加してください。</p>';
            return;
        }

        const colors = window.Roulette ? window.Roulette.SEG_COLORS : ['#f8d000'];
        const taken = D.takenPlayers(state.nominations, state.settings.totalRounds);
        box.innerHTML = '';

        rouletteDraft.forEach(function (name, i) {
            const out = taken.has(D.normalizeName(name));
            const chip = document.createElement('span');
            chip.className = 'rl-chip' + (out ? ' is-out' : '');
            chip.innerHTML =
                '<span class="rl-swatch" style="background:' + colors[i % colors.length] + '"></span>' +
                '<span>' + D.esc(name) + '</span>';

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'chip-remove';
            del.textContent = '✕';
            del.title = '削除';
            del.addEventListener('click', function () {
                rouletteDraft.splice(i, 1);
                renderRouletteEditor();
            });
            chip.appendChild(del);
            box.appendChild(chip);
        });
    }

    function addRouletteName() {
        const input = document.getElementById('roulette-add-input');
        const name = input.value.trim();
        if (!name) return;
        if (rouletteDraft.length >= D.ROULETTE_MAX) {
            D.toast('ルーレットは最大' + D.ROULETTE_MAX + '名までです', 'danger');
            return;
        }
        const key = D.normalizeName(name);
        if (rouletteDraft.some(n => D.normalizeName(n) === key)) {
            D.toast('「' + name + '」は既に登録されています', 'danger');
            return;
        }
        rouletteDraft.push(name);
        input.value = '';
        renderRouletteEditor();
    }

    function saveRoulettePool() {
        const value = rouletteDraft.slice(0, D.ROULETTE_MAX).join(String.fromCharCode(10));
        db.ref('draft/roulette').set(value)
            .then(function () {
                D.toast('ルーレット対象を保存しました（' + rouletteDraft.length + '名）', 'success');
                bootstrap.Modal.getInstance(document.getElementById('rouletteEditModal')).hide();
            })
            .catch(err => D.toast('エラー: ' + err.message, 'danger'));
    }

    /* ---------- 選手一覧 ---------- */

    let playerListFilter = 'all';
    let playerListSearch = '';

    function showPlayerList() {
        renderPlayerList();
        new bootstrap.Modal(document.getElementById('playerListModal')).show();
    }

    function renderPlayerList() {
        const box = document.getElementById('player-list');
        if (!box) return;

        const pool = D.playerPool({ players: state.players });
        const teams = currentTeams();
        const nameOf = id => {
            const t = teams.find(x => x.id === id);
            return t ? t.name : id;
        };

        // 確定済み（どの巡・どのチーム）
        const taken = D.takenPlayers(state.nominations, state.settings.totalRounds);

        // 現在抽選待ちの選手
        const contested = {};
        for (let r = 1; r <= state.settings.totalRounds; r++) {
            D.findConflicts(state.nominations, r).forEach(c => {
                contested[c.key] = { round: r, teamIds: c.teamIds };
            });
        }

        const entries = pool.map(name => {
            const key = D.normalizeName(name);
            if (contested[key]) {
                return { name: name, state: 'contested', info: contested[key] };
            }
            const t = taken.get(key);
            if (t) return { name: name, state: 'taken', info: t };
            return { name: name, state: 'free' };
        });

        const free = entries.filter(e => e.state === 'free').length;
        document.getElementById('player-list-count').textContent =
            '残り ' + free + ' / ' + entries.length + ' 名';

        const shown = entries.filter(e => {
            if (playerListFilter === 'free' && e.state !== 'free') return false;
            if (playerListSearch && D.normalizeName(e.name).indexOf(playerListSearch) === -1) return false;
            return true;
        });

        if (!pool.length) {
            box.innerHTML = '<p class="pool-empty">選手が登録されていません。「設定」→「選手リストを編集」から登録してください。</p>';
            return;
        }
        if (!shown.length) {
            box.innerHTML = '<p class="pool-empty">該当する選手がいません</p>';
            return;
        }

        box.innerHTML = shown.map(e => {
            const rl = D.isRouletteName(e.name) ? ' is-roulette-slot' : '';
            if (e.state === 'taken') {
                const color = D.teamColor(state.teams[e.info.teamId] || e.info.teamId);
                return '<div class="pl-item is-taken' + rl + '" style="--team-color:' + color + '">' +
                    '<span class="pl-name"><s>' + D.esc(e.name) + '</s></span>' +
                    '<span class="pl-meta">' + e.info.round + '巡目 · ' + D.esc(nameOf(e.info.teamId)) + '</span>' +
                    '</div>';
            }
            if (e.state === 'contested') {
                return '<div class="pl-item is-contested' + rl + '">' +
                    '<span class="pl-name">' + D.esc(e.name) + '</span>' +
                    '<span class="pl-meta">抽選待ち · ' +
                    e.info.teamIds.map(id => D.esc(nameOf(id))).join(' / ') + '</span>' +
                    '</div>';
            }
            return '<div class="pl-item' + rl + '"><span class="pl-name">' + D.esc(e.name) + '</span>' +
                '<span class="pl-meta">未指名</span></div>';
        }).join('');
    }

    /* ---------- 結果一覧 ---------- */

    // 結果をテキストファイルとして保存する
    function downloadResults() {
        D.downloadResultsText({
            teams: state.teams,
            nominations: state.nominations,
            settings: state.settings,
            lottery: state.lottery,
            rouletteLog: state.rouletteLog
        });
        D.toast('結果をテキストで保存しました', 'success');
    }

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
