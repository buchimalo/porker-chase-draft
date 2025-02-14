// js/main.js の initializeMainScreen 関数を修正
function initializeMainScreen() {
    log('Initializing main screen');

    // データベース全体を一度取得して確認
    db.ref('/').once('value').then(snapshot => {
        const data = snapshot.val();
        log('All database data:', data);

        // チーム情報を取得
        const teamsData = data.teams;
        if (teamsData) {
            updateTeamCheckboxes(teamsData);
            updateDisplay(teamsData, data.nominations || {});
        }

        // 現在の巡を設定
        const currentRound = data.currentRound || 1;
        document.getElementById('current-round').textContent = currentRound;
    });

    // チーム情報の監視
    db.ref('/teams').on('value', (snapshot) => {
        const teamsData = snapshot.val();
        log('Teams updated', teamsData);
        if (teamsData) {
            updateTeamCheckboxes(teamsData);
        }
    });

    // 指名データの監視
    db.ref('/nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        log('Nominations updated', nominationsData);
        
        // チーム情報と組み合わせて表示を更新
        db.ref('/teams').once('value', (teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            if (teamsData) {
                updateDisplay(teamsData, nominationsData);
            }
        });
    });

    // 巡目の監視
    db.ref('/currentRound').on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        log('Current round updated', round);
        document.getElementById('current-round').textContent = round;
    });
}
