// js/main.js
const db = firebase.database();

// デバッグ用のログ関数
function log(message, data) {
    console.log(`[DEBUG] ${message}:`, data);
}

// データベース接続テスト
db.ref().once('value')
    .then(snapshot => {
        console.log('Database connection test - Data:', snapshot.val());
    })
    .catch(error => {
        console.error('Database connection error:', error);
    });

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    db.ref('draft/currentRound').set(newRound)
        .then(() => log('Round updated successfully', newRound))
        .catch(error => console.error('Error updating round:', error));
}

// 現在の指名状況を監視
function initializeMainScreen() {
    log('Initializing main screen');

    // データベースの参照を取得
    const teamsRef = db.ref('draft/teams');
    const nominationsRef = db.ref('draft/nominations');
    const currentRoundRef = db.ref('draft/currentRound');

    // チーム情報の監視
    teamsRef.on('value', (snapshot) => {
        const teamsData = snapshot.val();
        log('Teams data received', teamsData);

        if (!teamsData) {
            console.error('No teams data available. Database path:', teamsRef.toString());
            return;
        }

        // チェックボックスを更新
        updateTeamCheckboxes(teamsData);

        // 指名データを取得
        nominationsRef.once('value', (nominationsSnapshot) => {
            const nominationsData = nominationsSnapshot.val() || {};
            log('Nominations data received', nominationsData);
            updateDisplay(teamsData, nominationsData);
        });
    });

    // 指名データの監視
    nominationsRef.on('value', (snapshot) => {
        const nominationsData = snapshot.val() || {};
        log('Nominations updated', nominationsData);

        teamsRef.once('value', (teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            if (teamsData) {
                updateDisplay(teamsData, nominationsData);
            }
        });
    });

    // 巡目の監視
    currentRoundRef.on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        log('Current round updated', round);
        document.getElementById('current-round').textContent = round;
    });
}

// チーム選択のチェックボックスを更新
function updateTeamCheckboxes(teamsData) {
    log('Updating team checkboxes', teamsData);
    const container = document.querySelector('.lost-teams-checkboxes');
    if (!container) {
        console.error('Checkbox container not found');
        return;
    }

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
    log('Updating display', { teamsData, nominationsData });
    const currentRound = document.getElementById('current-round').textContent;
    const roundData = nominationsData[`round${currentRound}`] || {};

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
    log('Updating history', { teamsData, nominationsData });
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
    
    log('Setting lost teams', lostTeams);
    
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

    log('Updating lost teams', updates);

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

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
