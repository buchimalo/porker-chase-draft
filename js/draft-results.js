// js/draft-results.js
const db = firebase.database();

function initializeResults() {
    // チーム情報とドラフトデータを同時に取得
    Promise.all([
        db.ref('draft/teams').once('value'),
        db.ref('draft/nominations').on('value')
    ]).then(([teamsSnapshot, nominationsSnapshot]) => {
        const teamsData = teamsSnapshot.val();
        const nominationsData = nominationsSnapshot.val();
        updateResults(teamsData, nominationsData);
    });

    // リアルタイム更新のリスナー
    db.ref('draft/nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        db.ref('draft/teams').once('value').then((teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            updateResults(teamsData, nominationsData);
        });
    });
}

function updateResults(teamsData, nominationsData) {
    const container = document.getElementById('results-container');
    container.innerHTML = '';

    // 各チームの結果を表示
    Object.entries(teamsData).forEach(([teamId, team]) => {
        const col = document.createElement('div');
        col.className = `col-md team-color-${teamId.replace('team', '')}`;
        
        let nominations = [];
        // 全ラウンドの指名を収集
        if (nominationsData) {
            for (let round = 1; round <= 6; round++) {
                const roundData = nominationsData[`round${round}`];
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
        col.innerHTML = `
            <div class="card mb-4">
                <div class="card-header">
                    <h4>${team.name}</h4>
                </div>
                <div class="card-body">
                    <ul class="list-group list-group-flush">
                        ${nominations.map(nom => `
                            <li class="list-group-item">
                                ${nom.round}巡目: 
                                ${nom.status === 'lost_lottery' ? 
                                    `<s>${nom.player}</s> <span class="badge bg-warning">抽選負け</span>` : 
                                    nom.player}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;

        container.appendChild(col);
    });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeResults);