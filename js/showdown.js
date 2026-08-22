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

    /* ---------- 役を指定して手札を組み立てる ---------- */

    // 山札から条件に合うカードを1枚取り出す（取り出した分は山札から消える）
    function take(deck, pred) {
        for (let i = 0; i < deck.length; i++) {
            if (pred(deck[i])) return deck.splice(i, 1)[0];
        }
        return null;
    }

    function takeRank(deck, rank, count, excludeSuit) {
        const out = [];
        for (let i = 0; i < count; i++) {
            const c = take(deck, x => x.rank === rank && (!excludeSuit || x.suit.key !== excludeSuit));
            if (!c) return null;
            out.push(c);
        }
        return out;
    }

    function distinctRanks(count, exclude) {
        const banned = (exclude || []).slice();
        const out = [];
        let guard = 0;
        while (out.length < count && guard++ < 200) {
            const r = 2 + Math.floor(Math.random() * 13);
            if (banned.indexOf(r) === -1) { banned.push(r); out.push(r); }
        }
        return out.length === count ? out : null;
    }

    // 指定した役ちょうどの5枚を作る。作れなければ null
    function buildHand(deck, category) {
        let cards = null;

        if (category === 1) {                       // ワンペア
            const r = 2 + Math.floor(Math.random() * 13);
            const pair = takeRank(deck, r, 2);
            const ks = distinctRanks(3, [r]);
            if (!pair || !ks) return null;
            cards = pair.concat(ks.map(k => take(deck, x => x.rank === k)));

        } else if (category === 2) {                // ツーペア
            const rs = distinctRanks(2);
            if (!rs) return null;
            const p1 = takeRank(deck, rs[0], 2);
            const p2 = takeRank(deck, rs[1], 2);
            const ks = distinctRanks(1, rs);
            if (!p1 || !p2 || !ks) return null;
            cards = p1.concat(p2, [take(deck, x => x.rank === ks[0])]);

        } else if (category === 3) {                // スリーカード
            const r = 2 + Math.floor(Math.random() * 13);
            const trips = takeRank(deck, r, 3);
            const ks = distinctRanks(2, [r]);
            if (!trips || !ks) return null;
            cards = trips.concat(ks.map(k => take(deck, x => x.rank === k)));

        } else if (category === 4) {                // ストレート（フラッシュにならないよう散らす）
            const low = 2 + Math.floor(Math.random() * 9);
            cards = [];
            for (let r = low; r < low + 5; r++) {
                const c = take(deck, x => x.rank === r);
                if (!c) return null;
                cards.push(c);
            }
            if (cards.every(c => c.suit.key === cards[0].suit.key)) return null;

        } else if (category === 5) {                // フラッシュ
            const suit = SUITS[Math.floor(Math.random() * SUITS.length)].key;
            const rs = distinctRanks(5);
            if (!rs) return null;
            cards = rs.map(r => take(deck, x => x.rank === r && x.suit.key === suit));
            if (cards.some(c => !c)) return null;

        } else if (category === 6) {                // フルハウス
            const rs = distinctRanks(2);
            if (!rs) return null;
            const trips = takeRank(deck, rs[0], 3);
            const pair = takeRank(deck, rs[1], 2);
            if (!trips || !pair) return null;
            cards = trips.concat(pair);

        } else if (category === 7) {                // フォーカード
            const r = 2 + Math.floor(Math.random() * 13);
            const q = takeRank(deck, r, 4);
            const ks = distinctRanks(1, [r]);
            if (!q || !ks) return null;
            cards = q.concat([take(deck, x => x.rank === ks[0])]);
        } else if (category === 8) {                // ストレートフラッシュ（ロイヤルは除く）
            const suit = SUITS[Math.floor(Math.random() * SUITS.length)].key;
            const low = 2 + Math.floor(Math.random() * 8);   // 2〜9 → 最高でも 9-10-J-Q-K
            cards = [];
            for (let r = low; r < low + 5; r++) {
                const c = take(deck, x => x.rank === r && x.suit.key === suit);
                if (!c) return null;
                cards.push(c);
            }
        }

        if (!cards || cards.some(c => !c)) return null;
        // 狙った役ちょうどになっているか確認する
        if (evaluate(cards).category !== category) return null;
        return cards;
    }

    // 勝者の役の強さの出方（実際のポーカーより役が出やすいようにしてある）
    const STRENGTH_TABLE = [
        { cat: 1, weight: 8 },    // ワンペア
        { cat: 2, weight: 32 },   // ツーペア
        { cat: 3, weight: 26 },   // スリーカード
        { cat: 4, weight: 14 },   // ストレート
        { cat: 5, weight: 10 },   // フラッシュ
        { cat: 6, weight: 6 },    // フルハウス
        { cat: 7, weight: 2 },    // フォーカード
        { cat: 8, weight: 1 }     // ストレートフラッシュ（ロイヤルは「ちょっとまった」専用）
    ];

    function pickStrength() {
        const total = STRENGTH_TABLE.reduce((a, b) => a + b.weight, 0);
        let n = Math.random() * total;
        for (const row of STRENGTH_TABLE) {
            n -= row.weight;
            if (n <= 0) return row.cat;
        }
        return 2;
    }

    // 負けるチーム側の役の出方。勝者の役を超えない範囲で抽選する
    const LOSER_TABLE = [
        { cat: 0, weight: 5 },    // ハイカード
        { cat: 1, weight: 34 },   // ワンペア
        { cat: 2, weight: 28 },   // ツーペア
        { cat: 3, weight: 18 },   // スリーカード
        { cat: 4, weight: 7 },    // ストレート
        { cat: 5, weight: 4 },    // フラッシュ
        { cat: 6, weight: 2 }     // フルハウス
    ];

    function pickLoserCategory(maxCat) {
        const rows = LOSER_TABLE.filter(r => r.cat <= maxCat);
        if (!rows.length) return 0;
        const total = rows.reduce((a, b) => a + b.weight, 0);
        let n = Math.random() * total;
        for (const row of rows) {
            n -= row.weight;
            if (n <= 0) return row.cat;
        }
        return rows[0].cat;
    }

    // ハイカードちょうどの5枚（ペア・ストレート・フラッシュにならないように）
    function buildHighCard(deck) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const rs = distinctRanks(5);
            if (!rs) continue;
            const cards = rs.map(r => take(deck, x => x.rank === r));
            if (cards.some(c => !c)) {
                cards.forEach(c => { if (c) deck.push(c); });
                continue;
            }
            if (evaluate(cards).category === 0) return cards;
            deck.push.apply(deck, cards);
        }
        return null;
    }

    function buildLoser(deck, maxCat) {
        const cat = pickLoserCategory(maxCat);
        if (cat === 0) return buildHighCard(deck);
        return buildHand(deck, cat);
    }

    // 勝者に指定の役を持たせ、他チームにもそれなりの役を配る
    function dealStructured(teams, winner, category) {
        const deck = shuffle(newDeck());
        const winnerCards = buildHand(deck, category);
        if (!winnerCards) return null;
        const winnerResult = evaluate(winnerCards);

        const hands = [];
        for (const team of teams) {
            if (team.id === winner.id) {
                hands.push({ team: team, cards: winnerCards, result: winnerResult });
                continue;
            }
            const cards = buildLoser(deck, category);
            if (!cards) return null;
            const result = evaluate(cards);
            // 勝者に勝つ / 並ぶ 手札になってしまったら配り直す
            if (compare(result, winnerResult) <= 0) return null;
            hands.push({ team: team, cards: cards, result: result });
        }

        return hands;
    }

    /* ---------- 「ちょっとまったー！」用の決着札 ---------- */

    const JOKER = { suit: { key: 'x', mark: '', red: false }, rank: 0, joker: true };

    function card(rank, suitKey) {
        return { suit: SUITS.filter(x => x.key === suitKey)[0], rank: rank };
    }

    function anyRank() { return 2 + Math.floor(Math.random() * 13); }
    function anySuit() { return SUITS[Math.floor(Math.random() * SUITS.length)].key; }
    function quads(rank) { return [card(rank, 's'), card(rank, 'h'), card(rank, 'd'), card(rank, 'c')]; }

    // 理屈は無視。「そんな役あるか！」で笑わせるための決着パターン
    const FINISHERS = [
        {
            label: '手ぶら',
            tagline: 'カードを出してすらいない',
            build: () => []
        },
        {
            label: 'スペード13枚',
            tagline: 'スペードを全部持っている',
            build: () => [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r => card(r, 's'))
        },
        {
            label: '∞',
            tagline: 'そんな数字はデッキに入っていない',
            build: () => [{ face: '∞', cls: 'is-infinity' }]
        },
        {
            label: '麻雀',
            tagline: 'ゲームが違う',
            build: () => ['🀄', '🀇', '🀙', '🀐', '🀀'].map(f => ({ face: f, cls: 'is-mahjong' }))
        },
        {
            label: '花札の三光',
            tagline: 'こちらはこちらで役がある',
            build: () => ['🎴', '🎴', '🎴'].map(f => ({ face: f, cls: 'is-hanafuda' }))
        },
        {
            label: '現金',
            tagline: 'カードではなく金で解決した',
            build: () => ['🪙', '🪙', '🪙', '💰', '🪙'].map(f => ({ face: f, cls: 'is-coin' }))
        },
        {
            label: '伏せたまま',
            tagline: '見せる必要すらないらしい',
            build: () => [{ back: true }, { back: true }, { back: true }, { back: true }, { back: true }]
        },
        {
            label: 'エース13枚',
            tagline: 'デッキがエースしか入っていない',
            build: () => { const out = []; for (let i = 0; i < 13; i++) out.push(card(14, SUITS[i % 4].key)); return out; }
        },
        {
            label: '別ゲームのカード',
            tagline: 'ドロー4を出された',
            build: () => ['🔴', '🟡', '🟢', '🔵'].map(f => ({ face: f, cls: 'is-uno' })).concat([{ face: '+4', cls: 'is-uno' }])
        },
        {
            label: 'サイコロ',
            tagline: 'ポーカーですらなくなった',
            build: () => ['🎲', '🎲', '🎲', '🎲', '🎲'].map(f => ({ face: f, cls: 'is-dice' }))
        },
        {
            label: '王',
            tagline: '格が違うとのこと',
            build: () => [{ face: '👑', cls: 'is-crown' }]
        },
        {
            label: 'ポカチェのチップ',
            tagline: '場のチップを全部持ってきた',
            build: () => ['🔵', '🟣', '🟠'].map(f => ({ face: f, cls: 'is-chip' })).concat([card(14, 's'), JOKER])
        },
        {
            label: 'ファイブカード',
            tagline: 'さっきと手札が違う。そんな役もない',
            build: () => { const r = [14, 13, 12][Math.floor(Math.random() * 3)]; return quads(r).concat([card(r, 's')]); }
        },
        {
            label: 'シックスカード',
            tagline: 'デッキに4枚しかないはずのカードが6枚ある',
            build: () => { const r = anyRank(); return quads(r).concat([card(r, 'h'), card(r, 'd')]); }
        },
        {
            label: 'ロイヤルストレートフラッシュ',
            tagline: 'いつの間に。教科書どおりの最強',
            build: () => { const su = anySuit(); return [10, 11, 12, 13, 14].map(r => card(r, su)); }
        },
        {
            label: '6枚目のジョーカー',
            tagline: '手札が1枚増えている',
            build: () => quads(anyRank()).concat([card(anyRank(), 'h'), JOKER])
        },
        {
            label: 'オールジョーカー',
            tagline: '手札が全部ジョーカーに変わった',
            build: () => [JOKER, JOKER, JOKER, JOKER, JOKER]
        },
        {
            label: 'ジョーカー7枚',
            tagline: '7枚。もはやポーカーですらない',
            build: () => [JOKER, JOKER, JOKER, JOKER, JOKER, JOKER, JOKER]
        },
        {
            label: 'ブタ',
            tagline: '差し替えた結果がこれ。それでも押し切った',
            build: () => [card(2, 'd'), card(4, 'c'), card(6, 's'), card(9, 'h'), card(11, 'c')]
        },
        {
            label: '2 のワンペア',
            tagline: 'わざわざ引っ込めて出したのが最弱の役',
            build: () => [card(2, 's'), card(2, 'h'), card(5, 'c'), card(7, 'd'), card(9, 's')]
        },
        {
            label: 'たった1枚',
            tagline: '残り4枚はどこへ消えた',
            build: () => [card(14, 's')]
        },
        {
            label: 'フォーカード',
            tagline: '出どころ以外は完璧',
            build: () => quads(anyRank()).concat([card(anyRank(), 'h')])
        },
        {
            label: 'エース全部＋ジョーカー',
            tagline: 'エース4枚。まだ何か持っている',
            build: () => quads(14).concat([JOKER])
        },
        {
            label: 'K が5枚',
            tagline: '王様が1人多い',
            build: () => quads(13).concat([card(13, 'h')])
        },
        {
            label: '全部スペード',
            tagline: '全部スペードに揃え直してきた',
            build: () => { const rs = []; while (rs.length < 5) { const r = anyRank(); if (rs.indexOf(r) === -1) rs.push(r); } return rs.map(r => card(r, 's')); }
        },
        {
            label: 'ジョーカー＋エース',
            tagline: 'ルールブックを閉じてください',
            build: () => [JOKER, card(14, 's'), JOKER, card(14, 'h'), JOKER]
        }
    ];

    function pickFinisher() {
        const f = FINISHERS[Math.floor(Math.random() * FINISHERS.length)];
        return { cards: f.build(), label: f.label, tagline: f.tagline };
    }

    // 全員に手札を配る。待ったをかけるチームは一度負けて見せる必要がある
    function dealObjection(teams, winner) {
        for (let attempt = 0; attempt < 200; attempt++) {
            // 仮の勝者にはそれなりの役を持たせる
            const topCat = pickStrength();
            const others = teams.filter(t => t.id !== winner.id);
            if (!others.length) return null;
            const provisional = others[Math.floor(Math.random() * others.length)];

            const deck = shuffle(newDeck());
            const topCards = buildHand(deck, topCat);
            if (!topCards) continue;
            const topResult = evaluate(topCards);

            const hands = [];
            let ok = true;
            for (const team of teams) {
                if (team.id === provisional.id) {
                    hands.push({ team: team, cards: topCards, result: topResult });
                    continue;
                }
                const cards = buildLoser(deck, topCat);
                if (!cards) { ok = false; break; }
                const result = evaluate(cards);
                if (compare(result, topResult) <= 0) { ok = false; break; }
                hands.push({ team: team, cards: cards, result: result });
            }
            if (!ok) continue;

            const target = hands.filter(h => h.team.id === winner.id)[0];
            target.finisher = pickFinisher();
            return { hands: hands, provisional: provisional };
        }
        return null;
    }

    /**
     * 勝者を先に均等抽選し、その勝者が勝つ配牌を組み立てる。
     * 役の強さは STRENGTH_TABLE の分布に従い、実際のポーカーより役が出やすい。
     * 逆転の有無は「カードをめくる順番」を入れ替えて調整する（最終結果は変わらない）。
     * @returns { hands, winner, comeback, drama }
     */
    function deal(teams, options) {
        const opts = options || {};
        const dramaChance = typeof opts.dramaChance === 'number' ? opts.dramaChance : 0.35;
        const objectionChance = typeof opts.objectionChance === 'number' ? opts.objectionChance : 0.20;

        const winner = teams[Math.floor(Math.random() * teams.length)];
        const wantDrama = Math.random() < dramaChance;

        // 「ちょっとまったー！」— 一度負けたチームが無茶苦茶な札で全部ひっくり返す
        if (Math.random() < objectionChance) {
            const staged = dealObjection(teams, winner);
            if (staged) {
                return {
                    hands: staged.hands,
                    winner: winner,
                    objection: true,
                    provisional: staged.provisional,
                    comeback: { isComeback: true, leaderNames: [], leaderIds: [] },
                    drama: true
                };
            }
        }

        // 役を指定して配る
        let hands = null;
        for (let attempt = 0; attempt < 120 && !hands; attempt++) {
            hands = dealStructured(teams, winner, pickStrength());
        }
        // どうしても作れなければ、素直にランダムで配る
        if (!hands) {
            for (let attempt = 0; attempt < 400; attempt++) {
                const h = dealOnce(teams);
                const ordered = h.slice().sort((a, b) => compare(a.result, b.result));
                if (ordered[0].team.id !== winner.id) continue;
                if (ordered.length > 1 && compare(ordered[0].result, ordered[1].result) === 0) continue;
                hands = h;
                break;
            }
        }
        if (!hands) hands = dealOnce(teams);

        // めくる順番だけ入れ替えて、逆転あり/なしを狙いどおりにする。
        // 5枚そろった時点の役は変わらないので勝敗には影響しない。
        let comeback = comebackInfo(hands, winner);
        for (let attempt = 0; attempt < 200 && comeback.isComeback !== wantDrama; attempt++) {
            hands.forEach(h => shuffle(h.cards));
            comeback = comebackInfo(hands, winner);
        }

        return { hands: hands, winner: winner, comeback: comeback, drama: wantDrama };
    }

    /* ---------- 表示用 ---------- */

    function cardHtml(card) {
        if (card.face) return '<span class="pcard is-special ' + (card.cls || '') + '"><b>' + card.face + '</b></span>';
        if (card.back) return '<span class="pcard is-back"></span>';
        if (card.joker) return '<span class="pcard is-joker"><b>🃏</b></span>';
        return '<span class="pcard' + (card.suit.red ? ' is-red' : '') + '">' +
            '<b>' + rankLabel(card.rank) + '</b>' +
            '<i>' + card.suit.mark + '</i>' +
            '</span>';
    }

    function flavorFor(result) {
        return HAND_FLAVOR[result.category] || '';
    }


    /* ---------- 効果音（WebAudio・音源ファイル不要） ---------- */

    let audioCtx = null;

    function ctx() {
        if (audioCtx) return audioCtx;
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        try { audioCtx = new AC(); } catch (e) { audioCtx = null; }
        return audioCtx;
    }

    function tone(freq, duration, type, gain, delay) {
        const ac = ctx();
        if (!ac) return;
        const start = ac.currentTime + (delay || 0);
        const osc = ac.createOscillator();
        const amp = ac.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, start);
        amp.gain.setValueAtTime(0.0001, start);
        amp.gain.exponentialRampToValueAtTime(gain || 0.18, start + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(amp).connect(ac.destination);
        osc.start(start);
        osc.stop(start + duration + 0.03);
    }

    function noise(duration, gain, delay) {
        const ac = ctx();
        if (!ac) return;
        const start = ac.currentTime + (delay || 0);
        const frames = Math.floor(ac.sampleRate * duration);
        const buffer = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }
        const src = ac.createBufferSource();
        const amp = ac.createGain();
        src.buffer = buffer;
        amp.gain.setValueAtTime(gain || 0.25, start);
        src.connect(amp).connect(ac.destination);
        src.start(start);
    }

    const sfx = {
        // 最初のクリックで音を有効化する（ブラウザの自動再生制限対策）
        unlock() {
            const ac = ctx();
            if (ac && ac.state === 'suspended') ac.resume();
        },
        deal() { noise(0.06, 0.12); },
        flip() { tone(660, 0.06, 'square', 0.07); },
        made() { tone(880, 0.12, 'triangle', 0.14); tone(1320, 0.14, 'triangle', 0.10, 0.06); },
        tense() { tone(150, 0.5, 'sawtooth', 0.07); },
        countdown(step) { tone(440 + step * 110, 0.14, 'square', 0.13); },
        win() {
            [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, 'triangle', 0.16, i * 0.09));
        },
        comeback() {
            noise(0.35, 0.34);
            tone(110, 0.5, 'sawtooth', 0.2);
            [392, 523, 659, 880, 1175].forEach((f, i) => tone(f, 0.36, 'square', 0.15, 0.16 + i * 0.07));
        },
        objection() {
            noise(0.5, 0.4);
            tone(90, 0.7, 'sawtooth', 0.24);
            tone(180, 0.5, 'square', 0.16, 0.05);
            [1400, 1100, 800].forEach((f, i) => tone(f, 0.16, 'square', 0.14, 0.1 + i * 0.1));
        },
        slam(i) {
            noise(0.12, 0.28);
            tone(160 + i * 60, 0.18, 'square', 0.16);
        },
        lose() { tone(220, 0.28, 'sine', 0.08); tone(165, 0.34, 'sine', 0.07, 0.1); }
    };

    /* ---------- 紙吹雪 ---------- */

    function confetti(host, durationMs) {
        if (!host) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'sd-confetti';
        host.appendChild(canvas);

        const rect = host.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        const g = canvas.getContext('2d');
        const colors = ['#e5c368', '#ffe6a3', '#3ddc97', '#63b3ff', '#ff8fa3', '#ffffff'];
        const bits = [];
        for (let i = 0; i < 130; i++) {
            bits.push({
                x: Math.random() * canvas.width,
                y: -20 - Math.random() * canvas.height * 0.6,
                w: 5 + Math.random() * 6,
                h: 8 + Math.random() * 8,
                vy: 1.6 + Math.random() * 2.6,
                vx: -1 + Math.random() * 2,
                rot: Math.random() * Math.PI,
                vr: -0.18 + Math.random() * 0.36,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }

        const until = Date.now() + (durationMs || 2600);

        (function frame() {
            g.clearRect(0, 0, canvas.width, canvas.height);
            bits.forEach(b => {
                b.x += b.vx;
                b.y += b.vy;
                b.rot += b.vr;
                if (b.y > canvas.height + 20) b.y = -20;
                g.save();
                g.translate(b.x, b.y);
                g.rotate(b.rot);
                g.fillStyle = b.color;
                g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
                g.restore();
            });
            if (Date.now() < until) {
                requestAnimationFrame(frame);
            } else {
                canvas.style.transition = 'opacity .6s';
                canvas.style.opacity = '0';
                setTimeout(() => canvas.remove(), 700);
            }
        })();
    }

    global.Showdown = {
        deal,
        evaluate,
        evaluatePartial,
        compare,
        leadersAt,
        cardHtml,
        flavorFor,
        sfx,
        confetti,
        rankLabel,
        HAND_NAMES
    };
})(window);
