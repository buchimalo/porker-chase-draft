// js/main.js
const db = firebase.database();

// 巡目変更機能
function changeRound(delta) {
    const currentRoundSpan = document.getElementById('current-round');
    let newRound = parseInt(currentRoundSpan.textContent) + delta;
    
    // 1-6巡の範囲内に制限
    if (newRound < 1) newRound = 1;
    if (newRound > 6) newRound = 6;
    
    // 巡目をFirebaseに保存
    db.ref('draft/currentRound').set(newRound);
}

// 現在の指名状況を監視
function initializeMainScreen() {
    // チーム情報とデータの同期取得
    Promise.all([
        db.ref('draft/teams').get(),
        db.ref('draft/nominations').get()
    ]).then(([teamsSnapshot, nominationsSnapshot]) => {
        const teamsData = teamsSnapshot.val();
        const nominationsData = nominationsSnapshot.val();
        
        // チェックボックスの更新
        updateTeamCheckboxes(teamsData);
        // 画面表示の更新
        updateNominationsList(teamsData, nominationsData);
        updateHistory(teamsData, nominationsData);
    });

    // リアルタイム監視を設定
    db.ref('draft/nominations').on('value', (snapshot) => {
        const nominationsData = snapshot.val();
        db.ref('draft/teams').get().then((teamsSnapshot) => {
            const teamsData = teamsSnapshot.val();
            updateNominationsList(teamsData, nominationsData);
            updateHistory(teamsData, nominationsData);
        });
    });

    // 巡目の監視
    db.ref('draft/currentRound').on('value', (snapshot) => {
        const round = snapshot.val() || 1;
        document.getElementById('current-round').textContent = round;
    });
}

// チーム選択のチェックボックスを更新
function updateTeamCheckboxes(teamsData) {
    const container = document.querySelector('.lost-teams-checkboxes');
    if (!container) return;

    container.innerHTML = '';
    Object.entries(teamsData).forEach(([teamId, team]) => {
        const div = document.createElement('div');
        div.className = 'form-check';
        div.innerHTML = `
            <input class="form-check-input" type="checkbox" name="lostTeams" value="${teamId}" id="${teamId}Check">
            <label class="form-check-label" for="${teamId}Check">${team.name}</label>
        `;
        container.appendChild(div);
    });
}

// 指名リストの更新
function updateNominationsList(teamsData, nominationsData) {
    const nominationsList = document.getElementById('nominations-list');
    const currentRound = document.getElementById('current-round').textContent;
    const roundData = nominationsData[`round${currentRound}`] || {};

    nominationsList.innerHTML = '';
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    // 全チームについて処理
    Object.entries(teamsData).forEach(([teamId, team]) => {
        const nomination = roundData[teamId];
        const div = document.createElement('div');
        div.className = 'list-group-item d-flex justify-content-between align-items-center';

        let playerDisplay = nomination ? nomination.playerName : '未指名';
        let statusBadge = '';

        if (nomination && nomination.status === 'lost_lottery') {
            statusBadge = '<span class="badge bg-warning ms-2">抽選負け - 再指名待ち</span>';
            playerDisplay = `<s>${playerDisplay}</s>`;
        }

        div.innerHTML = `
            <div>
                <strong>${team.name}</strong>: 
                <span class="nomination-player">
                    ${playerDisplay}
                </span>
            </div>
            ${statusBadge}
        `;

        listGroup.appendChild(div);
    });

    nominationsList.appendChild(listGroup);
}

// 指名履歴の更新
function updateHistory(teamsData, nominationsData) {
    const historyBody = document.getElementById('history-body');
    historyBody.innerHTML = '';

    // 各ラウンドのデータを処理
    Object.keys(nominationsData)
        .sort((a, b) => a.localeCompare(b))
        .forEach(round => {
            const roundData = nominationsData[round];
            if (!roundData) return;

            const roundNumber = round.replace('round', '');

            Object.entries(roundData).forEach(([teamId, nomination]) => {
                if (!nomination || !nomination.playerName) return;

                const row = document.createElement('tr');
                const team = teamsData[teamId];
                
                let status = nomination.status === 'lost_lottery' ? '抽選負け' : '完了';

                row.innerHTML = `
                    <td>${roundNumber}巡目</td>
                    <td>${team.name}</td>
                    <td>${nomination.playerName}</td>
                    <td>${status}</td>
                `;

                historyBody.appendChild(row);
            });
        });
}

// 抽選負けチームの設定
function setLostTeams() {
    const checkboxes = document.querySelectorAll('input[name="lostTeams"]:checked');
    const lostTeams = Array.from(checkboxes).map(cb => cb.value);
    
    if (lostTeams.length === 0) {
        alert('抽選負けのチームを選択してください');
        return;
    }

    const currentRound = document.getElementById('current-round').textContent;
    const updates = {};

    lostTeams.forEach(teamId => {
        updates[`draft/nominations/round${currentRound}/${teamId}/status`] = 'lost_lottery';
        updates[`draft/nominations/round${currentRound}/${teamId}/canReselect`] = true;
    });

    db.ref().update(updates)
        .then(() => {
            alert(`${lostTeams.length}チームに再指名権を付与しました`);
            checkboxes.forEach(cb => cb.checked = false);
        })
        .catch(error => {
            console.error('Update error:', error);
            alert('エラーが発生しました: ' + error.message);
        });
}

// 画面読み込み時に初期化
document.addEventListener('DOMContentLoaded', initializeMainScreen);
