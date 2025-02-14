// js/main.js
const db = firebase.database();

// 現在の指名状況を監視
function initializeMainScreen() {
    const nominationsRef = db.ref('draft/nominations');
    
    nominationsRef.on('value', (snapshot) => {
        const data = snapshot.val();
        updateNominationsList(data);
    });
}

// 指名リストの更新（この関数を置き換え）
function updateNominationsList(data) {
    const nominationsList = document.getElementById('nominations-list');
    nominationsList.innerHTML = '';

    if (!data) return;

    const currentRound = document.getElementById('current-round').textContent;
    const roundData = data[`round${currentRound}`];

    if (roundData) {
        Object.entries(roundData).forEach(([teamId, nomination]) => {
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item';
            
            let statusBadge = '';
            if (nomination.status === 'lost_lottery') {
                statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
            }

            listItem.innerHTML = `
                ${nomination.teamName}: 
                <span class="nomination-player">
                    ${nomination.playerName}
                </span>
                ${statusBadge}
            `;
            
            nominationsList.appendChild(listItem);
        });
    }
}

// 抽選負けチームの設定（この関数を追加）
function setLostTeam() {
    const teamId = document.getElementById('lostTeamSelect').value;
    if (!teamId) return;

    const currentRound = document.getElementById('current-round').textContent;
    const roundRef = db.ref(`draft/nominations/round${currentRound}/${teamId}`);
    
    roundRef.update({
        status: 'lost_lottery',
        canReselect: true
    }).then(() => {
        alert('再指名権を付与しました');
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
