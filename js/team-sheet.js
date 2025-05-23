// js/team-sheet.js
const db = firebase.database();
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
    
    // チーム情報を取得してから保存
    db.ref('teams/' + currentTeamId).once('value', function(snapshot) {
        const teamData = snapshot.val();
        
        const playerData = {
            name: playerName,  // playerNameではなくnameを使用
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
    });
}

// チームの指名履歴を更新
function updateTeamHistory(teamData) {
    const historyContainer = document.getElementById('team-history');
    if (!historyContainer) return;

    historyContainer.innerHTML = '';

    if (teamData.players) {
        Object.entries(teamData.players)
            .sort((a, b) => a[1].round - b[1].round) // 巡目順にソート
            .forEach(function([playerId, player]) {
                const listItem = document.createElement('div');
                listItem.className = 'list-group-item';
                
                let status = player.status === 'lost_lottery' ? '抽選負け' : '完了';

                listItem.innerHTML = 
                    player.round + '巡目: ' +
                    '<span class="nomination-player ' + player.status + '">' +
                    player.name +  // playerNameではなくnameを使用
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
