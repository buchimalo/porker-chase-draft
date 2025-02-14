// js/main.js
const db = firebase.database();

// 現在の指名状況を監視
function initializeMainScreen() {
    const nominationsRef = db.ref('draft/nominations');
    
    nominationsRef.on('value', (snapshot) => {
        const data = snapshot.val();
        console.log('Received data:', data); // デバッグ用
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
    console.log('Current round data:', roundData); // デバッグ用

    if (roundData) {
        // リストグループのコンテナを作成
        const listGroup = document.createElement('div');
        listGroup.className = 'list-group';
        
        Object.entries(roundData).forEach(([teamId, nomination]) => {
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
        console.log('No data for history'); // デバッグ用
        return;
    }

    console.log('Updating history with data:', data); // デバッグ用

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

// 抽選負けチームの設定
function setLostTeam() {
    const teamId = document.getElementById('lostTeamSelect').value;
    if (!teamId) return;

    const currentRound = document.getElementById('current-round').textContent;
    const roundRef = db.ref(`draft/nominations/round${currentRound}/${teamId}`);
    
    roundRef.update({
        status: 'lost_lottery',
        canReselect: true
    }).then(() => {
        alert('再指名権を付与しました');
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
