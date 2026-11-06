(() => {
  'use strict';

  // ?year=2025 で過去年のデータ（data/2025.json）を表示する
  const params = new URLSearchParams(location.search);
  const year = (params.get('year') || '').match(/^\d{4}$/);
  const CONTENT_URL = params.has('sample') ? 'dev/sample.json' : `data/${year ? year[0] : 'latest'}.json`;
  const PERIODS = ['上半期', '下半期'];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const rich = s => esc(s).replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const on = v => /^(TRUE|true|1|はい|する|✓|○)$/.test(String(v).trim());
  const shown = rows => (rows || []).filter(r => String(r['表示']).toUpperCase() !== 'FALSE');

  function safeUrl(url) {
    const u = String(url || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  // Googleドライブの共有リンクは画像として直接表示できる形に直す
  // サイト内の画像（assets/〜）もそのまま使える
  function imageUrl(url) {
    const local = String(url || '').trim();
    if (/^assets\/[\w\-./]+\.(jpe?g|png|webp|gif|svg)$/i.test(local) && !local.includes('..')) return local;
    const u = safeUrl(url);
    const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=|thumbnail\?(?:.*&)?id=)([\w-]+)/);
    return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w600` : u;
  }

  function youtubeId(url) {
    const m = safeUrl(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/))([\w-]{11})/);
    return m ? m[1] : '';
  }

  // YouTube の t=81s / t=1m21s / t=274 / start=274 を秒にする
  function youtubeStart(url) {
    const m = safeUrl(url).match(/[?&#](?:t|start)=([\dhms]+)/);
    if (!m) return 0;
    if (/^\d+$/.test(m[1])) return Number(m[1]);
    const part = u => Number((m[1].match(new RegExp(`(\\d+)${u}`)) || [0, 0])[1]);
    return part('h') * 3600 + part('m') * 60 + part('s');
  }

  function instagramUrl(url) {
    const m = safeUrl(url).match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/i);
    return m ? `https://www.instagram.com/${m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase()}/${m[2]}/` : '';
  }

  // 動画URL（YouTube かインスタ）。旧列名 InstagramURL も読む
  function video(r) {
    const url = r['動画URL'] || r['InstagramURL'] || '';
    const yt = youtubeId(url);
    if (yt) return { kind: 'yt', id: yt, start: youtubeStart(url), href: `https://www.youtube.com/watch?v=${yt}${youtubeStart(url) ? `&t=${youtubeStart(url)}s` : ''}` };
    const ig = instagramUrl(url);
    return ig ? { kind: 'ig', href: ig } : null;
  }

  const head = (en, ja) => `<div class="sec-head">
    <h2 class="sec-ja">${esc(ja)}</h2>
    <p class="sec-en" lang="en">– ${esc(en)} –</p>
  </div>`;

  const btn = (href, label, cls = '') => `<a class="btn ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}<span class="btn-arrow" aria-hidden="true">→</span></a>`;

  function hero(s) {
    return `<section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <h1 class="hero-logo"><img src="assets/award-logo.svg" width="584" height="506" alt="${esc(s['タイトル'] || 'THE ROPES AWARD')}" fetchpriority="high"></h1>
      ${s['キャッチコピー'] ? `<p class="hero-catch">${rich(s['キャッチコピー'])}</p>` : ''}
      ${s['ヒーロー補足'] ? `<p class="hero-sub">${rich(s['ヒーロー補足'])}</p>` : ''}
    </section>`;
  }

  function about(s) {
    if (!s['企画説明']) return '';
    return `<section class="sec" id="about">
      <div class="wrap wrap-text">
        ${head('About', s['企画説明見出し'] || 'THE ROPES AWARDとは')}
        <p class="lead">${rich(s['企画説明'])}</p>
      </div>
    </section>`;
  }

  function outline(rows, flow) {
    if (!rows.length && !flow.length) return '';
    return `<section class="sec sec-alt" id="outline">
      <div class="wrap wrap-text">
        ${head('Outline', '開催概要')}
        ${rows.length ? `<dl class="facts">
          ${rows.map(r => `<div><dt>${esc(r['項目'])}</dt><dd>${rich(r['内容'])}</dd></div>`).join('')}
        </dl>` : ''}
        ${flow.length ? `<h3 class="sub-head">選考の流れ</h3>
        <ol class="flow">
          ${flow.map(r => `<li>
            <p class="flow-when">${esc(r['時期'])}</p>
            <p class="flow-title">${esc(r['見出し'])}</p>
            ${r['内容'] ? `<p class="flow-body">${rich(r['内容'])}</p>` : ''}
          </li>`).join('')}
        </ol>` : ''}
      </div>
    </section>`;
  }

  // 部門ごとにまとめる（並びはシートの順）
  function groupBy(rows, key) {
    const groups = [];
    rows.forEach(r => {
      const k = r[key] || '';
      let g = groups.find(x => x.key === k);
      if (!g) groups.push(g = { key: k, rows: [] });
      g.rows.push(r);
    });
    return groups;
  }

  function awards(s, rows, split) {
    const soon = `<p class="soon">${esc(s['賞の準備中の文言'] || '各賞のラインナップは後日発表')}</p>`;
    return `<section class="sec" id="awards">
      <div class="wrap">
        ${head('Awards', '賞の一覧')}
        ${split ? `<p class="note-center">各賞は<strong>上半期・下半期</strong>それぞれで選出します</p>` : ''}
        ${rows.length ? groupBy(rows, '部門').map(g => `<div class="award-group">
          ${g.key ? `<h3 class="group-head"><span>${esc(g.key)}</span></h3>` : ''}
          <ol class="award-grid">
            ${g.rows.map((r, i) => `<li class="award">
              <span class="award-no" lang="en">${String(i + 1).padStart(2, '0')}</span>
              <p class="award-name">${esc(r['賞名'])}</p>
              ${r['説明'] ? `<p class="award-desc">${rich(r['説明'])}</p>` : ''}
            </li>`).join('')}
          </ol>
        </div>`).join('') : soon}
      </div>
    </section>`;
  }

  // 受賞者（「受賞者」タブに入れると出る。空のあいだはゾーンごと出さない）
  function winnerCard(r) {
    const photo = imageUrl(r['写真URL']);
    const v = video(r);
    const initial = esc(String(r['名前'] || '?').trim().charAt(0).toUpperCase());
    return `<li class="winner">
      <p class="winner-award">${esc(r['賞'])}</p>
      <div class="winner-photo">${photo
        ? `<img src="${esc(photo)}" alt="${esc(r['名前'])}" loading="lazy" decoding="async">`
        : `<span aria-hidden="true">${initial}</span>`}</div>
      <p class="winner-name">${esc(r['名前'])}</p>
      ${r['所属・大会名'] ? `<p class="winner-sub">${rich(r['所属・大会名'])}</p>` : ''}
      ${r['コメント'] ? `<p class="winner-note">${rich(r['コメント'])}</p>` : ''}
      ${v ? `<a class="winner-link" href="${esc(v.href)}" target="_blank" rel="noopener">受賞ムーブを見る →</a>` : ''}
    </li>`;
  }

  function winners(s, rows, awardRows, split) {
    if (!rows.length) return '';
    const order = awardRows.map(r => r['賞名']);
    const sorted = rows.slice().sort((a, b) => {
      const ia = order.indexOf(a['賞']), ib = order.indexOf(b['賞']);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    const grid = list => `<ul class="winner-grid">${list.map(winnerCard).join('')}</ul>`;
    let body;
    if (split) {
      body = PERIODS.concat([''])
        .map(p => ({ p, list: sorted.filter(r => (r['期'] || '') === p) }))
        .filter(x => x.list.length)
        .map(x => `<div class="winner-period">
          ${x.p ? `<h3 class="group-head"><span>${esc(x.p)}</span></h3>` : ''}
          ${grid(x.list)}
        </div>`).join('');
    } else {
      body = grid(sorted);
    }
    return `<section class="sec sec-winners" id="winners">
      <div class="wrap">
        ${head('Winners', '受賞者')}
        ${s['受賞者の説明'] ? `<p class="note-center">${rich(s['受賞者の説明'])}</p>` : ''}
        ${body}
      </div>
    </section>`;
  }

  function judges(s, rows) {
    return `<section class="sec sec-alt" id="judges">
      <div class="wrap">
        ${head('Judges', '選考委員')}
        ${s['選考委員の説明'] ? `<p class="note-center">${rich(s['選考委員の説明'])}</p>` : ''}
        ${rows.length ? `<ul class="judge-grid">
          ${rows.map(r => {
            const photo = imageUrl(r['写真URL']);
            const initial = esc(String(r['名前'] || '?').trim().charAt(0).toUpperCase());
            return `<li class="judge">
              <div class="judge-photo">${photo
                ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async">`
                : `<span aria-hidden="true">${initial}</span>`}</div>
              <p class="judge-name">${esc(r['名前'])}</p>
              ${r['所属チーム'] ? `<p class="judge-team">${rich(r['所属チーム'])}</p>` : ''}
            </li>`;
          }).join('')}
        </ul>` : `<p class="soon">後日発表</p>`}
      </div>
    </section>`;
  }

  function nomineeCard(r) {
    const v = video(r);
    const winner = on(r['受賞']);
    return `<li class="nominee${winner ? ' is-winner' : ''}">
      ${winner ? `<span class="winner-badge">受賞</span>` : ''}
      <p class="nominee-name">${esc(r['名前'] || '—')}</p>
      ${r['大会名'] ? `<p class="nominee-event">${esc(r['大会名'])}</p>` : ''}
      ${r['コメント'] ? `<p class="nominee-note">${rich(r['コメント'])}</p>` : ''}
      ${v ? `<div class="nominee-media" ${v.kind === 'yt' ? `data-yt="${esc(v.id)}" data-start="${v.start}"` : `data-ig="${esc(v.href)}"`}>
        <button type="button" class="btn btn-small js-video">映像を見る<span class="btn-arrow" aria-hidden="true">▶</span></button>
      </div>` : ''}
    </li>`;
  }

  function nomineeGroups(rows, awardOrder) {
    const groups = groupBy(rows, '賞');
    groups.sort((a, b) => {
      const ia = awardOrder.indexOf(a.key), ib = awardOrder.indexOf(b.key);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    return groups.map(g => `<div class="nom-group">
      <h3 class="nom-award">${esc(g.key || 'ノミネート')}</h3>
      <ul class="nom-grid">${g.rows.map(nomineeCard).join('')}</ul>
    </div>`).join('');
  }

  function nominees(s, rows, awardRows, split) {
    const soon = `<p class="soon">${esc(s['ノミネート準備中の文言'] || 'ノミネート作品は後日発表')}</p>`;
    const order = awardRows.map(r => r['賞名']);
    let body;
    if (!split) {
      body = rows.length ? nomineeGroups(rows, order) : soon;
    } else {
      const byPeriod = PERIODS.map(p => ({ p, rows: rows.filter(r => r['期'] === p) }));
      // 最初に開くのは、作品が入っている一番新しい期
      const filled = byPeriod.filter(x => x.rows.length);
      const active = filled.length ? filled[filled.length - 1].p : PERIODS[0];
      body = `<div class="tabs" role="tablist">
          ${byPeriod.map(x => `<button type="button" role="tab" class="tab" id="tab-${x.p}" aria-controls="panel-${x.p}" aria-selected="${x.p === active}">${esc(x.p)}</button>`).join('')}
        </div>
        ${byPeriod.map(x => `<div class="tab-panel" role="tabpanel" id="panel-${x.p}" aria-labelledby="tab-${x.p}" ${x.p === active ? '' : 'hidden'}>
          ${x.rows.length ? nomineeGroups(x.rows, order) : soon}
        </div>`).join('')}`;
    }
    return `<section class="sec" id="nominees">
      <div class="wrap">
        ${head('Nominees', 'ノミネート作品')}
        ${s['ノミネートの説明'] ? `<p class="note-center">${rich(s['ノミネートの説明'])}</p>` : ''}
        ${body}
      </div>
    </section>`;
  }

  function entry(s) {
    const form = safeUrl(s['公募フォームURL']);
    return `<section class="sec sec-alt" id="entry">
      <div class="wrap wrap-text center">
        ${head('Entry', '公募フォーム')}
        ${s['公募の説明'] ? `<p class="lead">${rich(s['公募の説明'])}</p>` : ''}
        ${s['公募の締切'] ? `<p class="deadline">${rich(s['公募の締切'])}</p>` : ''}
        ${form ? btn(form, s['公募ボタンの文言'] || '公募フォームから応募する', 'btn-gold btn-large')
          : `<p class="btn btn-off">${esc(s['公募終了の文言'] || '公募は終了しました')}</p>`}
      </div>
    </section>`;
  }

  function broadcast(s) {
    const vid = youtubeId(s['放送URL']);
    const channel = safeUrl(s['YouTubeチャンネルURL']);
    const date = s['放送日'] || '後日発表';
    return `<section class="sec sec-stage" id="broadcast">
      <div class="wrap wrap-text center">
        ${head('Broadcast', `AWARD ${s['年度'] || ''} 放送日`)}
        <p class="air-date">${esc(date)}</p>
        ${s['放送の説明'] ? `<p class="lead">${rich(s['放送の説明'])}</p>` : ''}
        ${vid ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${vid}" title="${esc(s['タイトル'] || 'THE ROPES AWARD')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
          ${btn(`https://www.youtube.com/watch?v=${vid}`, 'YouTubeで見る', 'btn-gold')}`
          : (channel ? btn(channel, s['チャンネルボタンの文言'] || 'THE ROPES YouTubeチャンネル', 'btn-gold') : '')}
      </div>
    </section>`;
  }

  function footer(s) {
    return `<footer class="site-foot">
      <img src="assets/award-logo.svg" width="584" height="506" alt="" loading="lazy">
      ${s['主催'] ? `<p>主催：${esc(s['主催'])}</p>` : ''}
      <a class="foot-brand" href="https://theropes.jp/"><img src="assets/theropes-logo.svg" width="2030" height="490" alt="THE ROPES" loading="lazy"></a>
      <p><a href="https://theropes.jp/">theropes.jp</a> ・ <a href="https://theropes.jp/category/the-ropes-award/">AWARDの記事一覧</a></p>
      <p class="copy" lang="en">© THE ROPES</p>
    </footer>`;
  }

  // ---------- 動き ----------

  function bindTabs(root) {
    root.querySelectorAll('[role="tablist"]').forEach(list => {
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const select = tab => {
        tabs.forEach(t => {
          const sel = t === tab;
          t.setAttribute('aria-selected', sel);
          document.getElementById(t.getAttribute('aria-controls')).hidden = !sel;
        });
        tab.focus();
      };
      tabs.forEach((t, i) => {
        t.addEventListener('click', () => select(t));
        t.addEventListener('keydown', e => {
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (d) select(tabs[(i + d + tabs.length) % tabs.length]);
        });
      });
    });
  }

  // インスタの埋め込みは押されたときだけ読み込む（作品が多くてもページを重くしない）
  let igScript;
  function loadInstagram() {
    if (igScript) return igScript;
    igScript = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://www.instagram.com/embed.js';
      el.async = true;
      el.onload = resolve;
      el.onerror = reject;
      document.body.appendChild(el);
    });
    return igScript;
  }

  // 「映像を見る」を押したら、その場で YouTube（指定の秒から）かインスタを埋め込む
  function bindVideos(root) {
    root.addEventListener('click', e => {
      const button = e.target.closest('.js-video');
      if (!button) return;
      const box = button.parentElement;
      if (box.dataset.yt) {
        const id = encodeURIComponent(box.dataset.yt);
        const start = Number(box.dataset.start) || 0;
        box.innerHTML = `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1${start ? `&start=${start}` : ''}" title="ノミネート作品の映像" allow="autoplay; encrypted-media; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
        return;
      }
      const url = box.dataset.ig;
      box.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${esc(url)}" data-instgrm-version="14"><a href="${esc(url)}" target="_blank" rel="noopener">Instagramで見る</a></blockquote>`;
      loadInstagram()
        .then(() => window.instgrm && window.instgrm.Embeds.process())
        .catch(() => {});
    });
  }

  function render(data) {
    const s = data.settings || {};
    const split = on(s['上半期・下半期で分ける']);
    const awardRows = shown(data.awards);
    if (s['タイトル']) document.title = `${s['タイトル']} | THE ROPES`;
    const app = document.getElementById('app');
    const winnerRows = shown(data.winners);
    if (winnerRows.length) {
      document.querySelector('.site-nav').insertAdjacentHTML('afterbegin', '<a href="#winners">受賞者</a>');
    }
    app.innerHTML = [
      hero(s),
      winners(s, winnerRows, awardRows, split),
      about(s),
      outline(shown(data.outline), shown(data.flow)),
      awards(s, awardRows, split),
      judges(s, shown(data.judges)),
      nominees(s, shown(data.nominees), awardRows, split),
      entry(s),
      broadcast(s),
    ].join('');
    app.insertAdjacentHTML('afterend', footer(s));
    bindTabs(app);
    bindVideos(app);
  }

  fetch(CONTENT_URL, { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(() => {
      document.getElementById('app').innerHTML = '<p class="loading">ページを読み込めませんでした。時間をおいて再度お試しください。</p>';
    });
})();
