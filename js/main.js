// js/main.js
const db = firebase.database();

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    // 1-6巡の範囲内に制限
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    // 巡目をFirebaseに保存
    db.ref('draft/currentRound').set(newRound);
}

// 現在の指名状況を監視
function initializeMainScreen() {
    // 巡目の監視
    db.ref('draft/currentRound').on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
        
        // 巡目が変更されたら指名リストを更新
        updateDisplay();
    });

    // 指名データの監視
    db.ref('draft/nominations').on('value', () => {
        updateDisplay();
    });

    // 初期表示
    updateDisplay();
}

// 画面全体の更新
function updateDisplay() {
    Promise.all([
        db.ref('draft/teams').once('value'),
        db.ref('draft/nominations').once('value')
    ]).then(([teamsSnapshot, nominationsSnapshot]) => {
        const teamsData = teamsSnapshot.val();
        const nominationsData = nominationsSnapshot.val();

        // チーム選択の更新
        updateTeamSelect(teamsData);
        
        // 現在の指名状況の更新
        updateNominationsList(nominationsData, teamsData);
        
        // 履歴の更新
        updateHistory(nominationsData, teamsData);
    });
}

// 指名リストの更新
function updateNominationsList(nominationsData, teamsData) {
    const nominationsList = document.getElementById('nominations-list');
    nominationsList.innerHTML = '';
    
    const currentRound = document.getElementById('current-round').textContent;
    const roundData = nominationsData ? nominationsData[`round${currentRound}`] || {} : {};

    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const nomination = roundData[teamId];
        const listItem = document.createElement('div');
        listItem.className = 'list-group-item';

        let playerDisplay = '未指名';
        let statusBadge = '';

        if (nomination) {
            playerDisplay = nomination.playerName;
            if (nomination.status === 'lost_lottery') {
                statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
                playerDisplay = `<s>${playerDisplay}</s>`;
            }
        }

        listItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${team.name}</strong>: 
                    <span class="nomination-player">
                        ${playerDisplay}
                    </span>
                </div>
                ${statusBadge}
            </div>
        `;

        listGroup.appendChild(listItem);
    });

    nominationsList.appendChild(listGroup);
}

// 指名履歴の更新
function updateHistory(nominationsData, teamsData) {
    const historyBody = document.getElementById('history-body');
    historyBody.innerHTML = '';

    if (!nominationsData) return;

    Object.entries(nominationsData).sort().forEach(([round, roundData]) => {
        const roundNumber = round.replace('round', '');
        
        Object.entries(roundData || {}).forEach(([teamId, nomination]) => {
            if (nomination && nomination.playerName) {
                const row = document.createElement('tr');
                const teamName = teamsData[teamId]?.name || teamId;
                
                let status = '完了';
                if (nomination.status === 'lost_lottery') {
                    status = '抽選負け';
                }

                row.innerHTML = `
                    <td>${roundNumber}巡目</td>
                    <td>${teamName}</td>
                    <td>${nomination.playerName}</td>
                    <td>${status}</td>
                `;
                
                historyBody.appendChild(row);
            }
        });
    });
}

// チーム選択の更新
function updateTeamSelect(teamsData) {
    const checkboxContainer = document.querySelector('.lost-teams-checkboxes');
    if (!checkboxContainer) return;

    checkboxContainer.innerHTML = '';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const div = document.createElement('div');
        div.className = 'form-check';
        div.innerHTML = `
            <input class="form-check-input" type="checkbox" name="lostTeams" value="${teamId}" id="${teamId}Check">
            <label class="form-check-label" for="${teamId}Check">${team.name}</label>
        `;
        checkboxContainer.appendChild(div);
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

    db.ref().update(updates).then(() => {
        alert(`${lostTeams.length}チームに再指名権を付与しました`);
        checkboxes.forEach(cb => cb.checked = false);
    }).catch(error => {
        console.error('Update error:', error);
        alert('エラーが発生しました: ' + error.message);
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
