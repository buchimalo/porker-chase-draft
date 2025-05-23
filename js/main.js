// js/main.js
const db = firebase.database();

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    currentRoundSpan.textContent = newRound;
    db.ref('currentRound').set(newRound);
}

// 現在の指名状況を監視
function initializeMainScreen() {
    // チーム情報を取得
    db.ref('teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            // チェックボックスを更新
            updateTeamCheckboxes(teamsData);
            updateDisplay(teamsData);
        }
    });

    // 巡目の監視
    db.ref('currentRound').on('value', (snapshot) => {
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
            Object.entries(team.players)
                .sort((a, b) => a[1].round - b[1].round) // 巡目順にソート
                .forEach(([playerId, player]) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${player.round}巡目</td>
                        <td>${team.name}</td>
                        <td>${player.name}</td>
                        <td>${player.status === 'lost_lottery' ? '抽選負け' : '完了'}</td>
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
        updates[`teams/${teamId}/status`] = 'lost_lottery';
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
        // まず、全チームのデータを取得
        db.ref('teams').once('value')
            .then((snapshot) => {
                const teams = snapshot.val();
                if (!teams) {
                    throw new Error('チームデータが見つかりません');
                }

                // 各チームのplayersを削除するupdatesを作成
                const updates = {};
                Object.keys(teams).forEach(teamId => {
                    updates[`teams/${teamId}/players`] = null;
                    updates[`teams/${teamId}/status`] = null;
                });

                // 一括更新を実行
                return db.ref().update(updates);
            })
            .then(() => {
                console.log('リセット成功'); // デバッグ用
                alert('ドラフトがリセットされました');
                location.reload(); // ページを再読み込み
            })
            .catch((error) => {
                console.error('リセットエラー:', error); // デバッグ用
                alert('リセット中にエラーが発生しました: ' + error.message);
            });
    }
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);

// デバッグ用：データ確認
db.ref('teams').once('value', (snapshot) => {
    console.log('現在のチームデータ:', snapshot.val());
});
