// js/main.js
const db = firebase.database();

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    db.ref('draft/currentRound').set(newRound);
}

// 現在の指名状況を監視
function initializeMainScreen() {
    // チーム情報を取得
    db.ref('draft/teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            // チェックボックスを更新
            updateTeamCheckboxes(teamsData);
            
            // 指名データも取得して表示を更新
            db.ref('draft/nominations').once('value', (nominationsSnapshot) => {
                const nominationsData = nominationsSnapshot.val() || {};
                updateDisplay(teamsData, nominationsData);
            });
        }
    });

    // 指名データの監視
    db.ref('draft/nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        db.ref('draft/teams').once('value', (teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            if (teamsData) {
                updateDisplay(teamsData, nominationsData);
            }
        });
    });

    // 巡目の監視
    db.ref('draft/currentRound').on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });
}

// チーム選択のチェックボックスを更新
function updateTeamCheckboxes(teamsData) {
    const container = document.querySelector('.lost-teams-checkboxes');
    if (!container) return;

    container.innerHTML = '';
    Object.entries(teamsData).forEach(([teamId, team]) => {
        const div = document.createElement('div');
        div.className = 'form-check';
        div.innerHTML = `
            <input class="form-check-input" type="checkbox" name="lostTeams" value="${teamId}" id="${teamId}Check">
            <label class="form-check-label" for="${teamId}Check">${team.name}</label>
        `;
        container.appendChild(div);
    });
}

// 画面表示の更新
function updateDisplay(teamsData, nominationsData) {
    const currentRound = document.getElementById('current-round').textContent;
    const roundData = nominationsData ? nominationsData[`round${currentRound}`] || {} : {};

    // 指名リストの更新
    const nominationsList = document.getElementById('nominations-list');
    if (!nominationsList) return;

    nominationsList.innerHTML = '';
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const nomination = roundData[teamId];
        const div = document.createElement('div');
        div.className = 'list-group-item';

        let playerInfo = '未指名';
        let statusBadge = '';

        if (nomination) {
            playerInfo = nomination.playerName;
            if (nomination.status === 'lost_lottery') {
                statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
                playerInfo = `<s>${playerInfo}</s>`;
            }
        }

        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${team.name}</strong>: 
                    <span class="nomination-player">${playerInfo}</span>
                </div>
                ${statusBadge}
            </div>
        `;

        listGroup.appendChild(div);
    });

    nominationsList.appendChild(listGroup);
    updateHistory(teamsData, nominationsData);
}

// 履歴の更新
function updateHistory(teamsData, nominationsData) {
    const historyBody = document.getElementById('history-body');
    if (!historyBody) return;

    historyBody.innerHTML = '';
    if (!nominationsData) return;

    Object.entries(nominationsData).sort().forEach(([round, roundData]) => {
        if (!roundData) return;

        const roundNumber = round.replace('round', '');
        Object.entries(roundData).forEach(([teamId, nomination]) => {
            if (!nomination || !nomination.playerName) return;

            const team = teamsData[teamId];
            if (!team) return;

            const row = document.createElement('tr');
            let status = nomination.status === 'lost_lottery' ? '抽選負け' : '完了';

            row.innerHTML = `
                <td>${roundNumber}巡目</td>
                <td>${team.name}</td>
                <td>${nomination.playerName}</td>
                <td>${status}</td>
            `;

            historyBody.appendChild(row);
        });
    });
}

// 抽選負けチームの設定
function setLostTeams() {
    const checkboxes = document.querySelectorAll('input[name="lostTeams"]:checked');
    const lostTeams = Array.from(checkboxes).map(cb => cb.value);
    
    if (lostTeams.length === 0) {
        alert('抽選負けのチームを選択してください');
        return;
    }

    const currentRound = document.getElementById('current-round').textContent;
    const updates = {};

    lostTeams.forEach(teamId => {
        updates[`draft/nominations/round${currentRound}/${teamId}/status`] = 'lost_lottery';
        updates[`draft/nominations/round${currentRound}/${teamId}/canReselect`] = true;
    });

    db.ref().update(updates)
        .then(() => {
            alert(`${lostTeams.length}チームに再指名権を付与しました`);
            checkboxes.forEach(cb => cb.checked = false);
        })
        .catch(error => {
            console.error('Update error:', error);
            alert('エラーが発生しました: ' + error.message);
        });
}


// 結果表示機能
function showResults() {
    const container = document.getElementById('results-container');
    container.innerHTML = '';

    // チーム情報とドラフトデータを取得
    db.ref('draft/teams').once('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            db.ref('draft/nominations').once('value', (nominationsSnapshot) => {
                const nominationsData = nominationsSnapshot.val() || {};
                
                // 各チームの結果を表示
                Object.entries(teamsData).forEach(([teamId, team]) => {
                    const col = document.createElement('div');
                    col.className = `col-md team-color-${teamId.replace('team', '')}`;
                    
                    let nominations = [];
                    // 全ラウンドの指名を収集
                    if (nominationsData) {
                        for (let round = 1; round <= 6; round++) {
                            const roundData = nominationsData[`round${round}`];
                            if (roundData && roundData[teamId]) {
                                nominations.push({
                                    round: round,
                                    player: roundData[teamId].playerName,
                                    status: roundData[teamId].status
                                });
                            }
                        }
                    }

                    // チームの結果カードを作成
                    col.innerHTML = `
                        <div class="card mb-4">
                            <div class="card-header">
                                <h4>${team.name}</h4>
                            </div>
                            <div class="card-body">
                                <ul class="list-group list-group-flush">
                                    ${nominations.map(nom => `
                                        <li class="list-group-item">
                                            ${nom.round}巡目: 
                                            ${nom.status === 'lost_lottery' ? 
                                                `<s>${nom.player}</s> <span class="badge bg-warning">抽選負け</span>` : 
                                                nom.player}
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        </div>
                    `;

                    container.appendChild(col);
                });

                // モーダルを表示
                const modal = new bootstrap.Modal(document.getElementById('resultsModal'));
                modal.show();
            });
        }
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
