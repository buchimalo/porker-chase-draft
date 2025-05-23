// js/draft-results.js
const db = firebase.database();

function initializeResults() {
    console.log('結果初期化開始'); // デバッグ用
    
    // チーム情報を取得
    db.ref('teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        console.log('取得したチームデータ:', teamsData); // デバッグ用
        
        if (teamsData) {
            updateResults(teamsData);
        } else {
            console.log('チームデータが存在しません'); // デバッグ用
        }
    });
}

function updateResults(teamsData) {
    const container = document.getElementById('results-container');
    if (!container) {
        console.error('results-container要素が見つかりません'); // デバッグ用
        return;
    }
    
    console.log('結果更新開始'); // デバッグ用
    container.innerHTML = '';

    // 各チームの結果を表示
    Object.entries(teamsData).forEach(([teamId, team]) => {
        console.log(`チーム処理: ${teamId}`, team); // デバッグ用
        
        const col = document.createElement('div');
        col.className = `col-md team-color-${teamId.replace('team', '')}`;
        
        // 指名選手を巡目順にソート
        let players = [];
        if (team.players) {
            players = Object.entries(team.players)
                .map(([playerId, player]) => player)
                .sort((a, b) => a.round - b.round);
        }
        
        // チームの結果カードを作成
        col.innerHTML = `
            <div class="card mb-4">
                <div class="card-header">
                    <h4>${team.name || 'チーム名なし'}</h4>
                </div>
                <div class="card-body">
                    <ul class="list-group list-group-flush">
                        ${players.length > 0 
                            ? players.map(player => `
                                <li class="list-group-item">
                                    ${player.round}巡目: ${player.name}
                                    ${player.status === 'lost_lottery' 
                                        ? '<span class="badge bg-warning ms-2">抽選負け</span>' 
                                        : ''}
                                </li>
                            `).join('')
                            : '<li class="list-group-item">指名選手なし</li>'}
                    </ul>
                </div>
            </div>
        `;

        container.appendChild(col);
    });
    
    console.log('結果更新完了'); // デバッグ用
}

// リアルタイムデータ監視
db.ref('teams').on('value', (snapshot) => {
    console.log('リアルタイム更新 - チームデータ:', snapshot.val()); // デバッグ用
});

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('ページ読み込み完了'); // デバッグ用
    initializeResults();
});
