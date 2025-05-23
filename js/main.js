// js/main.js
const db = firebase.database();

// デバッグログを追加
console.log('main.js 読み込み開始');

// 巡目変更機能
function changeRound(delta) {
    console.log('巡目変更: delta =', delta); // デバッグ用
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    currentRoundSpan.textContent = newRound;
    db.ref('currentRound').set(newRound)
        .then(() => console.log('巡目更新成功:', newRound)) // デバッグ用
        .catch(error => console.error('巡目更新エラー:', error)); // デバッグ用
}

// 現在の指名状況を監視
function initializeMainScreen() {
    console.log('画面初期化開始'); // デバッグ用
    
    // チーム情報を取得
    db.ref('teams').on('value', (snapshot) => {
        console.log('チームデータ取得:', snapshot.val()); // デバッグ用
        const teamsData = snapshot.val();
        if (teamsData) {
            console.log('チームデータあり:', Object.keys(teamsData)); // デバッグ用
            // チェックボックスを更新
            updateTeamCheckboxes(teamsData);
            updateDisplay(teamsData);
        } else {
            console.log('チームデータなし'); // デバッグ用
        }
    }, (error) => {
        console.error('チームデータ取得エラー:', error); // デバッグ用
    });

    // 巡目の監視
    db.ref('currentRound').on('value', (snapshot) => {
        console.log('現在の巡目:', snapshot.val()); // デバッグ用
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });
}

// 以下の関数はそのまま...

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded発火'); // デバッグ用
    initializeMainScreen();
});

// 即時実行のデバッグテスト
console.log('データベース接続テスト開始'); // デバッグ用
db.ref('.info/connected').on('value', (snap) => {
    console.log('データベース接続状態:', snap.val());
});

db.ref('teams').once('value')
    .then(snapshot => {
        console.log('チームデータ取得テスト:', snapshot.val());
    })
    .catch(error => {
        console.error('チームデータ取得エラー:', error);
    });
