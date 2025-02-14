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
        
        Object.entries(roundData).forEach(([teamId, nomination]) => {
            console.log('Processing team:', teamId, nomination);
            
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
            
            let statusBadge = '';
            if (nomination.status === 'lost_lottery') {
                statusBadge = '<span class="badge bg-warning">抽選負け - 再指名待ち</span>';
            }

            listItem.innerHTML = `
                <div>
                    <strong>${nomination.teamName}</strong>: 
                    <span class="nomination-player">
                        ${nomination.playerName || '未指名'}
                    </span>
                </div>
                ${statusBadge}
            `;
            
            listGroup.appendChild(listItem);
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

                    row.innerHTML = `
                        <td>${roundNumber}巡目</td>
                        <td>${nomination.teamName}</td>
                        <td>${nomination.playerName}</td>
                        <td>${status}</td>
                    `;
                    
                    historyBody.appendChild(row);
                }
            });
        }
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
    const updates = {};

    // 各チームのステータスを更新
    lostTeams.forEach(teamId => {
        const path = `draft/nominations/round${currentRound}/${teamId}`;
        console.log('Updating path:', path);
        
        // 既存のデータを保持しながら状態を更新
        db.ref(path).once('value', (snapshot) => {
            const currentData = snapshot.val() || {};
            updates[path] = {
                ...currentData,
                status: 'lost_lottery',
                canReselect: true
            };
            
            // 全てのチームの処理が完了したら更新を実行
            if (Object.keys(updates).length === lostTeams.length) {
                console.log('Final updates:', updates);
                
                db.ref().update(updates).then(() => {
                    const message = `${lostTeams.length}チームに再指名権を付与しました`;
                    alert(message);
                    
                    // チェックボックスをリセット
                    checkboxes.forEach(cb => cb.checked = false);
                }).catch(error => {
                    console.error('Update error:', error);
                    alert('エラーが発生しました: ' + error.message);
                });
            }
        });
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
