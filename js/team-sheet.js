// js/team-sheet.js
const db = window.database;
let currentTeamId = null;

// チームIDをURLから取得
function getTeamIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const teamId = urlParams.get('team');
    console.log('取得したチームID:', teamId); // デバッグ用
    return teamId;
}

// チーム情報の初期化
function initializeTeamSheet() {
    currentTeamId = getTeamIdFromUrl();
    if (!currentTeamId) {
        alert('チームIDが指定されていません');
        return;
    }

    console.log('初期化開始 - チームID:', currentTeamId); // デバッグ用

    // チーム名の取得と表示
    db.ref('teams/' + currentTeamId).on('value', function(snapshot) {
        const teamData = snapshot.val();
        console.log('取得したチームデータ:', teamData); // デバッグ用
        
        if (teamData) {
            const teamNameElement = document.getElementById('team-name');
            if (teamNameElement) {
                teamNameElement.textContent = teamData.name;
                console.log('チーム名を設定:', teamData.name); // デバッグ用
            } else {
                console.error('team-name要素が見つかりません'); // デバッグ用
            }
            updateTeamHistory(teamData);
        } else {
            console.error('チームデータが取得できません'); // デバッグ用
        }
    });

    // 巡目の監視
    db.ref('currentRound').on('value', function(snapshot) {
        const round = snapshot.val() || 1;
        const roundElement = document.getElementById('current-round');
        if (roundElement) {
            roundElement.textContent = round;
            console.log('現在の巡目:', round); // デバッグ用
        }
    });
}

// 指名の確定送信
function confirmNomination() {
    const playerName = document.getElementById('player-name').value.trim();
    const currentRound = document.getElementById('current-round').textContent;
    
    console.log('指名開始:', playerName, '巡目:', currentRound); // デバッグ用

    const playerData = {
        playerName: playerName,  // playerNameとして保存
        name: playerName,        // nameとしても保存
        round: currentRound,
        timestamp: Date.now(),
        status: 'confirmed'
    };

    console.log('保存するデータ:', playerData); // デバッグ用

    // playersノードに追加
    const newPlayerRef = db.ref('teams/' + currentTeamId + '/players').push();
    
    newPlayerRef.set(playerData)
        .then(function() {
            console.log('指名データ保存成功:', playerData); // デバッグ用
            document.getElementById('player-name').value = '';
            const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
            modal.hide();
            showAlert('指名を送信しました', 'success');
        })
        .catch(function(error) {
            console.error('指名データ保存エラー:', error); // デバッグ用
            showAlert('エラーが発生しました: ' + error.message, 'danger');
        });
}

// 履歴の更新
function updateHistory(teamsData) {
    const historyBody = document.getElementById('history-body');
    if (!historyBody) return;

    historyBody.innerHTML = '';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        if (team.players) {
            Object.entries(team.players).forEach(([playerId, player]) => {
                console.log('プレイヤーデータ:', player); // デバッグ用
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${player.round || '-'}巡目</td>
                    <td>${team.name || '-'}</td>
                    <td>${player.playerName || player.name || '-'}</td>
                    <td>${player.status === 'lost_lottery' ? '抽選負け' : '完了'}</td>
                `;
                historyBody.appendChild(row);
            });
        }
    });
}

// アラート表示
function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-' + type + ' alert-dismissible fade show';
    alertDiv.innerHTML = 
        message +
        '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    
    const container = document.querySelector('.nomination-form');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
        
        setTimeout(function() {
            alertDiv.remove();
        }, 3000);
    } else {
        console.error('nomination-form要素が見つかりません'); // デバッグ用
    }
}

// リアルタイムデータ監視の設定
db.ref('teams/' + getTeamIdFromUrl()).on('value', (snapshot) => {
    console.log('リアルタイム更新 - チームデータ:', snapshot.val()); // デバッグ用
});

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeTeamSheet);
