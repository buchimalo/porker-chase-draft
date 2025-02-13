// js/team-sheet.js
const db = firebase.database();
let currentTeamId = null;
let currentRound = 1;

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
    const teamRef = db.ref(`draft/teams/${currentTeamId}`);
    teamRef.once('value', (snapshot) => {
        const teamData = snapshot.val();
        if (teamData) {
            document.getElementById('team-name').textContent = teamData.name;
        }
    });

    // 指名履歴の監視
    const nominationsRef = db.ref(`draft/nominations`);
    nominationsRef.on('value', (snapshot) => {
        updateTeamHistory(snapshot.val());
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
    const nominationRef = db.ref(`draft/nominations/round${currentRound}/${currentTeamId}`);
    
    nominationRef.set({
        playerName: playerName,
        teamName: document.getElementById('team-name').textContent,
        timestamp: Date.now(),
        status: 'confirmed'
    }).then(() => {
        document.getElementById('player-name').value = '';
        const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
        modal.hide();
        showAlert('指名を送信しました', 'success');
    }).catch((error) => {
        showAlert('エラーが発生しました: ' + error.message, 'danger');
    });
}

// アラート表示
function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const container = document.querySelector('.nomination-form');
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 3000);
}

// チームの指名履歴を更新
function updateTeamHistory(nominationsData) {
    const historyContainer = document.getElementById('team-history');
    historyContainer.innerHTML = '';

    if (!nominationsData) return;

    Object.entries(nominationsData).forEach(([round, roundData]) => {
        if (roundData[currentTeamId]) {
            const nomination = roundData[currentTeamId];
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item';
            listItem.innerHTML = `
                ${round.replace('round', '')}巡目: 
                <span class="nomination-player ${nomination.status}">
                    ${nomination.playerName}
                </span>
            `;
            historyContainer.appendChild(listItem);
        }
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeTeamSheet);