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

// 指名リストの更新
function updateNominationsList(data) {
    const nominationsList = document.getElementById('nominations-list');
    nominationsList.innerHTML = '';

    if (!data) return;

    // 現在の巡回の指名のみを表示
    const currentRound = document.getElementById('current-round').textContent;
    const roundData = data[`round${currentRound}`];

    if (roundData) {
        Object.entries(roundData).forEach(([teamId, nomination]) => {
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item';
            
            listItem.innerHTML = `
                ${nomination.teamName}: 
                <span class="nomination-player ${nomination.status}">
                    ${nomination.playerName}
                </span>
            `;
            
            nominationsList.appendChild(listItem);
        });
    }
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);