// js/main.js の前半
const db = firebase.database();

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    // 1-6巡の範囲内に制限
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    // 巡目をFirebaseに保存
    db.ref('draft/currentRound').set(newRound).then(() => {
        console.log('Round updated to:', newRound);
    }).catch(error => {
        console.error('Error updating round:', error);
    });
}

// 現在の指名状況を監視（リアルタイム更新）
function initializeMainScreen() {
    // チーム情報を取得
    db.ref('draft/teams').once('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            updateTeamSelect(teamsData);
        }
    });

    // 巡目の監視
    const currentRoundRef = db.ref('draft/currentRound');
    currentRoundRef.on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });

    // 指名データの監視（リアルタイム更新）
    const nominationsRef = db.ref('draft/nominations');
    nominationsRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            db.ref('draft/teams').once('value', (teamsSnapshot) => {
                const teamsData = teamsSnapshot.val();
                updateNominationsList(data, teamsData);
                updateHistory(data, teamsData);
            });
        }
    });
}

// 指名リストの更新
function updateNominationsList(nominationsData, teamsData) {
    const nominationsList = document.getElementById('nominations-list');
    nominationsList.innerHTML = '';
    
    const currentRound = document.getElementById('current-round').textContent;
    const roundData = nominationsData[`round${currentRound}`] || {};

    // リストグループのコンテナを作成
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    // 全チームについて処理
    Object.entries(teamsData).forEach(([teamId, teamData]) => {
        const nomination = roundData[teamId];
        const listItem = document.createElement('div');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        
        let statusBadge = '';
        let playerDisplay = '未指名';

        if (nomination) {
            playerDisplay = nomination.playerName;
            if (nomination.status === 'lost_lottery') {
                statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
                playerDisplay = `<s>${nomination.playerName}</s>`;
            }
        }

        listItem.innerHTML = `
            <div>
                <strong>${teamData.name}</strong>: 
                <span class="nomination-player">
                    ${playerDisplay}
                </span>
            </div>
            ${statusBadge}
        `;
        
        listGroup.appendChild(listItem);
    });

    nominationsList.appendChild(listGroup);
}

// 指名履歴の更新
function updateHistory(nominationsData, teamsData) {
    const historyBody = document.getElementById('history-body');
    historyBody.innerHTML = '';

    // 各ラウンドのデータを処理
    Object.keys(nominationsData).sort().forEach(round => {
        const roundData = nominationsData[round];
        if (!roundData) return;

        const roundNumber = round.replace('round', '');
        
        Object.entries(roundData).forEach(([teamId, nomination]) => {
            if (nomination && nomination.playerName) {
                const row = document.createElement('tr');
                
                let status = '完了';
                if (nomination.status === 'lost_lottery') {
                    status = '抽選負け';
                }

                const teamName = teamsData[teamId]?.name || teamId;

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

// 抽選結果入力のチェックボックスを更新
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

// 抽選負けチームの設定（複数対応版）
function setLostTeams() {
    const checkboxes = document.querySelectorAll('input[name="lostTeams"]:checked');
    const lostTeams = Array.from(checkboxes).map(cb => cb.value);
    
    if (lostTeams.length === 0) {
        alert('抽選負けのチームを選択してください');
        return;
    }

    const currentRound = document.getElementById('current-round').textContent;
    
    // 各チームのステータスを更新
    Promise.all(lostTeams.map(teamId => {
        const path = `draft/nominations/round${currentRound}/${teamId}`;
        return db.ref(path).update({
            status: 'lost_lottery',
            canReselect: true
        });
    })).then(() => {
        const message = `${lostTeams.length}チームに再指名権を付与しました`;
        alert(message);
        
        // チェックボックスをリセット
        checkboxes.forEach(cb => cb.checked = false);
    }).catch(error => {
        console.error('Update error:', error);
        alert('エラーが発生しました: ' + error.message);
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
