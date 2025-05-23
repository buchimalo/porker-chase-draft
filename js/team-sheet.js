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
    
    // チーム情報を取得
    db.ref('teams/' + currentTeamId).once('value', function(snapshot) {
        const teamData = snapshot.val();
        const teamName = teamData ? teamData.name : currentTeamId;
        
        // 指名データを作成
        const nominationData = {
            playerName: playerName,
            teamName: teamName,
            timestamp: Date.now(),
            status: 'confirmed',
            round: currentRound
        };

        // 指名を保存（両方のパスに保存）
        const updates = {};
        // チームのplayersに保存
        const newPlayerKey = db.ref().child('teams').child(currentTeamId).child('players').push().key;
        updates[`teams/${currentTeamId}/players/${newPlayerKey}`] = nominationData;
        // nominationsにも保存
        updates[`nominations/round${currentRound}/${currentTeamId}`] = nominationData;

        db.ref().update(updates)
            .then(function() {
                document.getElementById('player-name').value = '';
                const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
                modal.hide();
                showAlert('指名を送信しました', 'success');
                console.log('指名データ保存成功'); // デバッグ用
            })
            .catch(function(error) {
                showAlert('エラーが発生しました: ' + error.message, 'danger');
                console.error('指名データ保存エラー:', error); // デバッグ用
            });
    });
}

// チームの指名履歴を更新
function updateTeamHistory(teamData) {
    const historyContainer = document.getElementById('team-history');
    if (!historyContainer) {
        console.error('team-history要素が見つかりません'); // デバッグ用
        return;
    }

    historyContainer.innerHTML = '';
    console.log('履歴更新 - チームデータ:', teamData); // デバッグ用

    if (teamData.players) {
        Object.entries(teamData.players).forEach(function([playerId, player]) {
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item';
            
            let status = player.status === 'lost_lottery' ? '抽選負け' : '完了';

            listItem.innerHTML = 
                player.round + '巡目: ' +
                '<span class="nomination-player ' + player.status + '">' +
                (player.playerName || player.name) + // playerNameとnameの両方に対応
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
