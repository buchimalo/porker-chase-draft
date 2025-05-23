// js/main.js
const db = firebase.database();

// デバッグログを追加
console.log('main.js 読み込み開始');

// 巡目変更機能
function changeRound(delta) {
    console.log('巡目変更: delta =', delta); // デバッグ用
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    currentRoundSpan.textContent = newRound;
    db.ref('currentRound').set(newRound)
        .then(() => console.log('巡目更新成功:', newRound)) // デバッグ用
        .catch(error => console.error('巡目更新エラー:', error)); // デバッグ用
}

// 現在の指名状況を監視
function initializeMainScreen() {
    console.log('画面初期化開始'); // デバッグ用
    
    // チーム情報とノミネーション情報を同時に監視
    db.ref('teams').on('value', (snapshot) => {
        console.log('チームデータ取得:', snapshot.val()); // デバッグ用
        const teamsData = snapshot.val();
        if (teamsData) {
            console.log('チームデータあり:', Object.keys(teamsData)); // デバッグ用
            // チェックボックスを更新
            updateTeamCheckboxes(teamsData);
            
            // nominationsデータも取得して表示を更新
            db.ref('nominations').once('value', (nominationsSnapshot) => {
                const nominationsData = nominationsSnapshot.val();
                console.log('ノミネーションデータ:', nominationsData); // デバッグ用
                updateDisplay(teamsData, nominationsData);
            });
        } else {
            console.log('チームデータなし'); // デバッグ用
        }
    }, (error) => {
        console.error('チームデータ取得エラー:', error); // デバッグ用
    });

    // nominationsの監視も追加
    db.ref('nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        db.ref('teams').once('value', (teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            if (teamsData) {
                updateDisplay(teamsData, nominationsData);
            }
        });
    });

    // 巡目の監視
    db.ref('currentRound').on('value', (snapshot) => {
        console.log('現在の巡目:', snapshot.val()); // デバッグ用
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });
}

// チーム選択のチェックボックスを更新
function updateTeamCheckboxes(teamsData) {
    const container = document.querySelector('.lost-teams-checkboxes');
    if (!container) {
        console.error('チェックボックスコンテナが見つかりません'); // デバッグ用
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
    const nominationsList = document.getElementById('nominations-list');
    if (!nominationsList) {
        console.error('nominations-list要素が見つかりません'); // デバッグ用
        return;
    }

    const currentRound = document.getElementById('current-round').textContent;
    console.log('現在の巡目での表示更新:', currentRound); // デバッグ用

    nominationsList.innerHTML = '';
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const div = document.createElement('div');
        div.className = 'list-group-item';

        // 現在の巡目の指名情報を取得
        let playerInfo = '未指名';
        let statusBadge = '';
        
        if (nominationsData && nominationsData[`round${currentRound}`] && nominationsData[`round${currentRound}`][teamId]) {
            const nomination = nominationsData[`round${currentRound}`][teamId];
            playerInfo = nomination.playerName;
            if (nomination.status === 'lost_lottery') {
                statusBadge = '<span class="badge bg-warning ms-2">抽選負け</span>';
                playerInfo = `<s>${playerInfo}</s>`;
            }
        }

        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${team.name}</strong>: 
                    <span class="nomination-player">
                        ${playerInfo}
                    </span>
                    ${statusBadge}
                </div>
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
    if (!historyBody) {
        console.error('history-body要素が見つかりません'); // デバッグ用
        return;
    }

    historyBody.innerHTML = '';

    if (nominationsData) {
        Object.entries(nominationsData).forEach(([round, roundData]) => {
            const roundNumber = round.replace('round', '');
            Object.entries(roundData).forEach(([teamId, nomination]) => {
                const team = teamsData[teamId];
                if (team && nomination.playerName) {
                    const row = document.createElement('tr');
                    let status = nomination.status === 'lost_lottery' ? '抽選負け' : '完了';
                    
                    row.innerHTML = `
                        <td>${roundNumber}巡目</td>
                        <td>${team.name}</td>
                        <td>${nomination.playerName}</td>
                        <td>${status}</td>
                    `;
                    
                    historyBody.appendChild(row);
                }
            });
        });
    }
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
        updates[`nominations/round${currentRound}/${teamId}/status`] = 'lost_lottery';
    });

    db.ref().update(updates)
        .then(() => {
            alert(`${lostTeams.length}チームに再指名権を付与しました`);
            checkboxes.forEach(cb => cb.checked = false);
            console.log('抽選負け設定成功'); // デバッグ用
        })
        .catch(error => {
            console.error('Update error:', error);
            alert('エラーが発生しました: ' + error.message);
        });
}

// ドラフトリセット機能
function resetDraft() {
    if (confirm('本当にドラフトをリセットしますか？\n全チームの指名選手が削除されます。\nこの操作は取り消せません。')) {
        const updates = {
            'nominations': null,
            'currentRound': 1
        };
        
        Object.keys(teams).forEach(teamId => {
            updates[`teams/${teamId}/players`] = null;
        });
        
        db.ref().update(updates)
            .then(() => {
                alert('ドラフトがリセットされました');
                location.reload();
                console.log('リセット成功'); // デバッグ用
            })
            .catch(error => {
                console.error('Reset error:', error);
                alert('エラーが発生しました: ' + error.message);
            });
    }
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded発火'); // デバッグ用
    initializeMainScreen();
});

// 即時実行のデバッグテスト
console.log('データベース接続テスト開始'); // デバッグ用
db.ref('.info/connected').on('value', (snap) => {
    console.log('データベース接続状態:', snap.val());
});

db.ref('teams').once('value')
    .then(snapshot => {
        console.log('チームデータ取得テスト:', snapshot.val());
    })
    .catch(error => {
        console.error('チームデータ取得エラー:', error);
    });
