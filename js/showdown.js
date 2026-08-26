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
        9: 'ロイヤル！ 何を持ってきてるんだ',
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

    // 理屈は無視。「そんな役あるか！」で笑わせるための決着パターン。
    // 強い役を見せるより、盤外から何か出てくるほうが盛り上がる
    const FINISHERS = [
        {
            label: '手ぶら',
            tagline: 'カードを出してすらいない',
            build: () => []
        },
        {
            label: '伏せたまま',
            tagline: '見せる必要すらないらしい',
            build: () => [{ back: true }, { back: true }, { back: true }, { back: true }, { back: true }]
        },
        {
            label: 'たった1枚',
            tagline: '残り4枚はどこへ消えた',
            build: () => [card(14, 's')]
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
            label: 'スペード13枚',
            tagline: 'スペードを全部持っている',
            build: () => [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r => card(r, 's'))
        },
        {
            label: 'エース13枚',
            tagline: 'デッキがエースしか入っていない',
            build: () => { const out = []; for (let i = 0; i < 13; i++) out.push(card(14, SUITS[i % 4].key)); return out; }
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
            label: 'ジョーカー＋エース',
            tagline: 'ルールブックを閉じてください',
            build: () => [JOKER, card(14, 's'), JOKER, card(14, 'h'), JOKER]
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
            label: '王手',
            tagline: '盤面が違う',
            build: () => ['王', '飛', '角', '金', '歩'].map(f => ({ face: f, cls: 'is-shogi' }))
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
            label: 'じゃんけん',
            tagline: 'ポーカーを諦めた',
            build: () => ['✊', '✌', '🖐'].map(f => ({ face: f, cls: 'is-hand' }))
        },
        {
            label: '現金',
            tagline: 'カードではなく金で解決した',
            build: () => ['🪙', '🪙', '🪙', '💰', '🪙'].map(f => ({ face: f, cls: 'is-coin' }))
        },
        {
            label: '札束',
            tagline: '交渉の席に金を積んできた',
            build: () => ['💴', '💴', '💴'].map(f => ({ face: f, cls: 'is-coin' }))
        },
        {
            label: 'ポカチェのチップ',
            tagline: '場のチップを全部持ってきた',
            build: () => ['🔵', '🟣', '🟠'].map(f => ({ face: f, cls: 'is-chip' })).concat([card(14, 's'), JOKER])
        },
        {
            label: '王',
            tagline: '格が違うとのこと',
            build: () => [{ face: '👑', cls: 'is-crown' }]
        },
        {
            label: '契約書',
            tagline: '先に契約が済んでいるらしい',
            build: () => ['📄', '🖊'].map(f => ({ face: f, cls: 'is-paper' }))
        },
        {
            label: 'ルールブック',
            tagline: 'カードではなく規則のほうを出してきた',
            build: () => [{ face: '📖', cls: 'is-paper' }]
        },
        {
            label: '診断書',
            tagline: 'そういう事情なら仕方ない',
            build: () => [{ face: '🏥', cls: 'is-paper' }, { face: '📄', cls: 'is-paper' }]
        },
        {
            label: '回線落ち',
            tagline: '通信環境のせいということで',
            build: () => ['📶', '❌'].map(f => ({ face: f, cls: 'is-glitch' }))
        },
        {
            label: '時間切れ',
            tagline: '制限時間を主張しはじめた',
            build: () => [{ face: '⏰', cls: 'is-glitch' }]
        },
        {
            label: '猫がカードに乗った',
            tagline: '手札は見えなくなった。以上',
            build: () => [{ back: true }, { face: '🐈', cls: 'is-cat' }, { back: true }]
        },
        {
            label: '土下座',
            tagline: '札ではなく誠意で押し切った',
            build: () => [{ face: '🙇', cls: 'is-hand' }]
        },
        {
            label: '菓子折り',
            tagline: '賄賂にしては安い',
            build: () => ['🍡', '🍘', '🍵'].map(f => ({ face: f, cls: 'is-paper' }))
        },
        {
            label: '白紙',
            tagline: '何も書かれていないカードを5枚',
            build: () => ['', '', '', '', ''].map(f => ({ face: f || ' ', cls: 'is-paper' }))
        },
        {
            label: '鏡',
            tagline: '相手の手札をそのまま返してきた',
            build: () => [{ face: '🪞', cls: 'is-glitch' }]
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
        const objectionChance = typeof opts.objectionChance === 'number' ? opts.objectionChance : 0.33;

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

    // 合成音の出口。スマホのスピーカーだと音源（mp3）に比べて埋もれるので
    // まとめて持ち上げ、重なったときに割れないよう最後に圧縮をかける
    const SYNTH_LEVEL = 2.2;
    let synthOut = null;

    function out() {
        const ac = ctx();
        if (!ac) return null;
        if (!synthOut || synthOut.context !== ac) {
            const gain = ac.createGain();
            const comp = ac.createDynamicsCompressor();
            gain.gain.value = SYNTH_LEVEL;
            gain.connect(comp).connect(ac.destination);
            synthOut = gain;
        }
        return synthOut;
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
        osc.connect(amp).connect(out() || ac.destination);
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
        src.connect(amp).connect(out() || ac.destination);
        src.start(start);
    }

    // ドラムロール。打点を並べたバッファを1本作って鳴らすので、
    // 途中で止めたいときは source を止めるだけで済む。
    let rollNode = null;

    function synthRollStart(seconds) {
        const ac = ctx();
        if (!ac) return;
        synthRollStop();

        const dur = Math.max(0.5, seconds || 3);
        const rate = ac.sampleRate;
        const frames = Math.floor(rate * dur);

        // スネアは「響き線のシャー」と「胴のドン」の二層でできている。
        // 帯域が違うので別のバッファに書いて、それぞれ違うフィルタを通す。
        const wireBuf = ac.createBuffer(1, frames, rate);
        const bodyBuf = ac.createBuffer(1, frames, rate);
        const wire = wireBuf.getChannelData(0);
        const body = bodyBuf.getChannelData(0);

        let at = 0;
        let interval = 0.024;          // 打点の間隔。1秒あたり40打から始める
        while (at < dur) {
            const head = Math.floor(at * rate);
            const swell = 0.30 + 0.70 * (at / dur);
            const accent = 0.75 + Math.random() * 0.5;   // 打点ごとに強弱を散らす
            const level = swell * accent;

            // 響き線。減衰を間隔より長く取ることで打点どうしが溶けて連続音になる
            const wireLen = Math.floor(rate * 0.055);
            for (let i = 0; i < wireLen && head + i < frames; i++) {
                wire[head + i] += (Math.random() * 2 - 1) *
                    Math.exp(-i / (rate * 0.014)) * level;
            }

            // 胴の鳴り。芯を出すための低い成分
            const bodyLen = Math.floor(rate * 0.030);
            for (let i = 0; i < bodyLen && head + i < frames; i++) {
                const t = i / rate;
                body[head + i] += Math.sin(2 * Math.PI * 188 * t) *
                    Math.exp(-t / 0.010) * level * 0.6;
            }

            // 等間隔だと機械的になるので、少し揺らしながら詰めていく
            at += interval * (0.85 + Math.random() * 0.3);
            interval = Math.max(0.012, interval * 0.995);
        }

        normalize(wire, 0.9);
        normalize(body, 0.9);

        const master = ac.createGain();
        master.gain.setValueAtTime(0.34, ac.currentTime);
        master.connect(ac.destination);

        const wireSrc = ac.createBufferSource();
        const wireBand = ac.createBiquadFilter();
        const wireAmp = ac.createGain();
        wireSrc.buffer = wireBuf;
        wireBand.type = 'bandpass';
        wireBand.frequency.value = 3400;   // 響き線のざらつきはこのあたり
        wireBand.Q.value = 0.45;
        wireAmp.gain.value = 0.5;
        wireSrc.connect(wireBand).connect(wireAmp).connect(master);

        const bodySrc = ac.createBufferSource();
        const bodyLow = ac.createBiquadFilter();
        const bodyAmp = ac.createGain();
        bodySrc.buffer = bodyBuf;
        bodyLow.type = 'lowpass';
        bodyLow.frequency.value = 420;
        bodyAmp.gain.value = 0.42;
        bodySrc.connect(bodyLow).connect(bodyAmp).connect(master);

        wireSrc.start();
        bodySrc.start();
        rollNode = { sources: [wireSrc, bodySrc], amp: master };
    }

    /**
     * ドラムロールは音源ファイルを鳴らす。
     * 末尾のクラッシュが「オープン！」に重なるよう、あらかじめ頭を
     * 切り詰めてある（クラッシュは 2.70 秒地点 ≒ カウントダウンの長さ）。
     * 読み込めなかったときだけ合成音に落とす。
     */
    const ROLL_URL = 'sounds/drumroll.mp3';
    let rollAudio = null;      // null=未作成 / false=使えない

    function rollElement() {
        if (rollAudio !== null) return rollAudio;
        try {
            rollAudio = new Audio(ROLL_URL);
            rollAudio.preload = 'auto';
            rollAudio.volume = 0.75;
            rollAudio.load();
        } catch (e) {
            rollAudio = false;
        }
        return rollAudio;
    }

    function drumrollStart(seconds) {
        const el = rollElement();
        if (el) {
            try {
                el.currentTime = 0;
                const played = el.play();
                if (played && played.catch) {
                    played.catch(() => synthRollStart(seconds));
                }
                return;
            } catch (e) { /* 合成音へ */ }
        }
        synthRollStart(seconds);
    }

    // 「オープン！」の合図。音源には決着のクラッシュが入っているので鳴らし切る
    function drumrollStop() {
        synthRollStop();
    }

    // 抽選を途中でやめたときなど、完全に止める
    function drumrollAbort() {
        synthRollStop();
        if (rollAudio) {
            try { rollAudio.pause(); rollAudio.currentTime = 0; } catch (e) { /* 無視 */ }
        }
    }

    // 本番で待たされないよう、読み込みだけ先に済ませておく
    rollElement();

    // 打点が重なって振り切れるので、書き終えてから全体を揃える
    function normalize(data, target) {
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const a = Math.abs(data[i]);
            if (a > peak) peak = a;
        }
        if (peak <= 0) return;
        const scale = target / peak;
        for (let i = 0; i < data.length; i++) data[i] *= scale;
    }

    function synthRollStop() {
        const node = rollNode;
        if (!node) return;
        rollNode = null;
        const ac = audioCtx;
        if (!ac) return;
        // ぶつ切りにならないよう短くフェードしてから止める
        const now = ac.currentTime;
        try {
            node.amp.gain.cancelScheduledValues(now);
            node.amp.gain.setValueAtTime(node.amp.gain.value, now);
            node.amp.gain.linearRampToValueAtTime(0.0001, now + 0.06);
        } catch (e) { /* 無視 */ }
        node.sources.forEach(src => {
            try { src.stop(now + 0.09); } catch (e) { /* 無視 */ }
        });
    }

    /* ---------- 効果音 ---------- */

    // 端末によっては AudioContext から音が出ない（合成音だけ無音になる）。
    // 音源ファイルの再生は確実に鳴るので、そちらを本線にして、
    // 合成はファイルが読めなかったときの控えとして残す。
    // sounds/se/*.mp3 は現在の合成音をそのまま書き出したもの
    const CLIP_DIR = 'sounds/se/';
    const CLIP_NAMES = [
        'deal', 'flip', 'made', 'tense', 'win', 'comeback', 'objection', 'lose',
        'slam0', 'slam1', 'slam2', 'slam3', 'slam4'
    ];
    // 続けざまに鳴るものは、鳴り終わる前に次が来るので複数持つ
    const CLIP_POOL = { flip: 6, deal: 3, made: 2 };
    const clips = {};

    function clipPool(name) {
        if (clips[name]) return clips[name];
        if (typeof global.Audio === 'undefined') return null;
        const pool = { els: [], at: 0, broken: false };
        const count = CLIP_POOL[name] || 1;
        for (let i = 0; i < count; i++) {
            const el = new global.Audio(CLIP_DIR + name + '.mp3');
            el.preload = 'auto';
            el.addEventListener('error', () => { pool.broken = true; });
            pool.els.push(el);
        }
        clips[name] = pool;
        return pool;
    }

    // 鳴らせたら true。false のときだけ呼び出し側が合成に切り替える
    function playClip(name) {
        const pool = clipPool(name);
        if (!pool || pool.broken) return false;
        const el = pool.els[pool.at];
        pool.at = (pool.at + 1) % pool.els.length;
        try {
            el.currentTime = 0;
            const played = el.play();
            if (played && played.catch) played.catch(() => { /* 無視 */ });
        } catch (e) {
            return false;
        }
        return true;
    }

    // 端末は、ユーザー操作の中で一度鳴らしていない音源の再生を拒否する。
    // 音量を落として一瞬だけ鳴らし、すぐ戻すことで許可を取っておく
    function primeElement(el) {
        if (!el || !el.paused) return;
        const volume = el.volume;
        el.volume = 0;
        const done = () => { el.pause(); el.currentTime = 0; el.volume = volume; };
        let played = null;
        try { played = el.play(); } catch (e) { el.volume = volume; return; }
        if (played && played.then) played.then(done).catch(() => { el.volume = volume; });
        else done();
    }

    // ルーレットの回転音。カチカチを1音ずつ鳴らすと序盤が 14ms 間隔になり、
    // 端末が再生に追いつかない。減速まで含めて1本の音源にしてある
    let spinEl = null;
    let spinBroken = false;

    function spinElement() {
        if (spinEl || spinBroken) return spinEl;
        if (typeof global.Audio === 'undefined') return null;
        spinEl = new global.Audio(CLIP_DIR + 'roulette.mp3');
        spinEl.preload = 'auto';
        spinEl.addEventListener('error', () => { spinBroken = true; });
        return spinEl;
    }

    const sfx = {
        // 最初のクリックで音を有効化する（ブラウザの自動再生制限対策）
        unlock() {
            CLIP_NAMES.forEach(name => {
                const pool = clipPool(name);
                if (pool) pool.els.forEach(primeElement);
            });
            primeElement(rollElement());
            primeElement(spinElement());

            // 音源が読めなかったときのために、合成のほうも起こしておく
            const ac = ctx();
            if (ac && ac.state === 'suspended') ac.resume();
            if (ac) {
                try {
                    const buf = ac.createBuffer(1, 1, ac.sampleRate);
                    const src = ac.createBufferSource();
                    src.buffer = buf;
                    src.connect(out() || ac.destination);
                    src.start(0);
                } catch (e) { /* 無視 */ }
            }
        },
        deal() { if (!playClip('deal')) noise(0.06, 0.12); },
        flip() { if (!playClip('flip')) tone(660, 0.06, 'square', 0.07); },
        made() {
            if (playClip('made')) return;
            tone(880, 0.12, 'triangle', 0.14);
            tone(1320, 0.14, 'triangle', 0.10, 0.06);
        },
        tense() { if (!playClip('tense')) tone(150, 0.5, 'sawtooth', 0.07); },
        countdown(step) { tone(440 + step * 110, 0.14, 'square', 0.13); },
        // 鳴らせたら true。false のときだけ呼び出し側が1音ずつに切り替える
        rouletteStart() {
            const el = spinElement();
            if (!el || spinBroken) return false;
            try {
                el.currentTime = 0;
                const played = el.play();
                if (played && played.catch) played.catch(() => { /* 無視 */ });
            } catch (e) {
                return false;
            }
            return true;
        },
        rouletteStop() {
            if (!spinEl) return;
            try { spinEl.pause(); spinEl.currentTime = 0; } catch (e) { /* 無視 */ }
        },
        drumroll(seconds) { drumrollStart(seconds); },
        drumrollStop() { drumrollStop(); },
        drumrollAbort() { drumrollAbort(); },
        win() {
            if (playClip('win')) return;
            [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, 'triangle', 0.16, i * 0.09));
        },
        comeback() {
            if (playClip('comeback')) return;
            noise(0.35, 0.34);
            tone(110, 0.5, 'sawtooth', 0.2);
            [392, 523, 659, 880, 1175].forEach((f, i) => tone(f, 0.36, 'square', 0.15, 0.16 + i * 0.07));
        },
        objection() {
            if (playClip('objection')) return;
            noise(0.5, 0.4);
            tone(90, 0.7, 'sawtooth', 0.24);
            tone(180, 0.5, 'square', 0.16, 0.05);
            [1400, 1100, 800].forEach((f, i) => tone(f, 0.16, 'square', 0.14, 0.1 + i * 0.1));
        },
        slam(i) {
            const step = Math.max(0, Math.min(4, Math.floor(i) || 0));
            if (playClip('slam' + step)) return;
            noise(0.12, 0.28);
            tone(160 + step * 60, 0.18, 'square', 0.16);
        },
        lose() {
            if (playClip('lose')) return;
            tone(220, 0.28, 'sine', 0.08);
            tone(165, 0.34, 'sine', 0.07, 0.1);
        }
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

    /* ---------- 決着の再生（ボードと指名シートで共通） ---------- */

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 途中経過の役とリード表示を更新する
    function updateStandings(rows, packet, shown, openIdx) {
        const targets = openIdx || packet.hands.map((h, n) => n);
        const open = targets.map(n => packet.hands[n]);
        const leaderIds = leadersAt(open, shown).map(t => t.id);
        open.forEach(hand => {
            const i = packet.hands.indexOf(hand);
            const row = rows[i];
            row.classList.toggle('is-leading', leaderIds.indexOf(hand.team.id) !== -1);
            const partial = evaluatePartial(hand.cards.slice(0, shown));
            row.querySelector('.sd-hand').textContent = partial.category > 0 ? partial.name : '';
        });
    }

    /**
     * 配牌を受け取って決着までを再生する。
     * 同じ packet を渡せば、どの画面でも同じ演出になる。
     * @param packet Showdown.deal() の戻り値（JSON を経由したものでも可）
     * @param els    { stage, board, banner, note }
     * @param opts   { sound: 音を鳴らすか }
     */
    async function play(packet, els, opts) {
        const o = opts || {};
        const sound = o.sound !== false;
        const D = global.Draft;
        const stage = els.stage, board = els.board, banner = els.banner, note = els.note;

        banner.className = 'showdown-banner';
        banner.textContent = '';
        stage.classList.remove('is-flash', 'is-shake', 'is-rolling', 'is-objection');

        // --- 配牌 ---
        board.innerHTML = '';
        packet.hands.forEach(hand => {
            const row = document.createElement('div');
            row.className = 'sd-row is-dealing';
            row.dataset.teamId = hand.team.id;
            row.style.setProperty('--team-color', D.teamColor(hand.team));
            row.innerHTML =
                '<div class="sd-team">' + D.avatarHtml(hand.team) + D.esc(hand.team.name) + '</div>' +
                '<div class="sd-cards">' + hand.cards.map(() => '<span class="pcard is-back"></span>').join('') + '</div>' +
                '<div class="sd-hand"></div>';
            board.appendChild(row);
        });

        const rows = Array.from(board.querySelectorAll('.sd-row'));
        note.textContent = 'カードを配ります…';

        for (let i = 0; i < rows.length; i++) {
            rows[i].classList.remove('is-dealing');
            if (sound) sfx.deal();
            await wait(220);
        }
        await wait(500);

        // --- 1〜4枚目 ---
        const openIdx = packet.hands.map((h, n) => n);

        for (let step = 1; step <= 4; step++) {
            for (const i of openIdx) {
                const slot = rows[i].querySelectorAll('.pcard')[step - 1];
                slot.outerHTML = cardHtml(packet.hands[i].cards[step - 1]);
                if (sound) sfx.flip();
                await wait(140);
            }
            updateStandings(rows, packet, step, openIdx);
            note.textContent = step + ' 枚目';
            await wait(step === 4 ? 300 : 620);
        }

        // --- リーチ ---
        if (sound) sfx.tense();
        banner.className = 'showdown-banner is-tense';
        const leadNames = leadersAt(openIdx.map(i => packet.hands[i]), 4).map(t => t.name);
        banner.textContent = leadNames.join(' / ') + ' がリード';
        note.textContent = 'このまま決まるか…？';
        await wait(1800);

        // --- 運命の5枚目 ---
        banner.className = 'showdown-banner is-countdown';
        banner.textContent = '運命の5枚目';
        note.textContent = '';
        stage.classList.add('is-rolling');
        if (sound) sfx.drumroll(2.9);
        await wait(900);

        for (let n = 3; n >= 1; n--) {
            banner.className = 'showdown-banner is-countdown is-digit';
            banner.textContent = String(n);
            await wait(620);
        }

        banner.className = 'showdown-banner is-open';
        banner.textContent = 'オープン！';
        stage.classList.remove('is-rolling');
        stage.classList.add('is-flash', 'is-shake');
        setTimeout(() => stage.classList.remove('is-flash', 'is-shake'), 500);
        if (sound) sfx.drumrollStop();
        await wait(400);

        // --- 全員同時にオープン ---
        openIdx.forEach(index => rows[index].classList.add('is-opening'));
        await wait(360);

        let improved = false;
        openIdx.forEach(index => {
            const hand = packet.hands[index];
            const row = rows[index];
            const slot = row.querySelectorAll('.pcard')[4];
            const beforeCat = evaluatePartial(hand.cards.slice(0, 4)).category;
            slot.outerHTML = cardHtml(hand.cards[4]);
            row.classList.remove('is-opening');
            row.querySelector('.sd-hand').textContent = hand.result.name;
            if (hand.result.category > beforeCat) {
                improved = true;
                row.classList.add('is-hit');
                setTimeout(() => row.classList.remove('is-hit'), 700);
            }
        });
        if (sound) { if (improved) sfx.made(); else sfx.flip(); }
        await wait(1100);

        // --- ちょっとまったー！ ---
        if (packet.objection) {
            const provIndex = packet.hands.findIndex(
                h => packet.provisional && h.team.id === packet.provisional.id);
            const provHand = packet.hands[provIndex];
            const provLead = leadersAt(packet.hands, 4).some(
                t => packet.provisional && t.id === packet.provisional.id);

            rows.forEach(r => r.classList.remove('is-leading'));
            rows.forEach((r, i) => {
                if (i === provIndex) r.classList.add('is-winner');
                else r.classList.add('is-out');
            });

            stage.classList.add('is-flash');
            setTimeout(() => stage.classList.remove('is-flash'), 500);

            if (provLead) {
                banner.className = 'showdown-banner is-win';
                banner.textContent = packet.provisional.name + ' 逃げ切り';
                if (sound) sfx.win();
            } else {
                banner.className = 'showdown-banner is-comeback';
                banner.textContent = '大逆転  ' + packet.provisional.name;
                if (sound) sfx.comeback();
            }

            const provFlavor = flavorFor(provHand.result);
            note.textContent = provHand.result.name + ' で ' + packet.provisional.name + ' が交渉権を獲得' +
                (provFlavor ? '  —  ' + provFlavor : '');
            confetti(stage, 2400);
            await wait(2600);

            stage.classList.add('is-objection');
            banner.className = 'showdown-banner is-objection';
            banner.textContent = 'ちょっとまったー！！';
            note.textContent = '';
            if (sound) sfx.objection();
            rows.forEach(r => { r.classList.remove('is-winner'); r.classList.remove('is-out'); });
            await wait(1500);

            const winIndex = packet.hands.findIndex(h => h.team.id === packet.winner.id);
            const winRow = rows[winIndex];
            const winHand = packet.hands[winIndex];

            winRow.classList.add('is-objector');
            banner.textContent = 'ちょっとまったー！！　' + packet.winner.name;
            await wait(1200);

            const holder = winRow.querySelector('.sd-cards');
            holder.classList.add('is-sweeping');
            if (sound) sfx.slam(0);
            await wait(520);
            holder.classList.remove('is-sweeping');
            holder.innerHTML = '';
            winRow.querySelector('.sd-hand').textContent = '';
            await wait(280);

            const finisherCards = (winHand.finisher && winHand.finisher.cards) || [];
            const slamGap = Math.max(80, 240 - finisherCards.length * 12);
            if (!finisherCards.length) await wait(500);
            for (let i = 0; i < finisherCards.length; i++) {
                const el = document.createElement('span');
                el.innerHTML = cardHtml(finisherCards[i]);
                const cardEl = el.firstChild;
                cardEl.classList.add('is-slammed');
                holder.appendChild(cardEl);
                if (sound) sfx.slam(i);
                await wait(slamGap);
            }

            winRow.querySelector('.sd-hand').textContent = winHand.finisher.label;
            winRow.classList.add('is-hit');
            await wait(700);

            rows.forEach((r, i) => {
                r.classList.remove('is-winner');
                if (i === winIndex) r.classList.add('is-winner');
                else r.classList.add('is-out');
            });
            stage.classList.remove('is-objection');
            stage.classList.add('is-flash');
            setTimeout(() => stage.classList.remove('is-flash'), 500);

            banner.className = 'showdown-banner is-comeback';
            banner.textContent = winHand.finisher.label + '  ' + packet.winner.name;
            note.textContent = winHand.finisher.tagline + '  —  ' + packet.winner.name + ' が交渉権を獲得';
            if (sound) sfx.comeback();
            confetti(stage, 3200);
            return;
        }

        // --- 決着 ---
        rows.forEach(r => r.classList.remove('is-leading'));
        const winnerIndex = packet.hands.findIndex(h => h.team.id === packet.winner.id);
        const winnerHand = packet.hands[winnerIndex];

        rows.forEach((r, i) => {
            if (i === winnerIndex) r.classList.add('is-winner');
            else r.classList.add('is-out');
        });

        stage.classList.add('is-flash');
        setTimeout(() => stage.classList.remove('is-flash'), 500);

        if (packet.comeback && packet.comeback.isComeback) {
            banner.className = 'showdown-banner is-comeback';
            banner.textContent = '大逆転  ' + packet.winner.name;
            if (sound) sfx.comeback();
        } else {
            banner.className = 'showdown-banner is-win';
            banner.textContent = packet.winner.name + ' 逃げ切り';
            if (sound) sfx.win();
        }

        confetti(stage, 2800);

        const flavor = flavorFor(winnerHand.result);
        note.textContent = winnerHand.result.name + ' で ' + packet.winner.name + ' が交渉権を獲得' +
            (flavor ? '  —  ' + flavor : '');
    }

    global.Showdown = {
        deal,
        evaluate,
        evaluatePartial,
        compare,
        leadersAt,
        cardHtml,
        play,
        flavorFor,
        sfx,
        confetti,
        rankLabel,
        HAND_NAMES
    };
})(window);
