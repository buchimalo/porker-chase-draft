// js/showdown.js — 抽選をポーカーの手札勝負で決める
//
// 公平性について:
//   勝者は最初に完全ランダム（各チーム 1/N）で決定する。
//   そのうえで「その勝者が勝つ配牌」を探し、可能なら逆転が起きるものを選ぶ。
//   演出のために勝敗を操作しているわけではないので、勝率は均等のまま。
(function (global) {
    'use strict';

    const SUITS = [
        { key: 's', mark: '♠', red: false },
        { key: 'h', mark: '♥', red: true },
        { key: 'd', mark: '♦', red: true },
        { key: 'c', mark: '♣', red: false }
    ];

    const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

    const HAND_NAMES = [
        'ハイカード',
        'ワンペア',
        'ツーペア',
        'スリーカード',
        'ストレート',
        'フラッシュ',
        'フルハウス',
        'フォーカード',
        'ストレートフラッシュ',
        'ロイヤルストレートフラッシュ'
    ];

    // 役が出たときの煽り文句
    const HAND_FLAVOR = {
        9: '🃏 ロイヤル！ 何を持ってきてるんだ',
        8: '🔥 ストレートフラッシュ、事故みたいな引き',
        7: '💥 フォーカード。もう笑うしかない',
        6: '✨ フルハウスで押し切った',
        5: '🌊 フラッシュで制圧',
        4: '📈 ストレート、きれいに繋げた'
    };

    function rankLabel(rank) {
        return RANK_LABEL[rank] || String(rank);
    }

    /* ---------- 山札 ---------- */

    function newDeck() {
        const deck = [];
        SUITS.forEach(suit => {
            for (let rank = 2; rank <= 14; rank++) deck.push({ suit, rank });
        });
        return deck;
    }

    function shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = deck[i];
            deck[i] = deck[j];
            deck[j] = tmp;
        }
        return deck;
    }

    /* ---------- 役の判定 ---------- */

    function groupByRank(cards) {
        const counts = {};
        cards.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
        return Object.keys(counts)
            .map(r => ({ rank: Number(r), count: counts[r] }))
            .sort((a, b) => (b.count - a.count) || (b.rank - a.rank));
    }

    /**
     * 5枚の手札を評価する。
     * @returns { category, name, tiebreak: [] } category が大きいほど強い
     */
    function evaluate(cards) {
        const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
        const isFlush = cards.every(c => c.suit.key === cards[0].suit.key);
        const grouped = groupByRank(cards);
        const shape = grouped.map(g => g.count).join('');
        const tiebreak = grouped.map(g => g.rank);

        // ストレート判定（A-2-3-4-5 のホイールを含む）
        const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
        let straightHigh = 0;
        if (unique.length === 5) {
            if (unique[0] - unique[4] === 4) {
                straightHigh = unique[0];
            } else if (unique[0] === 14 && unique[1] === 5 && unique[4] === 2) {
                straightHigh = 5; // ホイールは 5 ハイ
            }
        }

        let category;
        let tb = tiebreak;

        if (straightHigh && isFlush) {
            category = straightHigh === 14 ? 9 : 8;
            tb = [straightHigh];
        } else if (shape === '41') {
            category = 7;
        } else if (shape === '32') {
            category = 6;
        } else if (isFlush) {
            category = 5;
            tb = ranks;
        } else if (straightHigh) {
            category = 4;
            tb = [straightHigh];
        } else if (shape === '311') {
            category = 3;
        } else if (shape === '221') {
            category = 2;
        } else if (shape === '2111') {
            category = 1;
        } else {
            category = 0;
            tb = ranks;
        }

        return { category, name: HAND_NAMES[category], tiebreak: tb };
    }

    /**
     * 途中経過（1〜4枚）の暫定評価。ストレート・フラッシュは未確定なので見ない。
     */
    function evaluatePartial(cards) {
        const grouped = groupByRank(cards);
        const shape = grouped.map(g => g.count).join('');
        const tiebreak = grouped.map(g => g.rank);

        let category = 0;
        if (shape.startsWith('4')) category = 7;
        else if (shape.startsWith('3')) category = 3;
        else if (shape === '22') category = 2;
        else if (shape.startsWith('2')) category = 1;

        return { category, name: HAND_NAMES[category], tiebreak };
    }

    // 強い順に並べるための比較（a が強ければ負の値）
    function compare(a, b) {
        if (a.category !== b.category) return b.category - a.category;
        const len = Math.max(a.tiebreak.length, b.tiebreak.length);
        for (let i = 0; i < len; i++) {
            const x = a.tiebreak[i] || 0;
            const y = b.tiebreak[i] || 0;
            if (x !== y) return y - x;
        }
        return 0;
    }

    /* ---------- 途中経過 ---------- */

    /**
     * n 枚めくった時点でトップに立っているチーム（同着なら複数）
     */
    function leadersAt(hands, n) {
        const standings = hands.map(h => ({
            team: h.team,
            result: evaluatePartial(h.cards.slice(0, n))
        }));
        standings.sort((a, b) => compare(a.result, b.result));
        return standings.filter(s => compare(s.result, standings[0].result) === 0).map(s => s.team);
    }

    /**
     * 4枚目までのトップに勝者が含まれていなければ「逆転」
     */
    function comebackInfo(hands, winner) {
        const leaders = leadersAt(hands, 4);
        const isComeback = !leaders.some(t => t.id === winner.id);
        return {
            isComeback,
            leaderNames: leaders.map(t => t.name),
            leaderIds: leaders.map(t => t.id)
        };
    }

    /* ---------- 配牌 ---------- */

    function dealOnce(teams) {
        const deck = shuffle(newDeck());
        return teams.map((team, index) => {
            const cards = deck.slice(index * 5, index * 5 + 5);
            return { team, cards, result: evaluate(cards) };
        });
    }

    /**
     * 勝者を先に均等抽選し、それが勝つ配牌を探す。
     * dramaChance の確率で「逆転あり」の配牌を優先する。
     * @returns { hands, winner, comeback, drama }
     */
    function deal(teams, options) {
        const opts = options || {};
        const dramaChance = typeof opts.dramaChance === 'number' ? opts.dramaChance : 0.35;

        const winner = teams[Math.floor(Math.random() * teams.length)];
        const wantDrama = Math.random() < dramaChance;

        let fallback = null;

        for (let attempt = 0; attempt < 600; attempt++) {
            const hands = dealOnce(teams);
            const ordered = hands.slice().sort((a, b) => compare(a.result, b.result));

            // 完全な引き分けは配り直す
            if (ordered.length > 1 && compare(ordered[0].result, ordered[1].result) === 0) continue;
            if (ordered[0].team.id !== winner.id) continue;

            const comeback = comebackInfo(hands, winner);
            const packet = { hands, winner, comeback, drama: wantDrama };

            if (!fallback) fallback = packet;
            // 逆転あり/なしを狙いどおりに揃える（勝者は既に均等抽選済みなので公平性は変わらない）
            if (comeback.isComeback === wantDrama) return packet;
        }

        return fallback || { hands: dealOnce(teams), winner, comeback: { isComeback: false, leaderNames: [], leaderIds: [] }, drama: false };
    }

    /* ---------- 表示用 ---------- */

    function cardHtml(card) {
        return '<span class="pcard' + (card.suit.red ? ' is-red' : '') + '">' +
            '<b>' + rankLabel(card.rank) + '</b>' +
            '<i>' + card.suit.mark + '</i>' +
            '</span>';
    }

    function flavorFor(result) {
        return HAND_FLAVOR[result.category] || '';
    }

    global.Showdown = {
        deal,
        evaluate,
        evaluatePartial,
        compare,
        leadersAt,
        cardHtml,
        flavorFor,
        rankLabel,
        HAND_NAMES
    };
})(window);
