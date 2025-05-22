// js/team-sheet.js
const db = firebase.database();
let currentTeamId = null;

// チームIDをURLから取得
function getTeamIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('team');
}

// チーム情報の初期化
function initializeTeamSheet() {
    currentTeamId = getTeamIdFromUrl();
    if (!currentTeamId) {
        alert('チームIDが指定されていません');
        return;
    }

    // チーム名の取得と表示
    db.ref('teams/' + currentTeamId).on('value', function(snapshot) {
        const teamData = snapshot.val();
        if (teamData) {
            document.getElementById('team-name').textContent = teamData.name;
            updateTeamHistory(teamData);
        }
    });

    // 巡目の監視
    db.ref('currentRound').on('value', function(snapshot) {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });
}

// 指名送信前の確認
function submitNomination() {
    const playerName = document.getElementById('player-name').value.trim();
    
    if (!playerName) {
        showAlert('選手名を入力してください', 'danger');
        return;
    }

    document.getElementById('confirmPlayerName').textContent = playerName;
    const modal = new bootstrap.Modal(document.getElementById('confirmModal'));
    modal.show();
}

// 指名の確定送信
function confirmNomination() {
    const playerName = document.getElementById('player-name').value.trim();
    const currentRound = document.getElementById('current-round').textContent;
    
    const playerData = {
        name: playerName,
        round: currentRound,
        timestamp: Date.now(),
        status: 'confirmed'
    };

    // playersノードに追加
    const newPlayerRef = db.ref('teams/' + currentTeamId + '/players').push();
    
    newPlayerRef.set(playerData)
        .then(function() {
            document.getElementById('player-name').value = '';
            const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
            modal.hide();
            showAlert('指名を送信しました', 'success');
        })
        .catch(function(error) {
            showAlert('エラーが発生しました: ' + error.message, 'danger');
        });
}

// チームの指名履歴を更新
function updateTeamHistory(teamData) {
    const historyContainer = document.getElementById('team-history');
    if (!historyContainer) return;

    historyContainer.innerHTML = '';

    if (teamData.players) {
        Object.entries(teamData.players).forEach(function([playerId, player]) {
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item';
            
            let status = player.status === 'lost_lottery' ? '抽選負け' : '完了';

            listItem.innerHTML = 
                player.round + '巡目: ' +
                '<span class="nomination-player ' + player.status + '">' +
                player.name +
                '</span>' +
                '<span class="badge bg-secondary ms-2">' + status + '</span>';
            
            historyContainer.appendChild(listItem);
        });
    }
}

// アラート表示
function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-' + type + ' alert-dismissible fade show';
    alertDiv.innerHTML = 
        message +
        '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    
    const container = document.querySelector('.nomination-form');
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(function() {
        alertDiv.remove();
    }, 3000);
}

// デバッグ用：データ確認
db.ref('teams/' + getTeamIdFromUrl()).once('value', (snapshot) => {
    console.log('現在のチームデータ:', snapshot.val());
});

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeTeamSheet);
