// js/draft-results.js
const db = firebase.database();

function initializeResults() {
    // チーム情報の監視
    db.ref('draft/teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            // 指名データを取得
            db.ref('draft/nominations').once('value', (nominationsSnapshot) => {
                const nominationsData = nominationsSnapshot.val() || {};
                updateResults(teamsData, nominationsData);
            });
        }
    });

    // 指名データの監視
    db.ref('draft/nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        db.ref('draft/teams').once('value', (teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            if (teamsData) {
                updateResults(teamsData, nominationsData);
            }
        });
    });
}

function updateResults(teamsData, nominationsData) {
    const container = document.getElementById('results-container');
    container.innerHTML = '';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const col = document.createElement('div');
        col.className = 'col-md-2 mb-4';

        let nominationsList = '';
        for (let round = 1; round <= 6; round++) {
            const roundData = nominationsData[`round${round}`];
            if (roundData && roundData[teamId]) {
                const nomination = roundData[teamId];
                const playerDisplay = nomination.status === 'lost_lottery' ? 
                    `<s>${nomination.playerName}</s> <span class="badge bg-warning">抽選負け</span>` : 
                    nomination.playerName;
                nominationsList += `<li class="list-group-item">${round}巡目: ${playerDisplay}</li>`;
            }
        }

        col.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h5 class="mb-0">${team.name}</h5>
                </div>
                <div class="card-body p-0">
                    <ul class="list-group list-group-flush">
                        ${nominationsList || '<li class="list-group-item">指名なし</li>'}
                    </ul>
                </div>
            </div>
        `;

        container.appendChild(col);
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeResults);
