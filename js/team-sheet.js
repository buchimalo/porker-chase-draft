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
    db.ref('draft/teams/' + currentTeamId).on('value', function(snapshot) {
        const teamData = snapshot.val();
        if (teamData) {
            document.getElementById('team-name').textContent = teamData.name;
        }
    });

    // 巡目の監視
    db.ref('draft/currentRound').on('value', function(snapshot) {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });

    // 指名履歴の監視
    db.ref('draft/nominations').on('value', function(snapshot) {
        const nominationsData = snapshot.val();
        updateTeamHistory(nominationsData);
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
    
    db.ref('draft/teams/' + currentTeamId).once('value', function(snapshot) {
        const teamData = snapshot.val();
        const teamName = teamData ? teamData.name : currentTeamId;
        
        const nominationRef = db.ref('draft/nominations/round' + currentRound + '/' + currentTeamId);
        
        nominationRef.set({
            playerName: playerName,
            teamName: teamName,
            timestamp: Date.now(),
            status: 'confirmed'
        }).then(function() {
            document.getElementById('player-name').value = '';
            const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
            modal.hide();
            showAlert('指名を送信しました', 'success');
        }).catch(function(error) {
            showAlert('エラーが発生しました: ' + error.message, 'danger');
        });
    });
}

// チームの指名履歴を更新
function updateTeamHistory(nominationsData) {
    const historyContainer = document.getElementById('team-history');
    if (!historyContainer || !nominationsData) return;

    historyContainer.innerHTML = '';

    Object.entries(nominationsData).forEach(function([round, roundData]) {
        if (roundData && roundData[currentTeamId]) {
            const nomination = roundData[currentTeamId];
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item';
            
            let status = nomination.status === 'lost_lottery' ? '抽選負け' : '完了';

            listItem.innerHTML = 
                round.replace('round', '') + '巡目: ' +
                '<span class="nomination-player ' + nomination.status + '">' +
                nomination.playerName +
                '</span>' +
                '<span class="badge bg-secondary">' + status + '</span>';
            
            historyContainer.appendChild(listItem);
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
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(function() {
        alertDiv.remove();
    }, 3000);
}

// 結果表示機能（既存のコードの最後、初期化の前に追加）
function showResults() {
    const container = document.getElementById('results-container');
    container.innerHTML = '';

    // チーム情報とドラフトデータを取得
    db.ref('draft/teams').once('value', function(snapshot) {
        const teamsData = snapshot.val();
        if (teamsData) {
            db.ref('draft/nominations').once('value', function(nominationsSnapshot) {
                const nominationsData = nominationsSnapshot.val() || {};
                
                // 各チームの結果を表示
                Object.entries(teamsData).forEach(function([teamId, team]) {
                    const col = document.createElement('div');
                    col.className = 'col-md team-color-' + teamId.replace('team', '');
                    
                    let nominations = [];
                    // 全ラウンドの指名を収集
                    if (nominationsData) {
                        for (let round = 1; round <= 6; round++) {
                            const roundData = nominationsData['round' + round];
                            if (roundData && roundData[teamId]) {
                                nominations.push({
                                    round: round,
                                    player: roundData[teamId].playerName,
                                    status: roundData[teamId].status
                                });
                            }
                        }
                    }

                    // チームの結果カードを作成
                    let nominationsList = '';
                    nominations.forEach(function(nom) {
                        let playerDisplay = nom.status === 'lost_lottery' ? 
                            '<s>' + nom.player + '</s> <span class="badge bg-warning">抽選負け</span>' : 
                            nom.player;
                        nominationsList += '<li class="list-group-item">' + 
                            nom.round + '巡目: ' + playerDisplay + '</li>';
                    });

                    col.innerHTML = 
                        '<div class="card mb-4">' +
                            '<div class="card-header">' +
                                '<h4>' + team.name + '</h4>' +
                            '</div>' +
                            '<div class="card-body">' +
                                '<ul class="list-group list-group-flush">' +
                                    nominationsList +
                                '</ul>' +
                            '</div>' +
                        '</div>';

                    container.appendChild(col);
                });

                // モーダルを表示
                const modal = new bootstrap.Modal(document.getElementById('resultsModal'));
                modal.show();
            });
        }
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeTeamSheet);
