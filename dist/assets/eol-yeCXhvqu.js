import{i as c,t as d,a as g}from"./common-j_SfgWpk.js";c("eol");fetch("/data/eol_chips.json").then(a=>a.json()).then(a=>{document.getElementById("eol-count").textContent=a.length.toLocaleString();const l=[...new Set(a.map(e=>e.category).filter(Boolean))].sort();document.getElementById("cat-count").textContent=l.length;const o=document.getElementById("cat-filters");o.innerHTML=`<button class="cat-btn active" data-cat="all">All (${a.length})</button>`+l.map(e=>{const n=a.filter(t=>t.category===e).length;return`<button class="cat-btn" data-cat="${e}">${e} <span style="opacity:.6;font-size:10px">${n}</span></button>`}).join("");const s=document.getElementById("eol-body");function r(e="all"){const n=e==="all"?a:a.filter(t=>t.category===e);s.innerHTML=n.map(t=>`<tr>
        <td>${d("tag-cat",t.category||"")}</td>
        <td style="white-space:nowrap;font-family:monospace;font-size:12px">
          <a href="${t.url||"#"}" target="_blank" rel="noopener">${t.part_number||""}</a>
        </td>
        <td style="font-weight:500">${t.title||t.name||""}</td>
        <td style="color:var(--text2)">${t.manufacturer||""}</td>
        <td>${g(t.status)}</td>
        <td style="color:var(--text3);white-space:nowrap">${t.eol_date||"—"}</td>
        <td>${t.datasheet?`<a href="${t.datasheet}" target="_blank" rel="noopener"
               style="font-size:11px;color:var(--text2)">&#128196; PDF</a>`:'<span style="color:var(--text3)">—</span>'}</td>
      </tr>`).join("")}r(),o.addEventListener("click",e=>{const n=e.target.closest(".cat-btn");n&&(o.querySelectorAll(".cat-btn").forEach(t=>t.classList.remove("active")),n.classList.add("active"),r(n.dataset.cat))})});
