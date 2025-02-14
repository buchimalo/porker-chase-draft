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
    db.ref(`draft/teams/${currentTeamId}`).once('value', (snapshot) => {
        const teamData = snapshot.val();
        if (teamData) {
            document.getElementById('team-name').textContent = teamData.name;
        }
    });

    // 巡目の監視
    db.ref('draft/currentRound').on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });

    // 指名履歴の監視
    db.ref('draft/nominations').on('value', (snapshot) => {
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
    
    db.ref(`draft/teams/${currentTeamId}`).once('value', (snapshot) => {
        const teamData = snapshot.val();
        const teamName = teamData ? teamData.name : currentTeamId;
        
        const nominationRef = db.ref(`draft/nominations/round${currentRound}/${currentTeamId}`);
        
        nominationRef.set({
            playerName: playerName,
            teamName: teamName,
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
    });
}

// チームの指名履歴を更新
function updateTeamHistory(nominationsData) {
    const historyContainer = document.getElementById('team-history');
    if (!historyContainer || !nominationsData) return;

    historyContainer.innerHTML = '';

    Object<span class="ml-2" /><span class="inline-block w-3 h-3 rounded-full bg-neutral-a12 align-middle mb-[0.1rem]" />
