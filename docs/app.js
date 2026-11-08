/* AI Demand Watch dashboard. Vanilla JS, no build step, no dependencies.
 * Reads data/latest.json, data/history/index.json and data/history/YYYY-MM-DD.json,
 * which the scheduled Claude run writes and scripts/validate_digest.py checks.
 * All text from data files is inserted with textContent, never as HTML. */
(function () {
  "use strict";

  var AGENTS = [
    { id: "hardware_silicon", label: "Hardware", beat: "Cheaper chips and custom silicon", color: "var(--s1)" },
    { id: "model_efficiency", label: "Efficiency", beat: "Leaner models that need fewer tokens", color: "var(--s2)" },
    { id: "open_source_china", label: "China & open-source", beat: "Free or cheap rival models", color: "var(--s3)" },
    { id: "academic_research", label: "Research", beat: "Papers on cutting AI cost", color: "var(--s4)" },
    { id: "industry_signals", label: "Industry & money", beat: "What big tech says about AI spend", color: "var(--s5)" }
  ];
  var AGENT_BY_ID = {};
  AGENTS.forEach(function (a) { AGENT_BY_ID[a.id] = a; });

  var SEVERITY = [
    { id: "high", label: "High", color: "var(--sev-high)" },
    { id: "medium", label: "Medium", color: "var(--sev-medium)" },
    { id: "low", label: "Low", color: "var(--sev-low)" }
  ];
  var LEVEL_N = { low: 1, medium: 2, high: 3 };

  var state = {
    index: null,
    latest: null,
    cache: {},
    current: null,
    agent: "all",
    severity: "all"
  };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") node.textContent = attrs[k];
        else if (k === "style") node.setAttribute("style", attrs[k]);
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function safeUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:" ? u : null;
    } catch (e) { return null; }
  }

  function fmtDate(iso, long) {
    if (!iso) return "date unknown";
    var parts = iso.split("-").map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    var opts = long
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" };
    return d.toLocaleDateString(undefined, opts);
  }

  function getJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " returned " + r.status);
      return r.json();
    });
  }

  function loadDay(date) {
    if (state.latest && date === state.latest.run_date) return Promise.resolve(state.latest);
    if (state.cache[date]) return Promise.resolve(state.cache[date]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Promise.reject(new Error("bad date"));
    return getJSON("data/history/" + date + ".json").then(function (doc) {
      state.cache[date] = doc;
      return doc;
    });
  }

  /* ---------------------------------------------------------------- theme */
  function initTheme() {
    var btn = $("theme-toggle");
    function effective() {
      var t = document.documentElement.getAttribute("data-theme");
      if (t) return t;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    function label() { btn.textContent = effective() === "dark" ? "Light mode" : "Dark mode"; }
    btn.addEventListener("click", function () {
      var next = effective() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("adw-theme", next); } catch (e) { /* storage unavailable */ }
      label();
    });
    label();
  }

  /* ---------------------------------------------------------------- pipeline */
  function renderPipeline(doc) {
    var box = $("pipeline-agents");
    clear(box);
    var byId = {};
    (doc.agents || []).forEach(function (a) { byId[a.id] = a; });
    AGENTS.forEach(function (a) {
      var info = byId[a.id];
      var countText = !info ? "Not run" : info.status === "failed" ? "Failed this run" : info.signal_count + (info.signal_count === 1 ? " signal" : " signals");
      box.appendChild(el("div", { "class": "node agent-node", style: "--c:" + a.color }, [
        el("strong", { text: a.label }),
        el("span", { "class": "node-note", text: a.beat }),
        el("span", { "class": "count", text: countText })
      ]));
    });
  }

  /* ---------------------------------------------------------------- briefing */
  function renderBriefing(doc) {
    state.current = doc;
    $("sample-banner").hidden = !doc.sample;

    var meta = $("brief-meta");
    meta.textContent = fmtDate(doc.run_date, true) + (doc.sample ? " · sample data" : "");

    var summary = $("editor-summary");
    clear(summary);
    summary.appendChild(el("span", { "class": "by", text: "Editor agent" }));
    summary.appendChild(document.createTextNode(doc.editor_summary || ""));

    var signals = doc.signals || [];
    var agents = doc.agents || [];
    var ok = agents.filter(function (a) { return a.status === "ok"; }).length;
    var high = signals.filter(function (s) { return s.severity === "high"; }).length;
    var stats = $("stats");
    clear(stats);
    [[signals.length, "signals"], [high, "high severity"], [ok + "/" + agents.length, "agents reported"]].forEach(function (s) {
      stats.appendChild(el("div", { "class": "stat" }, [el("div", { "class": "v", text: String(s[0]) }), el("div", { "class": "k", text: s[1] })]));
    });

    renderPipeline(doc);
    renderFilters();
    renderSignals();
    markTableRow();
  }

  function chip(label, pressed, color, onclick) {
    return el("button", { type: "button", "class": "chip", "aria-pressed": pressed ? "true" : "false", style: color ? "--c:" + color : "", onclick: onclick },
      [color ? el("span", { "class": "dot", "aria-hidden": "true" }) : null, label]);
  }

  function renderFilters() {
    var af = $("agent-filter");
    clear(af);
    af.appendChild(chip("All", state.agent === "all", null, function () { state.agent = "all"; renderFilters(); renderSignals(); }));
    AGENTS.forEach(function (a) {
      af.appendChild(chip(a.label, state.agent === a.id, a.color, function () { state.agent = a.id; renderFilters(); renderSignals(); }));
    });
    var sf = $("severity-filter");
    clear(sf);
    sf.appendChild(chip("All", state.severity === "all", null, function () { state.severity = "all"; renderFilters(); renderSignals(); }));
    SEVERITY.forEach(function (s) {
      sf.appendChild(chip(s.label, state.severity === s.id, s.color, function () { state.severity = s.id; renderFilters(); renderSignals(); }));
    });
  }

  function meter(level) {
    var n = LEVEL_N[level] || 0;
    var m = el("span", { "class": "meter", "aria-hidden": "true" });
    for (var i = 1; i <= 3; i++) m.appendChild(el("i", { "class": i <= n ? "on" : "" }));
    return m;
  }

  function signalCard(s, agent) {
    var sev = SEVERITY.filter(function (x) { return x.id === s.severity; })[0] || SEVERITY[2];
    var url = safeUrl(s.source_url);
    var source = url
      ? el("a", { href: url.href, target: "_blank", rel: "noopener noreferrer nofollow", text: url.hostname.replace(/^www\./, "") })
      : el("span", { text: "no source" });
    return el("article", { "class": "card", style: "--c:" + agent.color }, [
      el("div", { "class": "card-top" }, [
        el("span", { "class": "badge", style: "--c:" + sev.color }, [el("span", { "class": "dot", "aria-hidden": "true" }), sev.label + " severity"]),
        el("span", { "class": "badge" }, ["Credibility: " + (s.credibility || "unknown") + " ", meter(s.credibility)]),
        s.tier === "watching" ? el("span", { "class": "badge watching", text: "Watching" }) : null
      ]),
      el("h4", { text: s.headline }),
      el("p", { text: s.summary }),
      s.why_it_matters ? el("p", { "class": "why" }, [el("b", { text: "Why it matters: " }), s.why_it_matters]) : null,
      el("div", { "class": "card-foot" }, [
        el("span", {}, ["Source: ", source]),
        el("span", { text: "Published " + fmtDate(s.published) })
      ])
    ]);
  }

  function renderSignals() {
    var box = $("signals");
    clear(box);
    var doc = state.current;
    if (!doc) return;
    var shown = 0;
    AGENTS.forEach(function (a) {
      if (state.agent !== "all" && state.agent !== a.id) return;
      var items = (doc.signals || []).filter(function (s) {
        return s.agent === a.id && (state.severity === "all" || s.severity === state.severity);
      });
      items.sort(function (x, y) {
        if (x.tier !== y.tier) return x.tier === "top" ? -1 : 1;
        return (LEVEL_N[y.severity] * LEVEL_N[y.credibility]) - (LEVEL_N[x.severity] * LEVEL_N[x.credibility]);
      });
      if (!items.length) return;
      shown += items.length;
      var group = el("section", { "class": "agent-group", style: "--c:" + a.color }, [
        el("div", { "class": "agent-group-head" }, [
          el("span", { "class": "swatch", "aria-hidden": "true" }),
          el("h3", { text: a.label + " agent" }),
          el("span", { "class": "n", text: items.length + (items.length === 1 ? " signal" : " signals") })
        ]),
        el("div", { "class": "cards" }, items.map(function (s) { return signalCard(s, a); }))
      ]);
      box.appendChild(group);
    });
    if (!shown) {
      box.appendChild(el("div", { "class": "empty", text: (doc.signals || []).length ? "No signals match these filters." : "No new signals on this day." }));
    }
  }

  /* ---------------------------------------------------------------- history */
  function renderLegend() {
    var lg = $("legend");
    clear(lg);
    AGENTS.forEach(function (a) {
      lg.appendChild(el("span", { style: "--c:" + a.color }, [el("i", { "aria-hidden": "true" }), a.label]));
    });
  }

  function topRounded(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }

  function renderChart() {
    var box = $("chart");
    clear(box);
    var days = (state.index && state.index.days || []).slice(-30);
    if (!days.length) { box.appendChild(el("div", { "class": "empty", text: "No history yet." })); return; }

    // Size the drawing to the container so tick labels stay readable on phones.
    var W = Math.round(Math.min(1000, Math.max(300, box.clientWidth || 720)));
    var H = W < 480 ? 220 : 260, m = { t: 18, r: 8, b: 26, l: 30 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.signal_count; })));
    var step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
    var top = Math.ceil(max / step) * step;
    var y = function (v) { return m.t + ih - (v / top) * ih; };
    var band = iw / days.length;
    var bw = Math.min(46, band * 0.62);

    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Stacked bar chart of signals per day by research agent. The table below lists the same numbers." });
    for (var v = 0; v <= top; v += step) {
      root.appendChild(svg("line", { "class": v === 0 ? "baseline" : "gridline", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      root.appendChild(svg("text", { "class": "tick", x: m.l - 8, y: y(v) + 4, "text-anchor": "end", text: String(v) }));
    }

    var labelEvery = Math.ceil(days.length / 8);
    days.forEach(function (d, i) {
      var cx = m.l + band * i + band / 2;
      var x = cx - bw / 2;
      var cum = 0;
      var segs = AGENTS.map(function (a) { return { a: a, v: (d.by_agent && d.by_agent[a.id]) || 0 }; }).filter(function (s) { return s.v > 0; });
      segs.forEach(function (s, j) {
        var y1 = y(cum), y0 = y(cum + s.v);
        var h = y1 - y0 - (cum > 0 ? 2 : 0);
        if (h > 0) {
          var isTop = j === segs.length - 1;
          var shape = isTop
            ? svg("path", { d: topRounded(x, y0, bw, h, 4) })
            : svg("rect", { x: x, y: y0, width: bw, height: h });
          shape.setAttribute("style", "fill:" + s.a.color);
          root.appendChild(shape);
        }
        cum += s.v;
      });
      if (days.length <= 14) {
        root.appendChild(svg("text", { "class": "total", x: cx, y: y(d.signal_count) - 6, "text-anchor": "middle", text: String(d.signal_count) }));
      }
      if (i % labelEvery === 0 || i === days.length - 1) {
        root.appendChild(svg("text", { "class": "tick", x: cx, y: H - 8, "text-anchor": "middle", text: fmtDate(d.date) }));
      }
      var hit = svg("rect", { "class": "hit", x: m.l + band * i, y: m.t, width: band, height: ih, tabindex: "0", "aria-label": fmtDate(d.date) + ": " + d.signal_count + " signals" });
      hit.addEventListener("mousemove", function (e) { showTip(d, e.clientX, e.clientY); });
      hit.addEventListener("mouseleave", hideTip);
      hit.addEventListener("focus", function () { var r = hit.getBoundingClientRect(); showTip(d, r.left + r.width / 2, r.top + 20); });
      hit.addEventListener("blur", hideTip);
      hit.addEventListener("click", function () { selectDay(d.date); });
      hit.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectDay(d.date); } });
      root.appendChild(hit);
    });
    box.appendChild(root);
  }

  function showTip(d, cx, cy) {
    var tip = $("tooltip");
    clear(tip);
    tip.appendChild(el("b", { text: fmtDate(d.date, true) + (d.sample ? " (sample)" : "") }));
    AGENTS.forEach(function (a) {
      tip.appendChild(el("div", { "class": "tt-row" }, [
        el("span", { style: "--c:" + a.color }, [el("i", { "aria-hidden": "true" }), a.label]),
        el("span", { text: String((d.by_agent && d.by_agent[a.id]) || 0) })
      ]));
    });
    tip.appendChild(el("div", { "class": "tt-row" }, [el("span", { text: "Total" }), el("strong", { text: String(d.signal_count) })]));
    tip.hidden = false;
    var box = tip.parentNode.getBoundingClientRect();
    var left = cx - box.left + 14;
    if (left + tip.offsetWidth > box.width) left = cx - box.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(0, left) + "px";
    tip.style.top = Math.max(0, cy - box.top - 10) + "px";
  }
  function hideTip() { $("tooltip").hidden = true; }

  function renderTable() {
    var t = $("history-table");
    clear(t);
    var days = (state.index && state.index.days || []).slice().reverse();
    var head = el("tr", {}, [el("th", { text: "Day" }), el("th", { text: "Total" }), el("th", { text: "High" })]
      .concat(AGENTS.map(function (a) { return el("th", { text: a.label }); })));
    t.appendChild(el("thead", {}, [head]));
    var body = el("tbody");
    days.forEach(function (d) {
      var tr = el("tr", { "data-date": d.date, onclick: function () { selectDay(d.date); } }, [
        el("td", {}, [el("button", { type: "button", text: fmtDate(d.date) + (d.sample ? " (sample)" : "") })]),
        el("td", { text: String(d.signal_count) }),
        el("td", { text: String(d.high_severity) })
      ].concat(AGENTS.map(function (a) { return el("td", { text: String((d.by_agent && d.by_agent[a.id]) || 0) }); })));
      body.appendChild(tr);
    });
    t.appendChild(body);
    markTableRow();
  }

  function markTableRow() {
    var cur = state.current && state.current.run_date;
    Array.prototype.forEach.call(document.querySelectorAll("#history-table tbody tr"), function (tr) {
      tr.classList.toggle("current", tr.getAttribute("data-date") === cur);
    });
  }

  function renderDaySelect() {
    var sel = $("day-select");
    clear(sel);
    var days = (state.index && state.index.days || []).map(function (d) { return d.date; });
    if (state.latest && days.indexOf(state.latest.run_date) === -1) days.push(state.latest.run_date);
    days.sort().reverse().forEach(function (date, i) {
      sel.appendChild(el("option", { value: date, text: fmtDate(date) + (i === 0 ? " (latest)" : "") }));
    });
    sel.addEventListener("change", function () { selectDay(sel.value, true); });
  }

  function selectDay(date, fromSelect) {
    loadDay(date).then(function (doc) {
      renderBriefing(doc);
      if (!fromSelect) {
        $("day-select").value = date;
        $("brief-title").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }).catch(function (err) {
      $("brief-meta").textContent = "Could not load " + date + ": " + err.message;
    });
  }

  /* ---------------------------------------------------------------- boot */
  initTheme();
  renderLegend();
  Promise.all([
    getJSON("data/latest.json"),
    getJSON("data/history/index.json").catch(function () { return { days: [] }; })
  ]).then(function (res) {
    state.latest = res[0];
    state.index = res[1];
    renderDaySelect();
    renderBriefing(state.latest);
    renderChart();
    renderTable();
    if (window.addEventListener) {
      var lastW = 0, timer = null;
      window.addEventListener("resize", function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var w = $("chart").clientWidth;
          if (Math.abs(w - lastW) > 20) { lastW = w; renderChart(); }
        }, 150);
      });
    }
  }).catch(function (err) {
    var meta = $("brief-meta");
    meta.textContent = "";
    meta.appendChild(el("span", { "class": "error", text: "Could not load dashboard data (" + err.message + "). If you opened this file directly, serve the docs folder over HTTP instead." }));
  });
})();
