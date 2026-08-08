// js/draft-results.js — 結果一覧（リアルタイム更新）
(function () {
    'use strict';

    const D = window.Draft;
    const db = D.db;

    const state = {
        teams: {},
        nominations: {},
        settings: { totalRounds: D.DEFAULT_ROUNDS, hidePicks: false, revealed: {} },
        lottery: {}
    };

    let view = D.param('view2') === 'matrix' ? 'matrix' : 'grid';

    function init() {
        D.applyDisplayModes();

        if (view === 'matrix') {
            document.querySelectorAll('#view-toggle button').forEach(b => {
                b.classList.toggle('active', b.dataset.view === 'matrix');
            });
        }

        document.getElementById('view-toggle').addEventListener('click', e => {
            const btn = e.target.closest('button[data-view]');
            if (!btn) return;
            document.querySelectorAll('#view-toggle button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            view = btn.dataset.view;
            render();
        });

        document.getElementById('btn-print').addEventListener('click', () => window.print());

        db.ref('draft').on('value', snapshot => {
            const data = snapshot.val() || {};
            state.teams = data.teams || {};
            state.nominations = data.nominations || {};
            state.settings = D.readSettings(data);
            state.lottery = data.lottery || {};
            render();
        }, error => {
            console.error('データ取得エラー:', error);
            document.getElementById('results-container').innerHTML =
                '<div class="empty-state"><div class="big">⚠</div>データを取得できませんでした</div>';
        });
    }

    function render() {
        const container = document.getElementById('results-container');
        if (view === 'matrix') {
            D.renderResultsMatrix(container, state.teams, state.nominations, state.settings.totalRounds);
        } else {
            D.renderResultsGrid(container, state.teams, state.nominations, state.settings.totalRounds);
        }
        renderSummary();
        renderLotteryLog();
    }

    function renderSummary() {
        const teams = D.teamList(state.teams);
        let done = 0;
        const total = teams.length * state.settings.totalRounds;

        for (let r = 1; r <= state.settings.totalRounds; r++) {
            const round = D.roundData(state.nominations, r);
            teams.forEach(t => { if (D.isActive(round[t.id])) done++; });
        }

        document.getElementById('subtitle').textContent =
            total ? done + ' / ' + total + ' 指名確定 — リアルタイム更新' : 'リアルタイム更新';
    }

    function renderLotteryLog() {
        const panel = document.getElementById('lottery-panel');
        const box = document.getElementById('lottery-log');
        const rows = [];

        Object.entries(state.lottery).forEach(([roundKey, records]) => {
            if (!records) return;
            const round = parseInt(String(roundKey).replace('round', ''), 10) || 0;
            Object.values(records).forEach(rec => {
                if (rec && rec.playerName) rows.push({ round, rec });
            });
        });

        if (!rows.length) { panel.classList.add('hide'); return; }
        panel.classList.remove('hide');
        rows.sort((a, b) => a.round - b.round);

        let body = '';
        rows.forEach(({ round, rec }) => {
            const losers = Array.isArray(rec.loserTeamNames) ? rec.loserTeamNames : [];
            body += '<tr>' +
                '<td class="round-cell">' + round + '巡目</td>' +
                '<td class="player-cell">' + D.esc(rec.playerName) + '</td>' +
                '<td><span class="tag tag-won">' + D.esc(rec.winnerTeamName || '') + '</span></td>' +
                '<td class="muted">' + losers.map(n => D.esc(n)).join(' / ') + '</td>' +
                '</tr>';
        });

        box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
            '<th>巡目</th><th>対象選手</th><th>獲得</th><th>抽選負け</th>' +
            '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    document.addEventListener('DOMContentLoaded', init);
})();
