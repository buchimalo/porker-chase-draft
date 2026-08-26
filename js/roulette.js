// js/roulette.js — ルーレット抽選の盤面と回転演出
// ポーカー抽選（showdown.js）とは別枠。指名で「ルーレット」を選んだチームが
// 盤を回して、止まったところの選手をそのまま獲得する。
(function (global) {
    'use strict';

    // 盤の出目。隣り合う色相が離れるように並べる。
    // 先頭2つはロゴの黄と水色。ラベルは濃い文字なので、いずれも明るい色にする。
    const SEG_COLORS = [
        '#f8d000', '#88c8e8', '#ff8fa3', '#3ddc97', '#c08cff',
        '#ff9f6e', '#7ee0ff', '#e5c368', '#ff7fb0', '#63b3ff'
    ];

    const SPIN_MS = 6200;      // 回転時間
    const MIN_TURNS = 6;       // 最低何周させるか
    const MAX_TICKS = 240;     // カチカチ音の上限（保険）

    function esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    function segColor(i) {
        return SEG_COLORS[i % SEG_COLORS.length];
    }

    // 名前が長いと盤からはみ出るので詰める
    function shortLabel(name) {
        const s = String(name);
        return s.length > 9 ? s.slice(0, 8) + '…' : s;
    }

    /* ---------- 盤面の描画 ---------- */

    /**
     * ルーレット盤を host に描画する。
     * @returns {HTMLElement} 回転させるホイール要素
     */
    function render(host, items) {
        const n = items.length;
        const seg = 360 / n;

        const stops = items.map((_, i) =>
            segColor(i) + ' ' + (i * seg).toFixed(4) + 'deg ' + ((i + 1) * seg).toFixed(4) + 'deg'
        ).join(', ');

        // conic-gradient も spoke も「12時＝0度・時計回り」で揃える
        const spokes = items.map(function (name, i) {
            const spokeAngle = (i + 0.5) * seg - 90;
            // 盤の左半分は文字が上下逆さになるので、ラベルだけ反転させる
            const norm = ((spokeAngle % 360) + 360) % 360;
            const flip = norm > 90 && norm < 270;
            return '<div class="rl-spoke" style="transform:rotate(' + spokeAngle.toFixed(4) + 'deg)">' +
                '<span class="rl-label' + (flip ? ' is-flip' : '') + '">' + esc(shortLabel(name)) + '</span>' +
                '</div>';
        }).join('');

        host.innerHTML =
            '<div class="rl-stage">' +
            '<div class="rl-pointer"></div>' +
            '<div class="rl-wheel">' +
            '<div class="rl-face" style="background:conic-gradient(' + stops + ')"></div>' +
            spokes +
            '</div>' +
            '<div class="rl-hub"><span>SPIN</span></div>' +
            '</div>';

        const wheel = host.querySelector('.rl-wheel');
        wheel.dataset.rotation = '0';
        return wheel;
    }

    /* ---------- 回転 ---------- */

    // easeOutCubic の逆関数。進捗 p になる時刻の割合を返す
    function timeFor(p) {
        return 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 1 / 3);
    }

    /**
     * winnerIndex が針の下で止まるように回す。
     * 当選者は呼び出し側で先に決めておく（演出で結果を作らない）。
     * @returns {Promise<void>}
     */
    function spin(host, items, winnerIndex, opts) {
        const options = opts || {};
        const sfx = options.sfx;
        const wheel = host.querySelector('.rl-wheel');
        if (!wheel) return Promise.resolve();

        const n = items.length;
        const seg = 360 / n;
        const current = parseFloat(wheel.dataset.rotation || '0');

        // セグメント内でわずかにばらけさせる（毎回きっちり中央だと機械的に見える）
        const jitter = (Math.random() - 0.5) * seg * 0.6;
        const targetAngle = -((winnerIndex + 0.5) * seg) + jitter;

        // 現在角より必ず MIN_TURNS 周以上先になるところまで進める
        let next = targetAngle;
        while (next < current + MIN_TURNS * 360) next += 360;
        const delta = next - current;

        wheel.style.transition = 'transform ' + SPIN_MS + 'ms cubic-bezier(.215,.61,.355,1)';
        // 反映を確実にするため次フレームで適用する
        requestAnimationFrame(() => {
            wheel.style.transform = 'rotate(' + next + 'deg)';
        });
        wheel.dataset.rotation = String(next);

        // 減速に合わせてカチカチ鳴らす
        const timers = [];
        if (sfx && typeof sfx.flip === 'function') {
            const total = Math.floor(delta / seg);
            const step = Math.max(1, Math.ceil(total / MAX_TICKS));
            for (let k = step; k <= total; k += step) {
                const t = timeFor((k * seg) / delta) * SPIN_MS;
                timers.push(setTimeout(() => { try { sfx.flip(); } catch (e) { /* 無視 */ } }, t));
            }
        }

        host.classList.add('is-spinning');

        return new Promise(resolve => {
            setTimeout(() => {
                timers.forEach(clearTimeout);
                host.classList.remove('is-spinning');
                host.classList.add('is-settled');
                resolve();
            }, SPIN_MS + 120);
        });
    }

    /* ---------- 当選セグメントの強調 ---------- */

    function highlight(host, items, winnerIndex) {
        const spokes = host.querySelectorAll('.rl-spoke');
        spokes.forEach((el, i) => el.classList.toggle('is-hit', i === winnerIndex));
        const face = host.querySelector('.rl-face');
        if (face) face.classList.add('is-dim');
    }

    global.Roulette = {
        render,
        spin,
        highlight,
        SEG_COLORS
    };
})(window);
