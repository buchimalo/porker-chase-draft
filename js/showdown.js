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

    // 全員に普通に5枚ずつ配る。待ったをかけるチームは一度負けて見せる必要がある
    function dealObjection(teams, winner) {
        for (let attempt = 0; attempt < 300; attempt++) {
            const hands = dealOnce(teams);
            const ordered = hands.slice().sort((x, y) => compare(x.result, y.result));

            // 待ったをかける本人がそのまま勝ってしまっては話にならない
            if (ordered[0].team.id === winner.id) continue;
            if (ordered.length > 1 && compare(ordered[0].result, ordered[1].result) === 0) continue;

            const target = hands.filter(h => h.team.id === winner.id)[0];
            target.finisher = pickFinisher();
            return { hands: hands, provisional: ordered[0].team };
        }
        return null;
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
        const objectionChance = typeof opts.objectionChance === 'number' ? opts.objectionChance : 0.12;
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
