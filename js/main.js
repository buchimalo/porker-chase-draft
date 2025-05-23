// js/main.js
const db = firebase.database();

// デバッグ用：接続確認
db.ref('.info/connected').on('value', (snap) => {
    console.log('データベース接続状態:', snap.val());
});

// データ構造確認
db.ref('/').once('value', (snapshot) => {
    console.log('ルートデータ:', snapshot.val());
});

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    currentRoundSpan.textContent = newRound;
    // ルートとdraftの両方に設定
    const updates = {
        '/currentRound': newRound,
        '/draft/currentRound': newRound
    };
    db.ref().update(updates);
}

// 現在の指名状況を監視
function initializeMainScreen() {
    // チーム情報を取得
    db.ref('/draft/teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        console.log('チームデータ取得:', teamsData);
        if (teamsData) {
            // チェックボックスを更新
            updateTeamCheckboxes(teamsData);
            updateDisplay(teamsData);
        }
    });

    // 巡目の監視（ルートパス）
    db.ref('/currentRound').on('value', (snapshot) => {
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
function updateDisplay(teamsData) {
    const nominationsList = document.getElementById('nominations-list');
    if (!nominationsList) return;

    nominationsList.innerHTML = '';
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const div = document.createElement('div');
        div.className = 'list-group-item';

        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${team.name}</strong>: 
                    <span class="nomination-player">
                        ${team.players ? Object.values(team.players).map(p => p.name).join(', ') : '未指名'}
                    </span>
                </div>
            </div>
        `;

        listGroup.appendChild(div);
    });

    nominationsList.appendChild(listGroup);
    updateHistory(teamsData);
}

// 履歴の更新
function updateHistory(teamsData) {
    const historyBody = document.getElementById('history-body');
    if (!historyBody) return;

    historyBody.innerHTML = '';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        if (team.players) {
            Object.entries(team.players).forEach(([playerId, player]) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${player.round || '-'}巡目</td>
                    <td>${team.name}</td>
                    <td>${player.name}</td>
                    <td>完了</td>
                `;
                historyBody.appendChild(row);
            });
        }
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

    const updates = {};
    lostTeams.forEach(teamId => {
        updates[`draft/teams/${teamId}/status`] = 'lost_lottery';
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

// ドラフトリセット機能
function resetDraft() {
    if (confirm('本当にドラフトをリセットしますか？\n全チームの指名選手が削除されます。\nこの操作は取り消せません。')) {
        db.ref('draft/teams').once('value', (snapshot) => {
            const teams = snapshot.val();
            const updates = {};
            
            Object.keys(teams).forEach(teamId => {
                updates[`draft/teams/${teamId}/players`] = null;
            });
            
            db.ref().update(updates)
                .then(() => {
                    alert('ドラフトがリセットされました');
                    location.reload(); // ページを再読み込み
                })
                .catch(error => {
                    console.error('Reset error:', error);
                    alert('エラーが発生しました: ' + error.message);
                });
        });
    }
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);

// デバッグ用：データ確認
db.ref('draft/teams').once('value', (snapshot) => {
    console.log('現在のチームデータ:', snapshot.val());
});
