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
    db.ref('draft/currentRound').set(newRound).then(() => {
        console.log('Round updated to:', newRound);
    }).catch(error => {
        console.error('Error updating round:', error);
    });
}

// 現在の指名状況を監視（リアルタイム更新）
function initializeMainScreen() {
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
        console.log('Received data:', data);
        updateNominationsList(data);
        updateHistory(data);
    });

    // チーム選択の更新を追加
    updateTeamSelect();
}

// 指名リストの更新
function updateNominationsList(data) {
    const nominationsList = document.getElementById('nominations-list');
    nominationsList.innerHTML = '';

    if (!data) return;

    const currentRound = document.getElementById('current-round').textContent;
    const roundData = data[`round${currentRound}`];
    console.log('Current round data:', roundData);

    if (roundData) {
        // リストグループのコンテナを作成
        const listGroup = document.createElement('div');
        listGroup.className = 'list-group';
        
        // チーム情報を取得
        db.ref('draft/teams').once('value', (snapshot) => {
            const teamsData = snapshot.val();
            
            Object.entries(roundData).forEach(([teamId, nomination]) => {
                console.log('Processing team:', teamId, nomination);
                
                const listItem = document.createElement('div');
                listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
                
                let statusBadge = '';
                let playerDisplay = nomination.playerName || '未指名';
                
                if (nomination.status === 'lost_lottery') {
                    statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
                    playerDisplay = `<s>${nomination.playerName}</s>`;
                }

                // チーム名を取得
                const teamName = teamsData[teamId]?.name || teamId;

                listItem.innerHTML = `
                    <div>
                        <strong>${teamName}</strong>: 
                        <span class="nomination-player">
                            ${playerDisplay}
                        </span>
                    </div>
                    ${statusBadge}
                `;
                
                listGroup.appendChild(listItem);
            });
        });

        nominationsList.appendChild(listGroup);
    }
}

// 指名履歴の更新
function updateHistory(data) {
    const historyBody = document.getElementById('history-body');
    historyBody.innerHTML = '';

    if (!data) {
        console.log('No data for history');
        return;
    }

    console.log('Updating history with data:', data);

    // チーム情報を取得
    db.ref('draft/teams').once('value', (snapshot) => {
        const teamsData = snapshot.val();

        // 各ラウンドのデータを処理
        Object.keys(data).sort().forEach(round => {
            const roundData = data[round];
            const roundNumber = round.replace('round', '');
            
            // そのラウンドの各チームの指名を表示
            if (roundData) {
                Object.entries(roundData).forEach(([teamId, nomination]) => {
                    if (nomination.playerName) { // 指名がある場合のみ表示
                        const row = document.createElement('tr');
                        
                        let status = '完了';
                        if (nomination.status === 'lost_lottery') {
                            status = '抽選負け';
                        }

                        // チーム名を取得
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
            }
        });
    });
}

// 抽選結果入力のセレクトボックスを更新
function updateTeamSelect() {
    const checkboxContainer = document.querySelector('.lost-teams-checkboxes');
    if (!checkboxContainer) return;

    db.ref('draft/teams').once('value', (snapshot) => {
        const teamsData = snapshot.val();
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
    });
}

// 抽選負けチームの設定（複数対応版）
function setLostTeams() {
    // チェックされたチームを全て取得
    const checkboxes = document.querySelectorAll('input[name="lostTeams"]:checked');
    const lostTeams = Array.from(checkboxes).map(cb => cb.value);
    
    console.log('Selected teams:', lostTeams);

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
