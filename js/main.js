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
    console.log("Initializing main screen...");

    // チーム情報を取得してチェックボックスを生成
    db.ref('draft/teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        console.log("Teams data:", teamsData);
        if (teamsData) {
            generateTeamCheckboxes(teamsData);
        }
    });

    // 指名データの監視
    db.ref('draft/nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        console.log("Nominations data:", nominationsData);
        
        // チーム情報と組み合わせて表示を更新
        db.ref('draft/teams').get().then((teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            displayNominations(nominationsData, teamsData);
            displayHistory(nominationsData, teamsData);
        });
    });

    // 巡目の監視
    db.ref('draft/currentRound').on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });
}

// チェックボックスの生成
function generateTeamCheckboxes(teamsData) {
    const container = document.getElementById('team-checkboxes');
    if (!container) return;

    container.innerHTML = ''; // クリア

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const checkbox = document.createElement('div');
        checkbox.className = 'form-check';
        checkbox.innerHTML = `
            <input class="form-check-input" type="checkbox" name="lostTeams" value="${teamId}" id="${teamId}Check">
            <label class="form-check-label" for="${teamId}Check">${team.name}</label>
        `;
        container.appendChild(checkbox);
    });
}

// 指名状況の表示
function displayNominations(nominationsData, teamsData) {
    const nominationsList = document.getElementById('nominations-list');
    if (!nominationsList) return;

    const currentRound = document.getElementById('current-round').textContent;
    const roundData = nominationsData ? nominationsData[`round${currentRound}`] || {} : {};

    nominationsList.innerHTML = '';
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const nomination = roundData[teamId];
        const item = document.createElement('div');
        item.className = 'list-group-item';

        let playerInfo = nomination ? nomination.playerName : '未指名';
        let statusBadge = '';

        if (nomination && nomination.status === 'lost_lottery') {
            statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
            playerInfo = `<s>${playerInfo}</s>`;
        }

        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${team.name}</strong>: 
                    <span class="nomination-player">${playerInfo}</span>
                </div>
                ${statusBadge}
            </div>
        `;

        listGroup.appendChild(item);
    });

    nominationsList.appendChild(listGroup);
}

// 履歴の表示
function displayHistory(nominationsData, teamsData) {
    const historyBody = document.getElementById('history-body');
    if (!historyBody) return;

    historyBody.innerHTML = '';

    if (!nominationsData) return;

    Object.entries(nominationsData).sort().forEach(([round, roundData]) => {
        if (!roundData) return;

        const roundNumber = round.replace('round', '');

        Object.entries(roundData).forEach(([teamId, nomination]) => {
            if (!nomination || !nomination.playerName) return;

            const row = document.createElement('tr');
            const teamName = teamsData[teamId].name;
            
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

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
