// js/draft-results.js
const db = firebase.database();

function initializeResults() {
    // チーム情報を取得
    db.ref('teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            displayResults(teamsData);
        }
    });
}

function displayResults(teamsData) {
    const container = document.getElementById('results-container');
    if (!container) {
        console.error('results-container not found');
        return;
    }
    
    container.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row';

    Object.entries(teamsData).forEach(([teamId, team]) => {
        const col = document.createElement('div');
        col.className = 'col-md-4 mb-4';

        let playersList = '';
        if (team.players) {
            const sortedPlayers = Object.entries(team.players)
                .map(([_, player]) => player)
                .sort((a, b) => Number(a.round) - Number(b.round));

            playersList = sortedPlayers.map(player => `
                <li class="list-group-item">
                    ${player.round}巡目: ${player.name}
                    ${player.status === 'lost_lottery' ? 
                        '<span class="badge bg-warning ms-2">抽選負け</span>' : 
                        ''}
                </li>
            `).join('');
        }

        col.innerHTML = `
            <div class="card h-100">
                <div class="card-header bg-primary text-white">
                    <h5 class="card-title mb-0">${team.name}</h5>
                </div>
                <div class="card-body p-0">
                    <ul class="list-group list-group-flush">
                        ${playersList || '<li class="list-group-item">指名選手なし</li>'}
                    </ul>
                </div>
            </div>
        `;

        row.appendChild(col);
    });

    container.appendChild(row);
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeResults);

// デバッグ用：データ取得の確認
db.ref('teams').once('value', (snapshot) => {
    console.log('現在のチームデータ:', snapshot.val());
});
