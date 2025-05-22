// js/draft-results.js
const db = firebase.database();

function initializeResults() {
    // チーム情報を取得
    db.ref('teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        if (teamsData) {
            updateResults(teamsData);
        }
    });
}

function updateResults(teamsData) {
    const container = document.getElementById('results-container');
    container.innerHTML = '';

    // 各チームの結果を表示
    Object.entries(teamsData).forEach(([teamId, team]) => {
        const col = document.createElement('div');
        col.className = `col-md team-color-${teamId.replace('team', '')}`;
        
        // チームの結果カードを作成
        col.innerHTML = `
            <div class="card mb-4">
                <div class="card-header">
                    <h4>${team.name}</h4>
                </div>
                <div class="card-body">
                    <ul class="list-group list-group-flush">
                        ${team.players ? Object.entries(team.players).map(([playerId, player]) => `
                            <li class="list-group-item">
                                ${player.name}
                            </li>
                        `).join('') : ''}
                    </ul>
                </div>
            </div>
        `;

        container.appendChild(col);
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeResults);

// デバッグ用：データ取得の確認
db.ref('teams').once('value', (snapshot) => {
    console.log('現在のチームデータ:', snapshot.val());
});
